# CALLING SPEC:
# - Purpose: build thread detail projections from canonical transcript rows and run state.
# - Inputs: loaded AgentThread ORM graph with runs, transcript messages, steps, tool calls.
# - Outputs: AgentThreadDetailRead with ordered turns and per-run work records.
# - Side effects: none.
from __future__ import annotations

from backend.enums_agent import AgentTranscriptRole
from backend.models_agent import AgentRun, AgentThread, AgentTranscriptMessage
from backend.schemas_agent import (
    AgentRunRead,
    AgentThreadDetailRead,
    AgentThreadRead,
    AgentTurnMessageRead,
    AgentTurnRead,
)
from backend.services.agent.serializers import (
    content_markdown_from_transcript_row,
    run_to_schema,
    thread_to_schema,
)


def _first_step_boundary_sequence(run: AgentRun) -> int | None:
    if not run.steps:
        return None
    assistant_ids = {step.assistant_transcript_message_id for step in run.steps}
    sequences = [
        row.sequence_index
        for row in run.transcript_messages
        if row.id in assistant_ids
    ]
    return min(sequences) if sequences else None


def _turn_user_row(run: AgentRun) -> AgentTranscriptMessage | None:
    boundary = _first_step_boundary_sequence(run)
    user_rows = [
        row
        for row in sorted(run.transcript_messages, key=lambda item: item.sequence_index)
        if row.role == AgentTranscriptRole.USER
        and (boundary is None or row.sequence_index < boundary)
    ]
    return user_rows[-1] if user_rows else None


def _turn_assistant_row(run: AgentRun) -> AgentTranscriptMessage | None:
    if run.final_transcript_message_id:
        for row in run.transcript_messages:
            if row.id == run.final_transcript_message_id:
                return row
    assistant_rows = [
        row
        for row in sorted(run.transcript_messages, key=lambda item: item.sequence_index)
        if row.role == AgentTranscriptRole.ASSISTANT
    ]
    return assistant_rows[-1] if assistant_rows else None


def turn_message_to_schema(
    row: AgentTranscriptMessage,
    *,
    api_prefix: str,
) -> AgentTurnMessageRead:
    from backend.services.agent.serializers import transcript_attachment_to_schema

    return AgentTurnMessageRead(
        id=row.id,
        role=row.role,
        content_markdown=content_markdown_from_transcript_row(row),
        reasoning_text=row.reasoning_text,
        created_at=row.created_at,
        attachments=[
            transcript_attachment_to_schema(attachment, api_prefix=api_prefix)
            for attachment in sorted(row.attachments, key=lambda item: item.created_at)
        ],
    )


def turn_to_schema(
    run: AgentRun,
    *,
    api_prefix: str,
) -> AgentTurnRead | None:
    user_row = _turn_user_row(run)
    if user_row is None or run.turn_index is None:
        return None
    assistant_row = _turn_assistant_row(run)
    return AgentTurnRead(
        run_id=run.id,
        turn_index=run.turn_index,
        status=run.status,
        user_message=turn_message_to_schema(user_row, api_prefix=api_prefix),
        assistant_message=(
            turn_message_to_schema(assistant_row, api_prefix=api_prefix)
            if assistant_row is not None
            else None
        ),
    )


def build_thread_detail_projection(
    thread: AgentThread,
    *,
    api_prefix: str,
    configured_model_name: str,
    current_context_tokens: int | None,
    initiated_by_external_agent: bool = False,
    include_tool_payload: bool = False,
) -> AgentThreadDetailRead:
    ordered_runs = sorted(
        thread.runs,
        key=lambda run: (
            run.turn_index if run.turn_index is not None else 10**9,
            run.created_at,
        ),
    )
    turns: list[AgentTurnRead] = []
    for run in ordered_runs:
        turn = turn_to_schema(run, api_prefix=api_prefix)
        if turn is not None:
            turns.append(turn)
    runs = [
        run_to_schema(
            run,
            include_tool_payload=include_tool_payload,
        )
        for run in ordered_runs
    ]
    return AgentThreadDetailRead(
        thread=thread_to_schema(
            thread,
            initiated_by_external_agent=initiated_by_external_agent,
        ),
        turns=turns,
        runs=runs,
        configured_model_name=configured_model_name,
        current_context_tokens=current_context_tokens,
    )


def last_turn_preview_from_thread(thread: AgentThread) -> str | None:
    preview: str | None = None
    for run in sorted(
        thread.runs,
        key=lambda item: (
            item.turn_index if item.turn_index is not None else -1,
            item.created_at,
        ),
        reverse=True,
    ):
        assistant_row = _turn_assistant_row(run)
        if assistant_row is not None:
            text = content_markdown_from_transcript_row(assistant_row).strip()
            if text:
                return text[:120]
        user_row = _turn_user_row(run)
        if user_row is not None:
            text = content_markdown_from_transcript_row(user_row).strip()
            if text:
                preview = text[:120]
    return preview
