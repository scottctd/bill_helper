# CALLING SPEC:
# - Purpose: map harness-first agent ORM rows to API read schemas and SSE payloads.
# - Inputs: AgentRun graphs, transcript attachments, durable run events.
# - Outputs: Pydantic read models and stream payload dicts from payload_json.
# - Side effects: none.
from __future__ import annotations

import logging
import re
from typing import Any

from backend.enums_agent import AgentRunStatus, is_supported_agent_change_type
from backend.models_agent import (
    AgentChangeItem,
    AgentReviewAction,
    AgentRun,
    AgentRunEvent,
    AgentStep,
    AgentThread,
    AgentToolCall,
    AgentTranscriptAttachment,
)
from backend.schemas_agent import (
    AgentChangeItemRead,
    AgentReviewActionRead,
    AgentRunEventRead,
    AgentRunRead,
    AgentStepRead,
    AgentThreadRead,
    AgentThreadSummaryRead,
    AgentToolCallRead,
    AgentTranscriptAttachmentRead,
)
from backend.services.agent.assistant_content import final_assistant_content as clean_final_assistant_content
from backend.services.agent.attachment_content_assembly import attachment_display_name
from backend.services.agent.pricing import calculate_usage_costs
from backend.services.agent.tool_call_display import build_tool_call_display


logger = logging.getLogger(__name__)


def content_markdown_from_transcript_row(row: Any) -> str:
    payload = dict(row.content_json or {})
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
        return "".join(parts)
    return ""


def display_content_markdown_from_transcript_row(row: Any) -> str:
    payload = dict(row.content_json or {})
    display_content = payload.get("display_content")
    if isinstance(display_content, str):
        return display_content
    return content_markdown_from_transcript_row(row)


def raw_prompt_markdown_from_transcript_row(row: Any) -> str | None:
    raw = content_markdown_from_transcript_row(row)
    display = display_content_markdown_from_transcript_row(row)
    if raw != display:
        return raw
    return None


_MARKDOWN_LINK_PATTERN = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_MARKDOWN_HEADING_PATTERN = re.compile(r"^#{1,6}\s*", re.MULTILINE)
_MARKDOWN_BLOCKQUOTE_PATTERN = re.compile(r"^\s*>\s?", re.MULTILINE)
_MARKDOWN_FENCE_PATTERN = re.compile(r"```(?:[a-zA-Z0-9_+.-]+)?\n?|```")


def _format_terminal_assistant_reply(content: str | None, *, origin: str) -> str | None:
    if content is None:
        return None
    if origin != "telegram":
        return content

    formatted = _MARKDOWN_LINK_PATTERN.sub(r"\1 (\2)", content)
    formatted = _MARKDOWN_HEADING_PATTERN.sub("", formatted)
    formatted = _MARKDOWN_BLOCKQUOTE_PATTERN.sub("", formatted)
    formatted = _MARKDOWN_FENCE_PATTERN.sub("", formatted)
    formatted = (
        formatted.replace("**", "")
        .replace("__", "")
        .replace("~~", "")
        .replace("`", "")
    )
    formatted = re.sub(r"\n{3,}", "\n\n", formatted).strip()
    return formatted or None


def transcript_attachment_to_schema(
    attachment: AgentTranscriptAttachment,
    *,
    api_prefix: str,
) -> AgentTranscriptAttachmentRead:
    return AgentTranscriptAttachmentRead(
        id=attachment.id,
        transcript_message_id=attachment.transcript_message_id,
        display_name=attachment_display_name(attachment),
        mime_type=attachment.mime_type,
        file_path=attachment.file_path,
        attachment_url=f"{api_prefix}/agent/attachments/{attachment.id}",
        created_at=attachment.created_at,
    )


def _tool_call_payload_fields(
    tool_call: AgentToolCall,
    *,
    include_payload: bool,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None, dict[str, Any] | None]:
    result_payload = tool_call.result_content_json if isinstance(tool_call.result_content_json, dict) else None
    input_json = dict(tool_call.arguments_json) if include_payload else None
    output_json: dict[str, Any] | None = None
    output_text: str | None = None
    display_output_json: dict[str, Any] | None = None
    if include_payload and isinstance(result_payload, dict):
        nested_output = result_payload.get("output_json")
        if isinstance(nested_output, dict):
            output_json = dict(nested_output)
            display_output_json = output_json
        elif "summary" in result_payload:
            output_json = dict(result_payload)
            display_output_json = output_json
        content = result_payload.get("content")
        if isinstance(content, str):
            output_text = content
    return input_json, output_json, output_text, display_output_json


