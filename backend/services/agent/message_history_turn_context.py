# CALLING SPEC:
# - Purpose: rebuild append-only per-turn LLM context from persisted run activity.
# - Inputs: agent runs with events, tool calls, and optional final assistant messages.
# - Outputs: ordered assistant/tool messages for one turn; interrupt steering when needed.
# - Side effects: read-only DB queries.
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import (
    AgentMessageRole,
    AgentRunEventSource,
    AgentRunEventType,
    AgentRunStatus,
    AgentToolCallStatus,
)
from backend.models_agent import AgentMessage, AgentRun, AgentRunEvent, AgentToolCall
from backend.services.agent.runtime_state import CANCELLED_TOOL_RESULT_CONTENT

_TERMINAL_EVENT_TYPES = frozenset(
    {
        AgentRunEventType.RUN_STARTED,
        AgentRunEventType.RUN_COMPLETED,
        AgentRunEventType.RUN_FAILED,
    }
)
_COMPLETED_TOOL_STATUSES = frozenset({AgentToolCallStatus.OK, AgentToolCallStatus.ERROR})
_INCOMPLETE_TOOL_STATUSES = frozenset(
    {AgentToolCallStatus.QUEUED, AgentToolCallStatus.RUNNING}
)
_RESTORED_TOOL_STATUSES = _COMPLETED_TOOL_STATUSES | {AgentToolCallStatus.CANCELLED}
_TOOL_RESULT_EVENT_TYPES = frozenset(
    {
        AgentRunEventType.TOOL_CALL_COMPLETED,
        AgentRunEventType.TOOL_CALL_FAILED,
        AgentRunEventType.TOOL_CALL_CANCELLED,
    }
)

INTERRUPTED_TURN_STEERING_MESSAGE = (
    "I interrupted the previous turn before it finished. "
    "Use the thinking and completed tool work above as context, "
    "and steer according to my next message."
)


@dataclass(slots=True)
class TurnContextInsert:
    user_message_id: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    skip_assistant_message_id: str | None = None


@dataclass(slots=True)
class _StepDraft:
    model_reasoning: str = ""
    assistant_content: str = ""
    queued_tool_ids: list[str] = field(default_factory=list)
    tool_results: list[dict[str, Any]] = field(default_factory=list)

    def has_content(self) -> bool:
        if self.model_reasoning.strip() or self.assistant_content.strip():
            return True
        return bool(self.tool_results)


def load_latest_runs_by_user_message_id(
    db: Session,
    *,
    thread_id: str,
) -> dict[str, AgentRun]:
    runs = list(
        db.scalars(
            select(AgentRun)
            .where(AgentRun.thread_id == thread_id)
            .options(
                selectinload(AgentRun.events),
                selectinload(AgentRun.tool_calls),
                selectinload(AgentRun.assistant_message),
            )
            .order_by(AgentRun.created_at.asc())
        )
    )
    latest_by_user_message_id: dict[str, AgentRun] = {}
    for run in runs:
        latest_by_user_message_id[run.user_message_id] = run
    return latest_by_user_message_id


def build_turn_context_insert(
    *,
    run: AgentRun,
    user_message: AgentMessage,
    current_user_message_id: str | None,
    history: list[AgentMessage],
) -> TurnContextInsert | None:
    messages = list(build_turn_llm_messages(run))
    if _should_append_interrupt_steering(
        run,
        user_message=user_message,
        current_user_message_id=current_user_message_id,
        history=history,
    ):
        messages.append({"role": "user", "content": INTERRUPTED_TURN_STEERING_MESSAGE})
    if not messages:
        return None

    skip_assistant_message_id = (
        run.assistant_message_id
        if any(message.get("role") == "assistant" for message in messages)
        else None
    )
    return TurnContextInsert(
        user_message_id=user_message.id,
        messages=messages,
        skip_assistant_message_id=skip_assistant_message_id,
    )


def build_turn_llm_messages(run: AgentRun) -> list[dict[str, Any]]:
    messages = _build_step_messages_from_events(run)
    assistant_message = run.assistant_message
    if assistant_message is None:
        return messages

    final_content = assistant_message.content_markdown.strip()
    if not final_content:
        return messages

    if messages and messages[-1].get("role") == "assistant":
        last_assistant = messages[-1]
        if not str(last_assistant.get("content") or "").strip():
            last_assistant["content"] = final_content
            return messages

    messages.append({"role": "assistant", "content": final_content})
    return messages


def _should_append_interrupt_steering(
    run: AgentRun,
    *,
    user_message: AgentMessage,
    current_user_message_id: str | None,
    history: list[AgentMessage],
) -> bool:
    if run.status != AgentRunStatus.FAILED or run.assistant_message_id is not None:
        return False
    if "interrupt" not in (run.error_text or "").lower():
        return False
    if not current_user_message_id or current_user_message_id == user_message.id:
        return False

    current_user = next(
        (
            message
            for message in history
            if message.id == current_user_message_id and message.role == AgentMessageRole.USER
        ),
        None,
    )
    if current_user is None:
        return False
    if (
        current_user.created_at is not None
        and user_message.created_at is not None
    ):
        return current_user.created_at > user_message.created_at

    history_index = {message.id: index for index, message in enumerate(history)}
    current_index = history_index.get(current_user_message_id)
    user_index = history_index.get(user_message.id)
    if current_index is None or user_index is None:
        return False
    return current_index > user_index


