# CALLING SPEC:
# - Purpose: one-time port of legacy agent_messages/runs into harness transcript rows.
# - Inputs: SQLAlchemy connection with pre-0045 agent tables populated.
# - Outputs: HarnessBackfillPlan rows for a lossless migration insert.
# - Side effects: none at import time; migration applies the plan after creating new tables.
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

CANCELLED_TOOL_RESULT_CONTENT = (
    "ERROR\n"
    "summary: tool call cancelled by user\n"
    "details: The tool call was cancelled before it completed."
)
_TERMINAL_EVENT_TYPES = frozenset({"RUN_STARTED", "RUN_COMPLETED", "RUN_FAILED"})
_TOOL_RESULT_EVENT_TYPES = frozenset(
    {"TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED", "TOOL_CALL_CANCELLED"}
)
_COMPLETED_TOOL_STATUSES = frozenset({"OK", "ERROR"})
_INCOMPLETE_TOOL_STATUSES = frozenset({"QUEUED", "RUNNING"})
_RESTORED_TOOL_STATUSES = _COMPLETED_TOOL_STATUSES | {"CANCELLED"}
@dataclass(slots=True)
class LegacyThreadRow:
    id: str
    owner_user_id: str
    title: str | None
    summary: str | None
    created_at: datetime
    updated_at: datetime
@dataclass(slots=True)
class LegacyMessageRow:
    id: str
    thread_id: str
    role: str
    content_markdown: str
    created_at: datetime
@dataclass(slots=True)
class LegacyAttachmentRow:
    id: str
    message_id: str
    user_file_id: str
    created_at: datetime
@dataclass(slots=True)
class LegacyRunRow:
    id: str
    thread_id: str
    user_message_id: str
    assistant_message_id: str | None
    status: str
    model_name: str
    approval_policy: str
    surface: str
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    input_cost_usd: float | None
    output_cost_usd: float | None
    total_cost_usd: float | None
    error_text: str | None
    created_at: datetime
    completed_at: datetime | None
@dataclass(slots=True)
class LegacyToolCallRow:
    id: str
    run_id: str
    llm_tool_call_id: str | None
    tool_name: str
    input_json: dict[str, Any]
    output_json: dict[str, Any]
    output_text: str
    status: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


@dataclass(slots=True)
class LegacyEventRow:
    id: str
    run_id: str
    sequence_index: int
    event_type: str
    source: str | None
    message: str | None
    tool_call_id: str | None
    created_at: datetime


@dataclass(slots=True)
class LegacySessionSourceRow:
    id: str
    thread_id: str
    user_file_id: str
    note: str | None
    created_at: datetime


@dataclass(slots=True)
class LegacyChangeItemRow:
    id: str
    run_id: str
    change_type: str
    payload_json: dict[str, Any]
    status: str
    review_note: str | None
    applied_resource_type: str | None
    applied_resource_id: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(slots=True)
class LegacyReviewActionRow:
    id: str
    change_item_id: str
    action: str
    actor: str
    note: str | None
    created_at: datetime


@dataclass(slots=True)
class LegacyAgentSnapshot:
    threads: list[LegacyThreadRow] = field(default_factory=list)
    messages: list[LegacyMessageRow] = field(default_factory=list)
    attachments: list[LegacyAttachmentRow] = field(default_factory=list)
    runs: list[LegacyRunRow] = field(default_factory=list)
    tool_calls: list[LegacyToolCallRow] = field(default_factory=list)
    events: list[LegacyEventRow] = field(default_factory=list)
    session_sources: list[LegacySessionSourceRow] = field(default_factory=list)
    change_items: list[LegacyChangeItemRow] = field(default_factory=list)
    review_actions: list[LegacyReviewActionRow] = field(default_factory=list)


@dataclass(slots=True)
class TranscriptInsertRow:
    id: str
    run_id: str
    sequence_index: int
    role: str
    content_json: dict[str, Any]
    reasoning_text: str | None
    tool_request_id: str | None
    tool_name: str | None
    created_at: datetime


@dataclass(slots=True)
class HarnessBackfillPlan:
    threads: list[LegacyThreadRow]
    runs: list[dict[str, Any]]
    transcript_messages: list[TranscriptInsertRow]
    transcript_attachments: list[LegacyAttachmentRow]
    steps: list[dict[str, Any]]
    tool_calls: list[dict[str, Any]]
    events: list[dict[str, Any]]
    session_sources: list[LegacySessionSourceRow]
    change_items: list[LegacyChangeItemRow]
    review_actions: list[LegacyReviewActionRow]


