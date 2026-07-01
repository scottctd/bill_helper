# CALLING SPEC:
# - Purpose: compose production AgentHarness with DB, model gateway, tools, events, and observers.
# - Inputs: SQLAlchemy session, RunRequest or run_id for resume/stream execution.
# - Outputs: RunResult; streaming via harness event sink fan-out.
# - Side effects: persists canonical run state, publishes operational events, invokes RunObservers.
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentRunStatus
from backend.models_agent import AgentRun, AgentThread
from backend.services.agent.harness.contracts import (
    HarnessApprovalPolicy,
    HarnessPrincipal,
    HarnessRunOrigin,
    PreparedStep,
    RunRequest,
    RunResult,
    RunState,
)
from backend.services.agent.harness.events import FanOutEventSink
from backend.services.agent.harness.harness import AgentHarness
from backend.services.agent.harness.repository import RunRepository
from backend.services.agent.harness.tools import ToolExecutionContext, ToolExecutionResult
from backend.services.agent.model_gateway import LiteLLMModelGateway, StreamingLiteLLMModelGateway
from backend.services.agent.production_repository import (
    DbEventSink,
    SqlAlchemyRunRepository,
    tool_definitions_from_catalog,
)
from backend.services.agent.production_tools import ProductionToolExecutor
from backend.services.agent.run_observers import (
    fail_run_terminally,
    notify_production_run_terminal_observers,
    run_result_from_agent_run_row,
)
from backend.services.agent.stream_hub import publish_run_stream_event, register_run_executor
from backend.services.agent.tool_runtime_support.catalog import TOOLS
from backend.services.crud_policy import PolicyViolation


class TerminalObservingRunRepository:
    def __init__(self, inner: SqlAlchemyRunRepository, db: Session) -> None:
        self._inner = inner
        self._db = db

    def create(self, request: RunRequest) -> RunState:
        return self._inner.create(request)

    def load(self, run_id: str) -> RunState:
        return self._inner.load(run_id)

    def prepare_step(self, previous_state: RunState, prepared_step: PreparedStep) -> RunState:
        return self._inner.prepare_step(previous_state, prepared_step)

    def mark_tool_running(self, run_id: str, tool_call_id: str) -> RunState:
        return self._inner.mark_tool_running(run_id, tool_call_id)

    def commit_tool_result(
        self,
        run_id: str,
        tool_call_id: str,
        result: ToolExecutionResult,
    ) -> RunState:
        return self._inner.commit_tool_result(run_id, tool_call_id, result)

    def finalize_step(self, run_id: str, step_id: str) -> RunState:
        return self._inner.finalize_step(run_id, step_id)

    def finish(self, run_result: RunResult) -> bool:
        applied = self._inner.finish(run_result)
        if applied:
            notify_production_run_terminal_observers(self._db, run_result)
        return applied

    def ensure_run_finished_event(self, run_result: RunResult) -> None:
        self._inner.ensure_run_finished_event(run_result)

    def request_stop(self, run_id: str) -> None:
        self._inner.request_stop(run_id)

    def finalize_interrupt(self, run_id: str, *, detail: str = "run interrupted by user") -> bool:
        return self._inner.finalize_interrupt(run_id, detail=detail)


class DbStopSignal:
    def __init__(self, db: Session) -> None:
        self._db = db

    def is_stop_requested(self, run_id: str) -> bool:
        row = self._db.execute(
            select(AgentRun.stop_requested, AgentRun.status).where(AgentRun.id == run_id)
        ).one_or_none()
        if row is None:
            return False
        stop_requested, status = row
        return bool(stop_requested) or status != AgentRunStatus.RUNNING


class DbBoundProductionToolExecutor:
    def __init__(self, db: Session) -> None:
        self._db = db
        self._inner = ProductionToolExecutor()

    def execute(self, request, context: ToolExecutionContext):
        bound_context = ToolExecutionContext(
            principal=context.principal,
            run_id=context.run_id,
            thread_id=context.thread_id,
            approval_policy=context.approval_policy,
            metadata=dict(context.metadata),
            db=self._db,
        )
        return self._inner.execute(request, bound_context)


class StreamPublishingEventSink:
    def __init__(self, run_id: str, *, db_sink: DbEventSink) -> None:
        self._run_id = run_id
        self._db_sink = db_sink

    def publish(self, event: Any) -> None:
        from backend.services.agent.production_events import harness_event_to_sse_payload

        payload = harness_event_to_sse_payload(event)
        if payload is not None:
            if payload["type"] != "model_delta" and self._db_sink.last_published_sequence is not None:
                payload["sequence_index"] = self._db_sink.last_published_sequence
            publish_run_stream_event(self._run_id, payload)


