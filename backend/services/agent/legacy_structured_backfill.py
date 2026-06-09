# CALLING SPEC:
# - Purpose: port legacy tool calls and operational events into canonical harness tables.
# - Inputs: legacy snapshot rows and already-planned transcript rows.
# - Outputs: insert dictionaries for agent_steps, agent_tool_calls, and agent_run_events.
# - Side effects: none.
from __future__ import annotations

from typing import Any


def _canonical_tool_status(status: str) -> str:
    normalized = (status or "").upper()
    if normalized in {"OK", "ERROR", "CANCELLED"}:
        return normalized
    return "CANCELLED"


def _canonical_event_type(event_type: str) -> str:
    normalized = (event_type or "").upper()
    if normalized == "RUN_STARTED":
        return "RUN_STARTED"
    if normalized in {"RUN_COMPLETED", "RUN_FAILED"}:
        return "RUN_FINISHED"
    if normalized == "TOOL_CALL_QUEUED":
        return "MODEL_DECISION_COMMITTED"
    if normalized in {"TOOL_CALL_STARTED"}:
        return "TOOL_STARTED"
    if normalized in {"TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED", "TOOL_CALL_CANCELLED"}:
        return "TOOL_FINISHED"
    return "MODEL_DECISION_COMMITTED"


def _assistant_id_by_tool_request(transcript_messages: list[Any]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for row in transcript_messages:
        if row.role != "ASSISTANT":
            continue
        for request in row.content_json.get("tool_requests") or []:
            request_id = str(request.get("tool_request_id") or "")
            if request_id:
                mapping[request_id] = row.id
    return mapping


def plan_legacy_structured_rows(
    snapshot: Any,
    *,
    transcript_messages: list[Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    assistant_by_request = _assistant_id_by_tool_request(transcript_messages)
    steps: list[dict[str, Any]] = []
    tool_calls: list[dict[str, Any]] = []
    calls_by_run: dict[str, list[Any]] = {}
    for tool_call in snapshot.tool_calls:
        calls_by_run.setdefault(tool_call.run_id, []).append(tool_call)

    for run_id, run_calls in calls_by_run.items():
        for step_index, tool_call in enumerate(
            sorted(run_calls, key=lambda row: row.created_at),
            start=1,
        ):
            request_id = tool_call.id
            assistant_id = assistant_by_request.get(request_id)
            if assistant_id is None:
                raise RuntimeError(f"Cannot migrate tool call without assistant request: {tool_call.id}")
            status = _canonical_tool_status(tool_call.status)
            steps.append(
                {
                    "id": tool_call.id,
                    "run_id": run_id,
                    "step_index": step_index,
                    "assistant_transcript_message_id": assistant_id,
                    "status": "COMMITTED",
                    "input_tokens": None,
                    "output_tokens": None,
                    "cache_read_tokens": None,
                    "cache_write_tokens": None,
                    "finish_reason": "legacy_backfill",
                    "latency_ms": None,
                    "diagnostic_json": {
                        "legacy_tool_call_id": tool_call.id,
                        "legacy_llm_tool_call_id": tool_call.llm_tool_call_id,
                    },
                    "created_at": tool_call.created_at,
                }
            )
            tool_calls.append(
                {
                    "id": tool_call.id,
                    "run_id": run_id,
                    "step_id": tool_call.id,
                    "call_index": 0,
                    "tool_request_id": request_id,
                    "tool_name": tool_call.tool_name,
                    "arguments_json": tool_call.input_json,
                    "status": status,
                    "result_content_json": {
                        "content": tool_call.output_text,
                        "output_json": tool_call.output_json,
                        "legacy_status": tool_call.status,
                        "legacy_llm_tool_call_id": tool_call.llm_tool_call_id,
                    },
                    "error_code": status.lower() if status != "OK" else None,
                    "started_at": tool_call.started_at,
                    "completed_at": tool_call.completed_at,
                }
            )

    events = [
        {
            "id": event.id,
            "run_id": event.run_id,
            "sequence_index": event.sequence_index,
            "event_type": _canonical_event_type(event.event_type),
            "payload_json": {
                "legacy_event_type": event.event_type,
                "source": event.source,
                "message": event.message,
                "tool_call_id": event.tool_call_id,
            },
            "created_at": event.created_at,
        }
        for event in snapshot.events
    ]
    return steps, tool_calls, events
