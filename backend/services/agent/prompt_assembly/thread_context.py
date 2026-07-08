# CALLING SPEC:
# - Purpose: orchestrate per-turn transcript assembly (system prompt, prior rows, review prefix, user content).
# - Inputs: SQLAlchemy session, thread id, user markdown, attachment parts, surface, turn index.
# - Outputs: harness TranscriptMessage lists for RunRequest.initial_transcript.
# - Side effects: reads transcript rows, runtime settings, and thread owner for prompt context.
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.config import get_settings
from backend.enums_agent import AgentRunStatus, AgentTranscriptRole
from backend.models_agent import AgentRun, AgentTranscriptMessage
from backend.services.agent.harness.contracts import (
    SystemMessage,
    TranscriptMessage,
    UserMessage,
)
from backend.services.agent.principal_scope import load_thread_owner_user
from backend.services.agent.prompt_assembly.message_history_content import build_entity_category_context
from backend.services.agent.prompt_assembly.message_history_prefixes import (
    build_review_results_prefix_for_thread,
)
from backend.services.agent.prompt_assembly.prompts import SystemPromptContext, system_prompt
from backend.services.agent.prompt_assembly.user_context import build_current_user_context
from backend.services.runtime_settings import resolve_runtime_settings


INTERRUPTED_TURN_STEERING_MESSAGE = (
    "I interrupted the previous turn before it finished. "
    "Use the thinking and completed tool work above as context, "
    "and steer according to my next message."
)


def _prior_run_was_interrupted(db: Session, *, thread_id: str, turn_index: int) -> bool:
    if turn_index <= 0:
        return False
    prior_status = db.scalar(
        select(AgentRun.status)
        .where(
            AgentRun.thread_id == thread_id,
            AgentRun.turn_index == turn_index - 1,
        )
        .limit(1)
    )
    return prior_status == AgentRunStatus.INTERRUPTED


def _message_from_row(row: AgentTranscriptMessage) -> TranscriptMessage | None:
    payload = dict(row.content_json or {})
    role = row.role.value
    if role == AgentTranscriptRole.SYSTEM.value:
        return SystemMessage(content=str(payload.get("content") or ""))
    if role == AgentTranscriptRole.USER.value:
        return UserMessage(content=payload.get("content") or "")
    if role == AgentTranscriptRole.ASSISTANT.value:
        from backend.services.agent.harness.contracts import AssistantMessage, ToolRequest

        return AssistantMessage(
            content=str(payload.get("content") or ""),
            reasoning_text=row.reasoning_text,
            tool_requests=[
                ToolRequest.model_validate(tr) for tr in (payload.get("tool_requests") or [])
            ],
        )
    if role == AgentTranscriptRole.TOOL.value:
        from backend.services.agent.harness.contracts import ToolResultMessage

        return ToolResultMessage(
            tool_request_id=str(row.tool_request_id or ""),
            tool_name=str(row.tool_name or ""),
            content=payload.get("content") or "",
            is_error=bool(payload.get("is_error")),
        )
    return None


def prior_thread_transcript(db: Session, *, thread_id: str) -> list[TranscriptMessage]:
    runs = list(
        db.scalars(
            select(AgentRun)
            .where(AgentRun.thread_id == thread_id)
            .options(selectinload(AgentRun.transcript_messages))
            .order_by(AgentRun.turn_index.asc(), AgentRun.created_at.asc())
        )
    )
    messages: list[TranscriptMessage] = []
    for run in runs:
        for row in sorted(run.transcript_messages, key=lambda item: item.sequence_index):
            if row.role == AgentTranscriptRole.SYSTEM:
                continue
            parsed = _message_from_row(row)
            if parsed is not None:
                messages.append(parsed)
    return messages


def build_system_message(
    db: Session,
    *,
    thread_id: str,
    surface: str,
) -> SystemMessage:
    settings = resolve_runtime_settings(db)
    owner_user = load_thread_owner_user(db, thread_id=thread_id)
    return SystemMessage(
        content=system_prompt(
            SystemPromptContext(
                current_user_context=build_current_user_context(
                    db,
                    user_id=owner_user.id if owner_user is not None else None,
                    user_name=owner_user.name if owner_user is not None else None,
                ),
                entity_category_context=build_entity_category_context(
                    db,
                    owner_user_id=owner_user.id if owner_user is not None else None,
                ),
                user_memory=settings.user_memory,
                current_timezone=get_settings().current_user_timezone,
                response_surface=surface,
            )
        )
    )


def build_user_message(
    db: Session,
    *,
    thread_id: str,
    content_markdown: str,
    review_prefix: str | None = None,
    content_parts: list[Any] | None = None,
) -> UserMessage:
    typed_text = content_markdown or ""
    text = (review_prefix or "") + typed_text
    display_content = typed_text
    if content_parts:
        from backend.services.agent.harness.contracts import ImageUrlContentPart, TextContentPart

        parts = []
        for part in content_parts:
            if isinstance(part, dict) and part.get("type") == "image_url":
                parts.append(ImageUrlContentPart.model_validate(part))
            elif isinstance(part, dict):
                parts.append(TextContentPart.model_validate(part))
            else:
                parts.append(part)
        if text.strip():
            from backend.services.agent.harness.contracts import TextContentPart

            parts = [TextContentPart(text=text)] + parts
        return UserMessage(content=parts, display_content=display_content)
    return UserMessage(content=text, display_content=display_content)


def build_new_turn_transcript(
    db: Session,
    *,
    thread_id: str,
    user_content: str,
    surface: str = "app",
    user_content_parts: list[Any] | None = None,
    turn_index: int | None = None,
    owned_messages: list[TranscriptMessage] | None = None,
) -> list[TranscriptMessage]:
    resolved_owned = owned_messages or build_new_turn_owned_messages(
        db,
        thread_id=thread_id,
        user_content=user_content,
        surface=surface,
        user_content_parts=user_content_parts,
        turn_index=turn_index,
    )
    transcript: list[TranscriptMessage] = [resolved_owned[0]]
    transcript.extend(prior_thread_transcript(db, thread_id=thread_id))
    transcript.extend(resolved_owned[1:])
    return transcript


def build_new_turn_owned_messages(
    db: Session,
    *,
    thread_id: str,
    user_content: str,
    surface: str = "app",
    user_content_parts: list[Any] | None = None,
    turn_index: int | None = None,
) -> list[TranscriptMessage]:
    review_prefix = build_review_results_prefix_for_thread(db, thread_id=thread_id)
    resolved_turn_index = (
        turn_index if turn_index is not None else next_turn_index(db, thread_id=thread_id)
    )
    transcript: list[TranscriptMessage] = [
        build_system_message(db, thread_id=thread_id, surface=surface)
    ]
    if _prior_run_was_interrupted(db, thread_id=thread_id, turn_index=resolved_turn_index):
        transcript.append(UserMessage(content=INTERRUPTED_TURN_STEERING_MESSAGE))
    transcript.append(
        build_user_message(
            db,
            thread_id=thread_id,
            content_markdown=user_content,
            review_prefix=review_prefix,
            content_parts=user_content_parts,
        )
    )
    return transcript


def next_turn_index(db: Session, *, thread_id: str) -> int:
    current = db.scalar(
        select(AgentRun.turn_index)
        .where(AgentRun.thread_id == thread_id)
        .order_by(AgentRun.turn_index.desc())
        .limit(1)
    )
    if current is None:
        return 0
    return int(current) + 1