def build_run_repository(db: Session) -> RunRepository:
    return TerminalObservingRunRepository(SqlAlchemyRunRepository(db), db)


def build_harness(
    db: Session,
    *,
    run_id: str,
    streaming: bool = False,
    step_index: int = 0,
) -> AgentHarness:
    repository = build_run_repository(db)
    db_sink = DbEventSink(db, run_id)
    stream_sink = StreamPublishingEventSink(run_id, db_sink=db_sink)
    event_sink = FanOutEventSink([db_sink, stream_sink])
    gateway = (
        StreamingLiteLLMModelGateway(db, event_sink=event_sink, step_index=step_index, run_id=run_id)
        if streaming
        else LiteLLMModelGateway(db)
    )
    return AgentHarness(
        repository=repository,
        model_gateway=gateway,
        tool_executor=DbBoundProductionToolExecutor(db),
        event_sink=event_sink,
        stop_signal=DbStopSignal(db),
    )


def initialize_harness_run(
    db: Session,
    *,
    thread: AgentThread,
    transcript: list,
    owned_transcript: list | None = None,
    model_name: str,
    surface: str,
    approval_policy: HarnessApprovalPolicy,
    principal: HarnessPrincipal,
    max_steps: int = 20,
    turn_index: int | None = None,
    metadata: dict[str, Any] | None = None,
    run_id: str | None = None,
) -> AgentRun:
    from backend.services.agent.harness.contracts import HarnessModelConfig
    from backend.services.agent.runtime import ensure_agent_available

    ensure_agent_available(db, model_name=model_name)
    resolved_run_id = run_id or str(uuid.uuid4())
    request = RunRequest(
        run_id=resolved_run_id,
        thread_id=thread.id,
        turn_index=turn_index,
        principal=principal,
        initial_transcript=transcript,
        owned_transcript=owned_transcript or transcript,
        model_params=HarnessModelConfig(model_name=model_name),
        tool_catalog=tool_definitions_from_catalog(list(TOOLS.values())),
        max_steps=max_steps,
        approval_policy=approval_policy,
        origin=HarnessRunOrigin(surface=surface),
        metadata=metadata or {},
    )
    SqlAlchemyRunRepository(db).create(request)
    run_row = db.get(AgentRun, resolved_run_id)
    if run_row is None:
        raise RuntimeError(f"run not persisted: {resolved_run_id}")
    return run_row


def execute_harness_run(db: Session, run_id: str, *, streaming: bool = True) -> RunResult:
    harness = build_harness(db, run_id=run_id, streaming=streaming)
    return harness.resume(run_id)


def notify_worker_failure_terminal(db: Session, run_id: str) -> None:
    fail_run_terminally(
        db,
        run_id,
        code="worker_error",
        detail="background harness execution failed",
    )


def start_harness_run(
    db: Session,
    *,
    thread: AgentThread,
    transcript: list,
    model_name: str,
    surface: str,
    approval_policy: HarnessApprovalPolicy,
    principal: HarnessPrincipal,
    max_steps: int = 20,
    turn_index: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> AgentRun:
    run_row = initialize_harness_run(
        db,
        thread=thread,
        transcript=transcript,
        model_name=model_name,
        surface=surface,
        approval_policy=approval_policy,
        principal=principal,
        max_steps=max_steps,
        turn_index=turn_index,
        metadata=metadata,
    )
    execute_harness_run(db, run_row.id, streaming=True)
    db.refresh(run_row)
    return run_row


def resume_harness_run(db: Session, run_id: str, *, streaming: bool = True) -> RunResult:
    run_row = db.get(AgentRun, run_id)
    if run_row is None:
        raise PolicyViolation.not_found(f"run not found: {run_id}")
    if run_row.status != AgentRunStatus.RUNNING:
        harness = build_harness(db, run_id=run_id, streaming=False)
        return harness.resume(run_id)
    harness = build_harness(db, run_id=run_id, streaming=streaming)
    return harness.resume(run_id)


def interrupt_harness_run(
    db: Session,
    run_id: str,
    *,
    detail: str = "run interrupted by user",
) -> AgentRun:
    run_row = db.get(AgentRun, run_id)
    if run_row is None:
        raise PolicyViolation.not_found("Run not found")
    if run_row.status != AgentRunStatus.RUNNING:
        return run_row
    repository = build_run_repository(db)
    if not repository.finalize_interrupt(run_id, detail=detail):
        return run_row
    db.refresh(run_row)
    notify_production_run_terminal_observers(
        db,
        run_result_from_agent_run_row(run_row, detail_override=detail),
        publish_run_finished_sse=True,
    )
    return run_row


register_run_executor(execute_harness_run)