def _table_exists(connection: Connection, table_name: str) -> bool:
    return table_name in inspect(connection).get_table_names()


def _table_columns(connection: Connection, table_name: str) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns(table_name)}


def _select_rows(
    connection: Connection,
    table_name: str,
    *,
    columns: dict[str, Any],
) -> list[dict[str, Any]]:
    existing = _table_columns(connection, table_name)
    select_columns = [name for name in columns if name in existing]
    if not select_columns:
        return []
    sql = f"SELECT {', '.join(select_columns)} FROM {table_name}"
    rows: list[dict[str, Any]] = []
    for row in connection.execute(text(sql)).mappings():
        payload = dict(row)
        for name, default in columns.items():
            payload.setdefault(name, default)
        rows.append(payload)
    return rows


def _row_to_dict(row: Any) -> dict[str, Any]:
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


def _json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def export_legacy_agent_snapshot(connection: Connection) -> LegacyAgentSnapshot:
    if not _table_exists(connection, "agent_threads"):
        return LegacyAgentSnapshot()

    threads = [
        LegacyThreadRow(**row)
        for row in _select_rows(
            connection,
            "agent_threads",
            columns={
                "id": None,
                "owner_user_id": None,
                "title": None,
                "summary": None,
                "created_at": None,
                "updated_at": None,
            },
        )
    ]
    messages = [
        LegacyMessageRow(**_row_to_dict(row))
        for row in connection.execute(
            text(
                """
                SELECT id, thread_id, role, content_markdown, created_at
                FROM agent_messages
                """
            )
        ).mappings()
    ]
    attachments = []
    if _table_exists(connection, "agent_message_attachments"):
        attachments = [
            LegacyAttachmentRow(**row)
            for row in _select_rows(
                connection,
                "agent_message_attachments",
                columns={
                    "id": None,
                    "message_id": None,
                    "user_file_id": None,
                    "created_at": None,
                },
            )
        ]
    runs = [
        LegacyRunRow(**row)
        for row in _select_rows(
            connection,
            "agent_runs",
            columns={
                "id": None,
                "thread_id": None,
                "user_message_id": None,
                "assistant_message_id": None,
                "status": None,
                "model_name": None,
                "approval_policy": "default",
                "surface": "app",
                "input_tokens": None,
                "output_tokens": None,
                "cache_read_tokens": None,
                "cache_write_tokens": None,
                "input_cost_usd": None,
                "output_cost_usd": None,
                "total_cost_usd": None,
                "error_text": None,
                "created_at": None,
                "completed_at": None,
            },
        )
    ]
    tool_calls = []
    if _table_exists(connection, "agent_tool_calls"):
        tool_calls = [
            LegacyToolCallRow(
                **row
                | {
                    "input_json": _json_dict(row.get("input_json")),
                    "output_json": _json_dict(row.get("output_json")),
                }
            )
            for row in _select_rows(
                connection,
                "agent_tool_calls",
                columns={
                    "id": None,
                    "run_id": None,
                    "llm_tool_call_id": None,
                    "tool_name": None,
                    "input_json": {},
                    "output_json": {},
                    "output_text": "",
                    "status": None,
                    "created_at": None,
                    "started_at": None,
                    "completed_at": None,
                },
            )
        ]
    events = []
    if _table_exists(connection, "agent_run_events"):
        events = [
            LegacyEventRow(**row)
            for row in _select_rows(
                connection,
                "agent_run_events",
                columns={
                    "id": None,
                    "run_id": None,
                    "sequence_index": None,
                    "event_type": None,
                    "source": None,
                    "message": None,
                    "tool_call_id": None,
                    "created_at": None,
                },
            )
        ]
    session_sources = []
    if _table_exists(connection, "agent_session_sources"):
        session_sources = [
            LegacySessionSourceRow(**row)
            for row in _select_rows(
                connection,
                "agent_session_sources",
                columns={
                    "id": None,
                    "thread_id": None,
                    "user_file_id": None,
                    "note": None,
                    "created_at": None,
                },
            )
        ]
    change_items = []
    if _table_exists(connection, "agent_change_items"):
        change_items = [
            LegacyChangeItemRow(**row | {"payload_json": _json_dict(row.get("payload_json"))})
            for row in _select_rows(
                connection,
                "agent_change_items",
                columns={
                    "id": None,
                    "run_id": None,
                    "change_type": None,
                    "payload_json": {},
                    "status": None,
                    "review_note": None,
                    "applied_resource_type": None,
                    "applied_resource_id": None,
                    "created_at": None,
                    "updated_at": None,
                },
            )
        ]
    review_actions = []
    if _table_exists(connection, "agent_review_actions"):
        review_actions = [
            LegacyReviewActionRow(**row)
            for row in _select_rows(
                connection,
                "agent_review_actions",
                columns={
                    "id": None,
                    "change_item_id": None,
                    "action": None,
                    "actor": None,
                    "note": None,
                    "created_at": None,
                },
            )
        ]
    return LegacyAgentSnapshot(
        threads=threads,
        messages=messages,
        attachments=attachments,
        runs=runs,
        tool_calls=tool_calls,
        events=events,
        session_sources=session_sources,
        change_items=change_items,
        review_actions=review_actions,
    )


