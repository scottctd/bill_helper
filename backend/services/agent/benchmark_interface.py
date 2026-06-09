# CALLING SPEC:
# - Purpose: execute benchmark cases through production harness runtime and DB persistence.
# - Inputs: SQLAlchemy session, benchmark prompt text, and optional attachment file paths.
# - Outputs: BenchmarkCaseExecution with predictions, trace steps, and usage totals.
# - Side effects: creates thread/run rows and executes harness against production tools.
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentApprovalPolicy, AgentChangeType, AgentRunStatus, AgentTranscriptRole
from backend.models_agent import AgentChangeItem, AgentRun, AgentThread, AgentTranscriptMessage
from backend.models_finance import User
from backend.services.agent.attachments import create_transcript_attachment
from backend.services.agent.execution import _latest_user_transcript_message
from backend.services.agent.harness.contracts import HarnessApprovalPolicy, HarnessPrincipal
from backend.services.agent.production_runtime import execute_harness_run, initialize_harness_run
from backend.services.agent.thread_context import build_new_turn_transcript
from backend.services.runtime_settings import resolve_runtime_settings
from backend.services.user_files import SOURCE_TYPE_AGENT_ATTACHMENT, STORAGE_AREA_UPLOAD, import_user_file_from_path

BENCHMARK_ENTRY_NOTES_KEY = "markdown_notes"
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class BenchmarkAttachmentInput:
    file_path: str
    mime_type: str


@dataclass(slots=True)
class BenchmarkTraceStep:
    step: int
    messages_sent: list[dict[str, Any]]
    model_response: dict[str, Any]
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    wall_clock_ms: int = 0


@dataclass(slots=True)
class BenchmarkPredictionSet:
    tags: list[dict[str, Any]] = field(default_factory=list)
    entities: list[dict[str, Any]] = field(default_factory=list)
    entries: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class BenchmarkCaseExecution:
    run_status: str
    error: str | None
    predictions: BenchmarkPredictionSet
    trace_steps: list[BenchmarkTraceStep]
    total_usage: dict[str, int | None]
    total_wall_clock_ms: int
    final_assistant_content: str


def _predictions_from_change_items(change_items: list[AgentChangeItem]) -> BenchmarkPredictionSet:
    predictions = BenchmarkPredictionSet()
    for item in change_items:
        arguments = item.payload_json
        if item.change_type == AgentChangeType.CREATE_TAG:
            predictions.tags.append(
                {
                    "name": arguments.get("name"),
                    "type": arguments.get("type"),
                }
            )
        elif item.change_type == AgentChangeType.CREATE_ENTITY:
            predictions.entities.append(
                {
                    "name": arguments.get("name"),
                    "category": arguments.get("category"),
                }
            )
        elif item.change_type == AgentChangeType.CREATE_ENTRY:
            entry_prediction = {
                "kind": arguments.get("kind"),
                "date": arguments.get("date"),
                "name": arguments.get("name"),
                "amount_minor": arguments.get("amount_minor"),
                "currency_code": arguments.get("currency_code"),
                "from_entity": arguments.get("from_entity"),
                "to_entity": arguments.get("to_entity"),
                "tags": arguments.get("tags", []),
            }
            entry_prediction[BENCHMARK_ENTRY_NOTES_KEY] = arguments.get("markdown_notes")
            predictions.entries.append(entry_prediction)
    return predictions


def _trace_steps_from_run(run: AgentRun) -> list[BenchmarkTraceStep]:
    trace_steps: list[BenchmarkTraceStep] = []
    tool_calls_by_step = {step.id: [] for step in run.steps}
    for tool_call in run.tool_calls:
        tool_calls_by_step.setdefault(tool_call.step_id, []).append(tool_call)

    for step in sorted(run.steps, key=lambda item: item.step_index):
        assistant_row = next(
            (
                row
                for row in run.transcript_messages
                if row.id == step.assistant_transcript_message_id
            ),
            None,
        )
        assistant_content = ""
        if assistant_row is not None:
            assistant_content = str((assistant_row.content_json or {}).get("content") or "")
        trace_steps.append(
            BenchmarkTraceStep(
                step=step.step_index,
                messages_sent=[],
                model_response={
                    "content": assistant_content,
                    "usage": {
                        "input_tokens": step.input_tokens,
                        "output_tokens": step.output_tokens,
                        "cache_read_tokens": step.cache_read_tokens,
                        "cache_write_tokens": step.cache_write_tokens,
                    },
                },
                tool_results=[
                    {
                        "tool_name": tool_call.tool_name,
                        "input": tool_call.arguments_json,
                        "output": tool_call.result_content_json,
                        "status": tool_call.status.value,
                    }
                    for tool_call in sorted(
                        tool_calls_by_step.get(step.id, []),
                        key=lambda item: item.call_index,
                    )
                ],
                wall_clock_ms=step.latency_ms or 0,
            )
        )
    return trace_steps


