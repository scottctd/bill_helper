from __future__ import annotations

import threading
import time

from backend.database import open_session
from backend.services.agent import stream_hub


def test_stream_hub_fanout_to_multiple_subscribers():
    stream_hub.reset_run_stream_hub_for_tests()
    run_id = "run-test-fanout"
    execution = stream_hub._get_or_create_execution(run_id)
    first = stream_hub._register_subscriber(execution)
    second = stream_hub._register_subscriber(execution)

    stream_hub.publish_run_stream_event(run_id, {"type": "reasoning_delta", "run_id": run_id, "delta": "Think"})
    stream_hub.publish_run_stream_event(run_id, {"type": "text_delta", "run_id": run_id, "delta": "done"})
    stream_hub.close_run_stream_execution(run_id)

    first_events = [first.get(timeout=1.0), first.get(timeout=1.0)]
    second_events = [second.get(timeout=1.0), second.get(timeout=1.0)]

    for events in (first_events, second_events):
        reasoning = "".join(event.get("delta", "") for event in events if event.get("type") == "reasoning_delta")
        text = "".join(event.get("delta", "") for event in events if event.get("type") == "text_delta")
        assert reasoning == "Think"
        assert text == "done"


def test_start_run_stream_execution_is_idempotent():
    stream_hub.reset_run_stream_hub_for_tests()
    run_id = "run-test-idempotent"
    started = threading.Event()

    def fake_worker(run_id: str, session_factory):
        started.set()
        time.sleep(0.2)
        stream_hub.close_run_stream_execution(run_id)

    original_worker = stream_hub._stream_worker
    stream_hub._stream_worker = fake_worker
    try:
        stream_hub.start_run_stream_execution(run_id, session_factory=open_session)
        stream_hub.start_run_stream_execution(run_id, session_factory=open_session)
        assert started.wait(timeout=1.0)
        execution = stream_hub._get_or_create_execution(run_id)
        assert execution.worker_thread is not None
        assert execution.worker_thread.is_alive()
    finally:
        stream_hub._stream_worker = original_worker
        stream_hub.reset_run_stream_hub_for_tests()