def _normalize_legacy_run_status(status: str, error_text: str | None) -> tuple[str, str | None, str | None]:
    key = (status or "").strip().lower()
    if key == "completed":
        return "COMPLETED", None, None
    if key == "running":
        return "FAILED", "stale_running", "Run was still running during schema migration."
    if key == "failed":
        if error_text and "interrupt" in error_text.lower():
            return "INTERRUPTED", "interrupted", error_text
        return "FAILED", "failed", error_text
    return "FAILED", "unknown_status", error_text or f"Unrecognized legacy status: {status}"


def _turn_index_by_user_message_id(messages: list[LegacyMessageRow]) -> dict[str, int]:
    by_thread: dict[str, list[LegacyMessageRow]] = {}
    for message in messages:
        if (message.role or "").upper() != "USER":
            continue
        by_thread.setdefault(message.thread_id, []).append(message)
    mapping: dict[str, int] = {}
    for thread_messages in by_thread.values():
        ordered = sorted(thread_messages, key=lambda row: row.created_at)
        for index, message in enumerate(ordered):
            mapping[message.id] = index
    return mapping


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


def _append_assistant_content(step: _StepDraft, message: str) -> None:
    normalized = message.strip()
    if not normalized:
        return
    if step.assistant_content.strip():
        step.assistant_content = f"{step.assistant_content}\n\n{normalized}"
    else:
        step.assistant_content = normalized


def _tool_call_is_restorable(tool_call: LegacyToolCallRow, *, run_status: str) -> bool:
    status = (tool_call.status or "").upper()
    if status in _RESTORED_TOOL_STATUSES:
        return True
    return status in _INCOMPLETE_TOOL_STATUSES and (run_status or "").upper() != "RUNNING"


def _tool_call_message(tool_call: LegacyToolCallRow) -> dict[str, Any]:
    return {
        "id": tool_call.id,
        "type": "function",
        "function": {
            "name": tool_call.tool_name,
            "arguments": json.dumps(tool_call.input_json, separators=(",", ":")),
        },
    }


def _tool_result_message(tool_call: LegacyToolCallRow) -> dict[str, Any]:
    status = (tool_call.status or "").upper()
    if status in _INCOMPLETE_TOOL_STATUSES | {"CANCELLED"}:
        content = CANCELLED_TOOL_RESULT_CONTENT
        is_error = True
    else:
        content = tool_call.output_text
        is_error = status == "ERROR"
    return {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "name": tool_call.tool_name,
        "content": content,
        "is_error": is_error,
    }


def _build_step_messages_from_events(
    run: LegacyRunRow,
    *,
    events: list[LegacyEventRow],
    tool_calls_by_id: dict[str, LegacyToolCallRow],
) -> list[dict[str, Any]]:
    ordered_events = sorted(events, key=lambda row: row.sequence_index)
    steps: list[_StepDraft] = []
    current = _StepDraft()

    for event in ordered_events:
        event_type = (event.event_type or "").upper()
        if event_type in _TERMINAL_EVENT_TYPES:
            continue
        if event_type == "REASONING_UPDATE":
            source = (event.source or "").upper()
            if source == "MODEL_REASONING" and current.has_content():
                steps.append(current)
                current = _StepDraft()
            if source == "MODEL_REASONING":
                current.model_reasoning = event.message or ""
            elif source in {"ASSISTANT_CONTENT", "TOOL_CALL"}:
                _append_assistant_content(current, event.message or "")
            continue
        if event_type == "TOOL_CALL_QUEUED":
            if event.tool_call_id:
                current.queued_tool_ids.append(event.tool_call_id)
            continue
        if event_type in _TOOL_RESULT_EVENT_TYPES:
            tool_call = tool_calls_by_id.get(event.tool_call_id or "")
            if tool_call is None:
                continue
            if (tool_call.status or "").upper() not in _RESTORED_TOOL_STATUSES:
                continue
            current.tool_results.append(_tool_result_message(tool_call))

    if current.has_content():
        result_ids = {message["tool_call_id"] for message in current.tool_results}
        for tool_call_id in current.queued_tool_ids:
            tool_call = tool_calls_by_id.get(tool_call_id)
            if tool_call is None:
                continue
            llm_id = tool_call.id
            if llm_id in result_ids:
                continue
            if _tool_call_is_restorable(tool_call, run_status=run.status):
                current.tool_results.append(_tool_result_message(tool_call))
        steps.append(current)

    messages: list[dict[str, Any]] = []
    for step in steps:
        tool_calls = []
        for tool_call_id in step.queued_tool_ids:
            tool_call = tool_calls_by_id.get(tool_call_id)
            if tool_call is None or not _tool_call_is_restorable(tool_call, run_status=run.status):
                continue
            tool_calls.append(_tool_call_message(tool_call))
        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": step.assistant_content,
        }
        if step.model_reasoning.strip():
            assistant_message["reasoning"] = step.model_reasoning
        if tool_calls:
            assistant_message["tool_calls"] = tool_calls
        if not step.model_reasoning.strip() and not step.assistant_content.strip() and not tool_calls:
            continue
        messages.append(assistant_message)
        messages.extend(step.tool_results)
    return messages