def _append_assistant_content(step: _StepDraft, message: str) -> None:
    normalized = message.strip()
    if not normalized:
        return
    if step.assistant_content.strip():
        step.assistant_content = f"{step.assistant_content}\n\n{normalized}"
    else:
        step.assistant_content = normalized


def _build_step_messages_from_events(run: AgentRun) -> list[dict[str, Any]]:
    events = sorted(run.events, key=lambda event: event.sequence_index)
    tool_calls_by_id = {tool_call.id: tool_call for tool_call in run.tool_calls}
    steps: list[_StepDraft] = []
    current = _StepDraft()

    for event in events:
        if event.event_type in _TERMINAL_EVENT_TYPES:
            continue

        if event.event_type == AgentRunEventType.REASONING_UPDATE:
            if (
                event.source == AgentRunEventSource.MODEL_REASONING
                and current.has_content()
            ):
                steps.append(current)
                current = _StepDraft()
            if event.source == AgentRunEventSource.MODEL_REASONING:
                current.model_reasoning = event.message or ""
            elif event.source in {
                AgentRunEventSource.ASSISTANT_CONTENT,
                AgentRunEventSource.TOOL_CALL,
            }:
                _append_assistant_content(current, event.message or "")
            continue

        if event.event_type == AgentRunEventType.TOOL_CALL_QUEUED:
            if event.tool_call_id is not None:
                current.queued_tool_ids.append(event.tool_call_id)
            continue

        if event.event_type in _TOOL_RESULT_EVENT_TYPES:
            tool_call = (
                tool_calls_by_id.get(event.tool_call_id)
                if event.tool_call_id is not None
                else None
            )
            if tool_call is None or tool_call.status not in _RESTORED_TOOL_STATUSES:
                continue
            current.tool_results.append(_tool_result_message(tool_call))

    if current.has_content():
        _fill_missing_tool_results(current, tool_calls_by_id, run=run)
        steps.append(current)

    messages: list[dict[str, Any]] = []
    for step in steps:
        messages.extend(_step_to_llm_messages(step, tool_calls_by_id, run=run))
    return messages


def _fill_missing_tool_results(
    step: _StepDraft,
    tool_calls_by_id: dict[str, AgentToolCall],
    *,
    run: AgentRun,
) -> None:
    result_ids = {message["tool_call_id"] for message in step.tool_results}
    for tool_call_id in step.queued_tool_ids:
        tool_call = tool_calls_by_id.get(tool_call_id)
        if tool_call is None:
            continue
        llm_tool_call_id = tool_call.llm_tool_call_id or tool_call.id
        if llm_tool_call_id in result_ids:
            continue
        if _tool_call_is_restorable(tool_call, run=run):
            step.tool_results.append(_tool_result_message(tool_call))


def _tool_call_is_restorable(tool_call: AgentToolCall, *, run: AgentRun) -> bool:
    if tool_call.status in _RESTORED_TOOL_STATUSES:
        return True
    return (
        tool_call.status in _INCOMPLETE_TOOL_STATUSES
        and run.status != AgentRunStatus.RUNNING
    )


def _step_to_llm_messages(
    step: _StepDraft,
    tool_calls_by_id: dict[str, AgentToolCall],
    *,
    run: AgentRun,
) -> list[dict[str, Any]]:
    tool_calls: list[dict[str, Any]] = []

    for tool_call_id in step.queued_tool_ids:
        tool_call = tool_calls_by_id.get(tool_call_id)
        if tool_call is None or not _tool_call_is_restorable(tool_call, run=run):
            continue
        tool_calls.append(_tool_call_message(tool_call))

    assistant_message: dict[str, Any] = {
        "role": "assistant",
        "content": step.assistant_content,
    }
    reasoning = step.model_reasoning.strip()
    if reasoning:
        assistant_message["reasoning"] = reasoning
    if tool_calls:
        assistant_message["tool_calls"] = tool_calls

    if not reasoning and not step.assistant_content.strip() and not tool_calls:
        return []

    messages: list[dict[str, Any]] = [assistant_message]
    messages.extend(step.tool_results)
    return messages


def _tool_call_message(tool_call: AgentToolCall) -> dict[str, Any]:
    return {
        "id": tool_call.llm_tool_call_id or tool_call.id,
        "type": "function",
        "function": {
            "name": tool_call.tool_name,
            "arguments": json.dumps(tool_call.input_json, separators=(",", ":")),
        },
    }


def _tool_result_message(tool_call: AgentToolCall) -> dict[str, Any]:
    if tool_call.status in _INCOMPLETE_TOOL_STATUSES | {AgentToolCallStatus.CANCELLED}:
        content = CANCELLED_TOOL_RESULT_CONTENT
    else:
        content = tool_call.output_text
    return {
        "role": "tool",
        "tool_call_id": tool_call.llm_tool_call_id or tool_call.id,
        "name": tool_call.tool_name,
        "content": content,
    }
