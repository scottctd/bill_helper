# CALLING SPEC:
# - Purpose: single-worker agent run streaming with subscriber fan-out and reconnect replay.
# - Inputs: run ids, DB session factory, after_sequence cursors, and a registered run executor.
# - Outputs: hub publish/subscribe helpers and `iter_run_stream_hub_events`.
# - Side effects: in-process threads, queues, and ephemeral model_delta buffers per run id.
# - Constraint: in-memory hub state requires a single uvicorn worker process (see agent_subsystem.md).
from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import AgentRunStatus
from backend.models_agent import AgentRun
from backend.services.agent.error_policy import report_recoverable_error
from backend.services.agent.run_observers import fail_run_terminally
from backend.services.agent.serializers import run_event_row_to_sse_payload
from backend.services.agent.stream_sequences import (
    HUB_SEQUENCE_KEY,
    StreamSequenceState,
    fanout_to_subscribers,
    is_terminal_sse_payload,
    prepare_publish,
    public_stream_payload,
    should_skip_live_event,
)

logger = logging.getLogger(__name__)

RunExecutor = Callable[[Session, str], Any]

_SENTINEL = object()
_SUBSCRIBER_POLL_SECONDS = 30.0

_registered_run_executor: RunExecutor | None = None


def register_run_executor(executor: RunExecutor) -> None:
    global _registered_run_executor
    _registered_run_executor = executor


def _require_run_executor() -> RunExecutor:
    if _registered_run_executor is None:
        raise RuntimeError("stream hub run executor is not registered")
    return _registered_run_executor


@dataclass
class _ActiveRunExecution:
    run_id: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    subscribers: list[queue.Queue[Any]] = field(default_factory=list)
    sequence_state: StreamSequenceState = field(default_factory=StreamSequenceState)
    worker_started: bool = False
    worker_thread: threading.Thread | None = None


_registry_lock = threading.Lock()
_executions: dict[str, _ActiveRunExecution] = {}


def _get_or_create_execution(run_id: str) -> _ActiveRunExecution:
    with _registry_lock:
        execution = _executions.get(run_id)
        if execution is None:
            execution = _ActiveRunExecution(run_id=run_id)
            _executions[run_id] = execution
        return execution


def publish_run_stream_event(run_id: str, payload: dict[str, Any]) -> None:
    execution = _get_or_create_execution(run_id)
    with execution.lock:
        event_copy = prepare_publish(execution.sequence_state, payload)
        fanout_to_subscribers(execution.subscribers, event_copy)


def close_run_stream_execution(run_id: str) -> None:
    with _registry_lock:
        execution = _executions.pop(run_id, None)
    if execution is None:
        return
    with execution.lock:
        for subscriber in list(execution.subscribers):
            subscriber.put(_SENTINEL, block=False)


def reset_run_stream_hub_for_tests() -> None:
    with _registry_lock:
        run_ids = list(_executions.keys())
    for run_id in run_ids:
        close_run_stream_execution(run_id)


def _stream_worker(run_id: str, session_factory: Callable[[], Session]) -> None:
    db = session_factory()
    try:
        _require_run_executor()(db, run_id, streaming=True)
    except Exception as exc:
        report_recoverable_error(
            scope="stream_hub.worker",
            error=exc,
            context={"run_id": run_id},
            log=logger,
        )
        logger.exception("agent stream worker failed run_id=%s", run_id)
        db.rollback()
        fail_run_terminally(
            db,
            run_id,
            code="worker_error",
            detail="background harness execution failed",
        )
    finally:
        db.close()
        close_run_stream_execution(run_id)


def start_run_stream_execution(
    run_id: str,
    *,
    session_factory: Callable[[], Session],
) -> None:
    execution = _get_or_create_execution(run_id)
    with execution.lock:
        if execution.worker_started and execution.worker_thread is not None and execution.worker_thread.is_alive():
            return
        execution.worker_started = True
        thread = threading.Thread(
            target=_stream_worker,
            kwargs={"run_id": run_id, "session_factory": session_factory},
            daemon=True,
        )
        execution.worker_thread = thread
        thread.start()


def _register_subscriber(execution: _ActiveRunExecution) -> queue.Queue[Any]:
    subscriber: queue.Queue[Any] = queue.Queue()
    with execution.lock:
        execution.subscribers.append(subscriber)
    return subscriber


def _unregister_subscriber(execution: _ActiveRunExecution, subscriber: queue.Queue[Any]) -> None:
    with execution.lock:
        if subscriber in execution.subscribers:
            execution.subscribers.remove(subscriber)


def _load_run_for_replay(db: Session, run_id: str) -> AgentRun | None:
    return db.scalar(
        select(AgentRun)
        .where(AgentRun.id == run_id)
        .options(selectinload(AgentRun.events))
    )


def _replay_persisted_events(
    db: Session,
    run_id: str,
    after_sequence: int,
) -> Iterator[dict[str, Any]]:
    run = _load_run_for_replay(db, run_id)
    if run is None:
        return

    include_usage = run.status == AgentRunStatus.RUNNING
    for event_row in sorted(run.events, key=lambda row: row.sequence_index):
        if event_row.sequence_index <= after_sequence:
            continue
        yield run_event_row_to_sse_payload(
            run,
            event_row,
            include_run_usage=include_usage,
        )


def _is_run_terminal(db: Session, run_id: str) -> bool:
    run = db.get(AgentRun, run_id)
    if run is None:
        return True
    return run.status != AgentRunStatus.RUNNING


def iter_run_stream_hub_events(
    db: Session,
    run_id: str,
    *,
    after_sequence: int,
    session_factory: Callable[[], Session],
) -> Iterator[dict[str, Any]]:
    execution = _get_or_create_execution(run_id)
    subscriber = _register_subscriber(execution)
    seen_hub_sequences: set[int] = set()
    last_durable_sequence = after_sequence
    try:
        for event in _replay_persisted_events(db, run_id, after_sequence):
            sequence = event.get("sequence_index")
            if isinstance(sequence, int):
                last_durable_sequence = max(last_durable_sequence, sequence)
            yield event

        if _is_run_terminal(db, run_id):
            return

        with execution.lock:
            ephemeral = [dict(item) for item in execution.sequence_state.ephemeral_events]
        for event in ephemeral:
            hub_sequence = event.get(HUB_SEQUENCE_KEY)
            if isinstance(hub_sequence, int):
                seen_hub_sequences.add(hub_sequence)
            yield public_stream_payload(event)

        start_run_stream_execution(run_id, session_factory=session_factory)

        while True:
            try:
                item = subscriber.get(timeout=_SUBSCRIBER_POLL_SECONDS)
            except queue.Empty:
                if _is_run_terminal(db, run_id):
                    return
                continue
            if item is _SENTINEL:
                return
            skip, last_durable_sequence = should_skip_live_event(
                item,
                seen_hub_sequences=seen_hub_sequences,
                last_durable_sequence=last_durable_sequence,
            )
            if skip:
                continue
            public_item = public_stream_payload(item)
            yield public_item
            if is_terminal_sse_payload(public_item):
                return
    finally:
        _unregister_subscriber(execution, subscriber)
