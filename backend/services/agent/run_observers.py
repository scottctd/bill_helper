# CALLING SPEC:
# - Purpose: production RunObserver implementations, terminal failure helper, and notification coordinator.
# - Inputs: SQLAlchemy session, RunResult, optional SSE publish flag for non-harness paths.
# - Outputs: none; invokes auto-approve, import scheduler, run_finished SSE, and terminal persistence.
# - Side effects: review auto-approval, import coordinator wake, stream hub publication, run row updates.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.enums_agent import AgentRunStatus
from backend.models_agent import AgentRun
from backend.services.agent.harness.contracts import (
    HarnessRunStatus,
    HarnessTerminalError,
    ModelUsage,
    RunFinishedEvent,
    RunResult,
)
from backend.services.agent.harness.run_observer import RunObserver
from backend.services.agent.production_events import harness_event_to_sse_payload
from backend.services.agent.production_repository import SqlAlchemyRunRepository


class YoloAutoApproveObserver:
    def on_run_terminal(
        self,
        db: Session,
        run_result: RunResult,
        *,
        publish_run_finished_sse: bool = False,
    ) -> None:
        del publish_run_finished_sse
        if run_result.status != HarnessRunStatus.COMPLETED:
            return
        run_row = db.get(AgentRun, run_result.run_id)
        if run_row is None:
            return
        from backend.services.agent.reviews.auto_approve_run import (
            maybe_auto_approve_after_completed_run,
        )

        maybe_auto_approve_after_completed_run(
            db,
            run_id=run_row.id,
            thread_id=run_row.thread_id or "",
            approval_policy=run_row.approval_policy,
        )


class ImportSchedulerObserver:
    def on_run_terminal(
        self,
        db: Session,
        run_result: RunResult,
        *,
        publish_run_finished_sse: bool = False,
    ) -> None:
        del db, publish_run_finished_sse
        from backend.services.import_workflow.scheduler import notify_agent_run_terminal

        notify_agent_run_terminal(run_result.run_id)


class RunFinishedStreamObserver:
    def on_run_terminal(
        self,
        db: Session,
        run_result: RunResult,
        *,
        publish_run_finished_sse: bool = False,
    ) -> None:
        del db
        if not publish_run_finished_sse:
            return
        payload = harness_event_to_sse_payload(
            RunFinishedEvent(
                run_id=run_result.run_id,
                status=run_result.status,
                final_assistant_content=run_result.final_assistant_content,
                terminal_error=run_result.terminal_error,
            )
        )
        if payload is None:
            return
        from backend.services.agent.stream_hub import publish_run_stream_event

        publish_run_stream_event(run_result.run_id, payload)


_PRODUCTION_RUN_OBSERVERS: tuple[RunObserver, ...] = (
    YoloAutoApproveObserver(),
    ImportSchedulerObserver(),
    RunFinishedStreamObserver(),
)


def notify_production_run_terminal_observers(
    db: Session,
    run_result: RunResult,
    *,
    publish_run_finished_sse: bool = False,
) -> None:
    for observer in _PRODUCTION_RUN_OBSERVERS:
        observer.on_run_terminal(
            db,
            run_result,
            publish_run_finished_sse=publish_run_finished_sse,
        )


def run_result_from_agent_run_row(
    run_row: AgentRun,
    *,
    detail_override: str | None = None,
) -> RunResult:
    terminal_error = None
    if run_row.error_code:
        terminal_error = HarnessTerminalError(
            code=run_row.error_code,
            detail=detail_override or run_row.error_detail or "",
        )
    final_content = None
    if run_row.final_transcript_message_id:
        for message in run_row.transcript_messages:
            if message.id == run_row.final_transcript_message_id:
                content_json = message.content_json or {}
                final_content = str(content_json.get("content") or "") or None
                break
    return RunResult(
        run_id=run_row.id,
        status=HarnessRunStatus(run_row.status.value),
        final_assistant_content=final_content,
        transcript=[],
        completed_steps=0,
        tool_calls=[],
        accumulated_usage=ModelUsage(),
        total_latency_ms=None,
        terminal_error=terminal_error,
    )


def run_result_for_worker_failure(run_id: str) -> RunResult:
    return RunResult(
        run_id=run_id,
        status=HarnessRunStatus.FAILED,
        final_assistant_content=None,
        transcript=[],
        completed_steps=0,
        tool_calls=[],
        accumulated_usage=ModelUsage(),
        total_latency_ms=None,
        terminal_error=HarnessTerminalError(
            code="worker_error",
            detail="background harness execution failed",
        ),
    )


def fail_run_terminally(
    db: Session,
    run_id: str,
    *,
    code: str,
    detail: str,
) -> None:
    run_row = db.get(AgentRun, run_id)
    if run_row is not None and run_row.status == AgentRunStatus.RUNNING:
        run_row.status = AgentRunStatus.FAILED
        run_row.error_code = code
        run_row.error_detail = detail
        db.add(run_row)
        db.commit()
    run_result = RunResult(
        run_id=run_id,
        status=HarnessRunStatus.FAILED,
        final_assistant_content=None,
        transcript=[],
        completed_steps=0,
        tool_calls=[],
        accumulated_usage=ModelUsage(),
        total_latency_ms=None,
        terminal_error=HarnessTerminalError(code=code, detail=detail),
    )
    repository = SqlAlchemyRunRepository(db)
    repository.ensure_run_finished_event(run_result)
    notify_production_run_terminal_observers(
        db,
        run_result,
        publish_run_finished_sse=True,
    )
