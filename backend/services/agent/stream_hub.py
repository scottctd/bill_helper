# CALLING SPEC:
# - Purpose: single-worker agent run streaming with subscriber fan-out and reconnect replay.
# - Inputs: run ids, DB session factory, and after_sequence cursors from stream routes.
# - Outputs: hub publish/subscribe helpers and `iter_run_stream_hub_events`.
# - Side effects: in-process threads, queues, and ephemeral delta buffers per run id.
from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from backend.enums_agent import AgentRunStatus
from backend.services.agent.runtime import run_existing_agent_run_stream
from backend.services.agent.runtime_state import events_after_sequence, load_run_snapshot
from backend.services.agent.runtime_support.lifecycle import resolve_existing_run
from backend.services.agent.serializers import stream_run_event_to_payload

_SENTINEL = object()
_EPHEMERAL_TYPES = frozenset({"reasoning_delta", "text_delta"})
_SUBSCRIBER_POLL_SECONDS = 30.0


@dataclass
class _ActiveRunExecution:
    run_id: str
    lock: threading.Lock = field(default_factory=threading.Lock)
    subscribers: list[queue.Queue[Any]] = field(default_factory=list)
    ephemeral_events: list[dict[str, Any]] = field(default_factory=list)
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
    event_copy = dict(payload)
    with execution.lock:
        event_type = str(event_copy.get("type") or "")
        if event_type == "run_event":
            execution.ephemeral_events.clear()
        elif event_type in _EPHEMERAL_TYPES:
            execution.ephemeral_events.append(event_copy)
        for subscriber in list(execution.subscribers):
            subscriber.put(event_copy, block=False)


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
        for event in run_existing_agent_run_stream(db, run_id):
            publish_run_stream_event(run_id, event)
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


def _replay_persisted_events(
    db: Session,
    run_id: str,
    after_sequence: int,
) -> Iterator[dict[str, Any]]:
    resolution = resolve_existing_run(db, run_id)
    if resolution.state == "missing" or resolution.run is None:
        return

    if resolution.state == "replay":
        for event_row in resolution.run.events:
            if event_row.sequence_index > after_sequence:
                yield stream_run_event_to_payload(
                    resolution.run,
                    event_row,
                    include_run_usage=False,
                )
        return

    if resolution.state == "failed_missing_thread":
        if resolution.terminal_event is not None and resolution.terminal_event.sequence_index > after_sequence:
            yield stream_run_event_to_payload(
                resolution.run,
                resolution.terminal_event,
                include_run_usage=False,
            )
        return

    run = load_run_snapshot(db, run_id)
    if run is None:
        return
    include_usage = run.status == AgentRunStatus.RUNNING
    for event_row in events_after_sequence(db, run_id, after_sequence):
        yield stream_run_event_to_payload(
            run,
            event_row,
            include_run_usage=include_usage,
        )


def _is_run_terminal(db: Session, run_id: str) -> bool:
    run = load_run_snapshot(db, run_id)
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
    try:
        for event in _replay_persisted_events(db, run_id, after_sequence):
            yield event

        if _is_run_terminal(db, run_id):
            return

        with execution.lock:
            ephemeral = [dict(item) for item in execution.ephemeral_events]
        for event in ephemeral:
            yield event

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
            yield item
            if str(item.get("type") or "") == "run_event":
                event_payload = item.get("event")
                if isinstance(event_payload, dict):
                    event_type = str(event_payload.get("event_type") or "")
                    if event_type in {"run_completed", "run_failed"}:
                        return
    finally:
        _unregister_subscriber(execution, subscriber)