def tool_call_to_schema(tool_call: AgentToolCall, *, include_payload: bool = True) -> AgentToolCallRead:
    input_json, output_json, output_text, display_output_json = _tool_call_payload_fields(
        tool_call,
        include_payload=include_payload,
    )
    display = build_tool_call_display(
        tool_call.tool_name,
        input_json=tool_call.arguments_json,
        output_json=display_output_json,
    )
    return AgentToolCallRead(
        id=tool_call.id,
        run_id=tool_call.run_id,
        step_id=tool_call.step_id,
        call_index=tool_call.call_index,
        tool_request_id=tool_call.tool_request_id,
        tool_name=tool_call.tool_name,
        display_label=display.label,
        display_detail=display.detail,
        arguments_json=input_json,
        result_content_json=output_json if include_payload else None,
        input_json=input_json,
        output_json=output_json,
        output_text=output_text,
        has_full_payload=include_payload,
        status=tool_call.status,
        error_code=tool_call.error_code,
        started_at=tool_call.started_at,
        completed_at=tool_call.completed_at,
    )


def step_to_schema(
    step: AgentStep,
    *,
    tool_calls_by_step: dict[str, list[AgentToolCall]],
    include_tool_payload: bool = True,
) -> AgentStepRead:
    step_tool_calls = sorted(
        tool_calls_by_step.get(step.id, []),
        key=lambda call: call.call_index,
    )
    assistant_message = getattr(step, "assistant_message", None)
    reasoning_text = (
        str(assistant_message.reasoning_text).strip() or None
        if assistant_message is not None and assistant_message.reasoning_text
        else None
    )
    return AgentStepRead(
        id=step.id,
        run_id=step.run_id,
        step_index=step.step_index,
        status=step.status,
        reasoning_text=reasoning_text,
        progress_note=None,
        reasoning_duration_ms=None,
        finish_reason=step.finish_reason,
        latency_ms=step.latency_ms,
        input_tokens=step.input_tokens,
        output_tokens=step.output_tokens,
        cache_read_tokens=step.cache_read_tokens,
        cache_write_tokens=step.cache_write_tokens,
        created_at=step.created_at,
        tool_calls=[
            tool_call_to_schema(call, include_payload=include_tool_payload)
            for call in step_tool_calls
        ],
    )


def run_event_to_schema(event: AgentRunEvent) -> AgentRunEventRead:
    return AgentRunEventRead(
        id=event.id,
        run_id=event.run_id,
        sequence_index=event.sequence_index,
        event_type=event.event_type,
        payload_json=dict(event.payload_json or {}),
        created_at=event.created_at,
    )


def run_usage_snapshot_for_stream(run: AgentRun) -> dict[str, Any]:
    costs = calculate_usage_costs(
        model_name=run.model_name,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        cache_read_tokens=run.cache_read_tokens,
        cache_write_tokens=run.cache_write_tokens,
    )
    return {
        "input_tokens": run.input_tokens,
        "output_tokens": run.output_tokens,
        "cache_read_tokens": run.cache_read_tokens,
        "cache_write_tokens": run.cache_write_tokens,
        "input_cost_usd": costs.input_cost_usd,
        "output_cost_usd": costs.output_cost_usd,
        "total_cost_usd": costs.total_cost_usd,
    }


def run_event_row_to_sse_payload(
    run: AgentRun,
    event: AgentRunEvent,
    *,
    include_run_usage: bool = False,
) -> dict[str, Any]:
    payload = dict(event.payload_json or {})
    event_type = event.event_type.value
    sse_payload: dict[str, Any] = {
        "type": event_type,
        "run_id": run.id,
        "sequence_index": event.sequence_index,
    }
    for key, value in payload.items():
        if key == "event_type":
            continue
        sse_payload[key] = value
    if include_run_usage:
        sse_payload["run_usage"] = run_usage_snapshot_for_stream(run)
    return sse_payload


def review_action_to_schema(action: AgentReviewAction) -> AgentReviewActionRead:
    return AgentReviewActionRead(
        id=action.id,
        change_item_id=action.change_item_id,
        action=action.action,
        actor=action.actor,
        note=action.note,
        created_at=action.created_at,
    )