def _llm_message_to_transcript_rows(
    run_id: str,
    *,
    llm_messages: list[dict[str, Any]],
    created_at: datetime,
    start_sequence: int,
) -> list[TranscriptInsertRow]:
    rows: list[TranscriptInsertRow] = []
    sequence = start_sequence
    for message in llm_messages:
        role = str(message.get("role") or "")
        if role == "assistant":
            tool_requests = []
            for call in message.get("tool_calls") or []:
                function = call.get("function") or {}
                raw_args = function.get("arguments")
                if isinstance(raw_args, str):
                    try:
                        arguments_json = json.loads(raw_args)
                    except json.JSONDecodeError:
                        arguments_json = {}
                else:
                    arguments_json = _json_dict(raw_args)
                tool_requests.append(
                    {
                        "tool_request_id": str(call.get("id") or uuid.uuid4()),
                        "tool_name": str(function.get("name") or ""),
                        "arguments_json": arguments_json,
                    }
                )
            rows.append(
                TranscriptInsertRow(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    sequence_index=sequence,
                    role="ASSISTANT",
                    content_json={
                        "content": str(message.get("content") or ""),
                        "tool_requests": tool_requests,
                    },
                    reasoning_text=str(message.get("reasoning") or "").strip() or None,
                    tool_request_id=None,
                    tool_name=None,
                    created_at=created_at,
                )
            )
            sequence += 1
            continue
        if role == "tool":
            rows.append(
                TranscriptInsertRow(
                    id=str(uuid.uuid4()),
                    run_id=run_id,
                    sequence_index=sequence,
                    role="TOOL",
                    content_json={
                        "content": str(message.get("content") or ""),
                        "is_error": str(message.get("content") or "").startswith("ERROR"),
                    },
                    reasoning_text=None,
                    tool_request_id=str(message.get("tool_call_id") or ""),
                    tool_name=str(message.get("name") or ""),
                    created_at=created_at,
                )
            )
            sequence += 1
    return rows


def _build_run_transcript(
    run: LegacyRunRow,
    *,
    messages_by_id: dict[str, LegacyMessageRow],
    events: list[LegacyEventRow],
    tool_calls: list[LegacyToolCallRow],
) -> list[TranscriptInsertRow]:
    user_message = messages_by_id.get(run.user_message_id)
    if user_message is None:
        return []

    rows: list[TranscriptInsertRow] = [
        TranscriptInsertRow(
            id=run.user_message_id,
            run_id=run.id,
            sequence_index=0,
            role="USER",
            content_json={"content": user_message.content_markdown},
            reasoning_text=None,
            tool_request_id=None,
            tool_name=None,
            created_at=user_message.created_at,
        )
    ]

    tool_calls_by_id = {tool_call.id: tool_call for tool_call in tool_calls if tool_call.run_id == run.id}
    run_events = [event for event in events if event.run_id == run.id]
    llm_messages = _build_step_messages_from_events(
        run,
        events=run_events,
        tool_calls_by_id=tool_calls_by_id,
    )
    represented_tool_request_ids = {
        str(call.get("id") or "")
        for message in llm_messages
        for call in message.get("tool_calls") or []
    }
    for tool_call in sorted(tool_calls_by_id.values(), key=lambda row: row.created_at):
        tool_request_id = tool_call.id
        if tool_request_id in represented_tool_request_ids:
            continue
        if not _tool_call_is_restorable(tool_call, run_status=run.status):
            continue
        llm_messages.extend(
            [
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [_tool_call_message(tool_call)],
                },
                _tool_result_message(tool_call),
            ]
        )

    assistant_message = (
        messages_by_id.get(run.assistant_message_id) if run.assistant_message_id else None
    )
    final_content = (assistant_message.content_markdown or "").strip() if assistant_message else ""
    if final_content:
        if llm_messages and llm_messages[-1].get("role") == "assistant":
            last_assistant = llm_messages[-1]
            if not str(last_assistant.get("content") or "").strip():
                last_assistant["content"] = final_content
            else:
                llm_messages.append({"role": "assistant", "content": final_content})
        else:
            llm_messages.append({"role": "assistant", "content": final_content})

    rows.extend(
        _llm_message_to_transcript_rows(
            run.id,
            llm_messages=llm_messages,
            created_at=run.completed_at or run.created_at,
            start_sequence=1,
        )
    )
    if assistant_message is not None and final_content:
        assistant_rows = [row for row in rows if row.role == "ASSISTANT"]
        if assistant_rows:
            assistant_rows[-1].id = assistant_message.id
    return rows