def _final_assistant_content(run: AgentRun) -> str:
    if run.final_transcript_message_id:
        for row in run.transcript_messages:
            if row.id == run.final_transcript_message_id:
                return str((row.content_json or {}).get("content") or "")
    assistant_rows = [
        row
        for row in sorted(run.transcript_messages, key=lambda item: item.sequence_index)
        if row.role == AgentTranscriptRole.ASSISTANT
    ]
    if not assistant_rows:
        return ""
    return str((assistant_rows[-1].content_json or {}).get("content") or "")


def run_benchmark_case(
    db: Session,
    *,
    text: str,
    attachments: list[BenchmarkAttachmentInput],
) -> BenchmarkCaseExecution:
    settings = resolve_runtime_settings(db)
    owner_user = (
        db.scalar(select(User).where(User.is_admin.is_(True)).order_by(User.created_at.asc()).limit(1))
        or db.scalar(select(User).order_by(User.created_at.asc()).limit(1))
    )
    if owner_user is None:
        raise ValueError("Benchmark execution requires at least one persisted user.")

    thread = AgentThread(owner_user_id=owner_user.id)
    db.add(thread)
    db.flush()

    transcript = build_new_turn_transcript(
        db,
        thread_id=thread.id,
        user_content=text,
        surface="benchmark",
    )
    principal = HarnessPrincipal(user_id=owner_user.id, user_name=owner_user.name)
    overall_start = time.monotonic()
    run = initialize_harness_run(
        db,
        thread=thread,
        transcript=transcript,
        model_name=settings.agent_model,
        surface="benchmark",
        approval_policy=HarnessApprovalPolicy(AgentApprovalPolicy.DEFAULT.value),
        principal=principal,
        max_steps=max(settings.agent_max_steps, 1),
        turn_index=0,
    )

    user_message_row = _latest_user_transcript_message(db, run_id=run.id)
    if user_message_row is not None:
        for attachment in attachments:
            user_file = import_user_file_from_path(
                db,
                owner_user_id=owner_user.id,
                storage_area=STORAGE_AREA_UPLOAD,
                source_type=SOURCE_TYPE_AGENT_ATTACHMENT,
                source_path=Path(attachment.file_path),
                mime_type=attachment.mime_type,
                original_filename=Path(attachment.file_path).name,
                move_source=False,
            )
            create_transcript_attachment(
                db,
                transcript_message_id=user_message_row.id,
                user_file=user_file,
            )
    db.commit()

    execution_error: str | None = None
    try:
        execute_harness_run(db, run.id, streaming=False)
    except Exception as exc:
        logger.exception(
            "benchmark harness execution failed",
            extra={"run_id": run.id, "error_type": type(exc).__name__},
        )
        execution_error = str(exc)

    db.refresh(run)
    change_items = list(
        db.scalars(
            select(AgentChangeItem)
            .where(AgentChangeItem.run_id == run.id)
            .order_by(AgentChangeItem.created_at.asc())
        )
    )
    predictions = _predictions_from_change_items(change_items)
    total_wall_clock_ms = int((time.monotonic() - overall_start) * 1000)
    return BenchmarkCaseExecution(
        run_status=run.status.value,
        error=execution_error or run.error_detail,
        predictions=predictions,
        trace_steps=_trace_steps_from_run(run),
        total_usage={
            "input_tokens": run.input_tokens,
            "output_tokens": run.output_tokens,
            "cache_read_tokens": run.cache_read_tokens,
            "cache_write_tokens": run.cache_write_tokens,
        },
        total_wall_clock_ms=total_wall_clock_ms,
        final_assistant_content=_final_assistant_content(run),
    )