def change_item_to_schema(item: AgentChangeItem) -> AgentChangeItemRead:
    return AgentChangeItemRead(
        id=item.id,
        run_id=item.run_id,
        change_type=item.change_type,
        payload_json=item.payload_json,
        status=item.status,
        review_note=item.review_note,
        applied_resource_type=item.applied_resource_type,
        applied_resource_id=item.applied_resource_id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        review_actions=[review_action_to_schema(action) for action in item.review_actions],
    )


def _serializable_change_items(run: AgentRun) -> list[AgentChangeItem]:
    supported_items: list[AgentChangeItem] = []
    for item in run.change_items:
        if is_supported_agent_change_type(item.change_type):
            supported_items.append(item)
            continue
        logger.warning(
            "Skipping unsupported agent change item from API response: scope=agent_run_serializer run_id=%s change_item_id=%s change_type=%s status=%s",
            run.id,
            item.id,
            item.change_type.name,
            item.status.value,
        )
    return supported_items


def _final_assistant_content(run: AgentRun) -> str | None:
    if run.status != AgentRunStatus.COMPLETED:
        return None
    if run.final_transcript_message_id:
        for row in run.transcript_messages:
            if row.id != run.final_transcript_message_id:
                continue
            return clean_final_assistant_content(content_markdown_from_transcript_row(row))
    assistant_rows = [
        row
        for row in sorted(run.transcript_messages, key=lambda item: item.sequence_index)
        if row.role.value == "assistant"
    ]
    if not assistant_rows:
        return None
    return clean_final_assistant_content(content_markdown_from_transcript_row(assistant_rows[-1]))


def run_to_schema(
    run: AgentRun,
    *,
    include_tool_payload: bool = True,
    origin: str | None = None,
) -> AgentRunRead:
    costs = calculate_usage_costs(
        model_name=run.model_name,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        cache_read_tokens=run.cache_read_tokens,
        cache_write_tokens=run.cache_write_tokens,
    )
    reply_origin = origin or run.origin or "app"
    tool_calls_by_step: dict[str, list[AgentToolCall]] = {}
    for tool_call in run.tool_calls:
        tool_calls_by_step.setdefault(tool_call.step_id, []).append(tool_call)
    return AgentRunRead(
        id=run.id,
        thread_id=run.thread_id or "",
        turn_index=run.turn_index,
        status=run.status,
        model_name=run.model_name,
        approval_policy=run.approval_policy,
        origin=reply_origin,
        final_assistant_reply=_format_terminal_assistant_reply(
            _final_assistant_content(run),
            origin=reply_origin,
        ),
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        cache_read_tokens=run.cache_read_tokens,
        cache_write_tokens=run.cache_write_tokens,
        input_cost_usd=costs.input_cost_usd,
        output_cost_usd=costs.output_cost_usd,
        total_cost_usd=costs.total_cost_usd,
        error_code=run.error_code,
        error_detail=run.error_detail,
        created_at=run.created_at,
        completed_at=run.completed_at,
        steps=[
            step_to_schema(
                step,
                tool_calls_by_step=tool_calls_by_step,
                include_tool_payload=include_tool_payload,
            )
            for step in sorted(run.steps, key=lambda item: item.step_index)
        ],
        events=[run_event_to_schema(event) for event in run.events],
        tool_calls=[
            tool_call_to_schema(call, include_payload=include_tool_payload)
            for call in sorted(run.tool_calls, key=lambda item: item.call_index)
        ],
        change_items=[change_item_to_schema(item) for item in _serializable_change_items(run)],
    )


def thread_to_schema(
    thread: AgentThread,
    *,
    initiated_by_external_agent: bool = False,
) -> AgentThreadRead:
    return AgentThreadRead(
        id=thread.id,
        title=thread.title,
        summary=thread.summary,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        initiated_by_external_agent=initiated_by_external_agent,
    )


def thread_summary_to_schema(
    thread: AgentThread,
    *,
    last_message_preview: str | None,
    pending_change_count: int,
    has_running_run: bool,
    initiated_by_external_agent: bool = False,
) -> AgentThreadSummaryRead:
    return AgentThreadSummaryRead(
        id=thread.id,
        title=thread.title,
        summary=thread.summary,
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        last_message_preview=last_message_preview,
        pending_change_count=pending_change_count,
        has_running_run=has_running_run,
        initiated_by_external_agent=initiated_by_external_agent,
    )