def plan_harness_backfill(snapshot: LegacyAgentSnapshot) -> HarnessBackfillPlan:
    messages_by_id = {message.id: message for message in snapshot.messages}
    owner_user_id_by_thread = {
        thread.id: thread.owner_user_id for thread in snapshot.threads
    }
    turn_index_by_user = _turn_index_by_user_message_id(snapshot.messages)
    events_by_run: dict[str, list[LegacyEventRow]] = {}
    for event in snapshot.events:
        events_by_run.setdefault(event.run_id, []).append(event)
    tool_calls_by_run: dict[str, list[LegacyToolCallRow]] = {}
    for tool_call in snapshot.tool_calls:
        tool_calls_by_run.setdefault(tool_call.run_id, []).append(tool_call)

    transcript_messages: list[TranscriptInsertRow] = []
    run_rows: list[dict[str, Any]] = []

    for run in sorted(snapshot.runs, key=lambda row: row.created_at):
        status, error_code, error_detail = _normalize_legacy_run_status(run.status, run.error_text)
        transcript = _build_run_transcript(
            run,
            messages_by_id=messages_by_id,
            events=events_by_run.get(run.id, []),
            tool_calls=tool_calls_by_run.get(run.id, []),
        )
        transcript_messages.extend(transcript)
        final_assistant_id = None
        assistant_rows = [row for row in transcript if row.role == "ASSISTANT"]
        if status == "COMPLETED" and assistant_rows:
            final_assistant_id = assistant_rows[-1].id
        run_rows.append(
            {
                "id": run.id,
                "thread_id": run.thread_id,
                "turn_index": turn_index_by_user.get(run.user_message_id),
                "status": status,
                "model_name": run.model_name,
                "principal_user_id": owner_user_id_by_thread[run.thread_id],
                "principal_user_name": None,
                "metadata_json": {},
                "origin": (run.surface or "app").strip() or "app",
                "approval_policy": (run.approval_policy or "default").strip().lower() or "default",
                "max_steps": 20,
                "final_transcript_message_id": final_assistant_id,
                "input_tokens": run.input_tokens,
                "output_tokens": run.output_tokens,
                "cache_read_tokens": run.cache_read_tokens,
                "cache_write_tokens": run.cache_write_tokens,
                "input_cost_usd": run.input_cost_usd,
                "output_cost_usd": run.output_cost_usd,
                "total_cost_usd": run.total_cost_usd,
                "error_code": error_code,
                "error_detail": error_detail,
                "stop_requested": False,
                "created_at": run.created_at,
                "completed_at": run.completed_at,
            }
        )

    transcript_message_ids = {row.id for row in transcript_messages}
    transcript_attachments = [
        attachment
        for attachment in snapshot.attachments
        if attachment.message_id in transcript_message_ids
    ]
    from backend.services.agent.legacy_structured_backfill import (
        plan_legacy_structured_rows,
    )

    steps, tool_calls, events = plan_legacy_structured_rows(
        snapshot,
        transcript_messages=transcript_messages,
    )

    return HarnessBackfillPlan(
        threads=snapshot.threads,
        runs=run_rows,
        transcript_messages=transcript_messages,
        transcript_attachments=transcript_attachments,
        steps=steps,
        tool_calls=tool_calls,
        events=events,
        session_sources=snapshot.session_sources,
        change_items=snapshot.change_items,
        review_actions=snapshot.review_actions,
    )
