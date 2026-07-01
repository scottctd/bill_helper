from __future__ import annotations

import queue

from backend.services.agent.stream_sequences import (
    DURABLE_SSE_TYPES,
    EPHEMERAL_SSE_TYPES,
    HUB_SEQUENCE_KEY,
    StreamSequenceState,
    fanout_to_subscribers,
    prepare_publish,
    public_stream_payload,
    should_skip_live_event,
)


def test_replay_dedupes_live_events_against_persisted_sequence():
    seen_hub_sequences: set[int] = set()
    last_durable_sequence = 5

    skip_replayed, last_durable_sequence = should_skip_live_event(
        {"sequence_index": 4, HUB_SEQUENCE_KEY: 10},
        seen_hub_sequences=seen_hub_sequences,
        last_durable_sequence=last_durable_sequence,
    )
    assert skip_replayed is True
    assert last_durable_sequence == 5

    skip_duplicate_hub, last_durable_sequence = should_skip_live_event(
        {"sequence_index": 6, HUB_SEQUENCE_KEY: 11},
        seen_hub_sequences={11},
        last_durable_sequence=last_durable_sequence,
    )
    assert skip_duplicate_hub is True
    assert last_durable_sequence == 5

    skip_new, last_durable_sequence = should_skip_live_event(
        {"sequence_index": 7, HUB_SEQUENCE_KEY: 12},
        seen_hub_sequences=seen_hub_sequences,
        last_durable_sequence=last_durable_sequence,
    )
    assert skip_new is False
    assert last_durable_sequence == 7
    assert 12 in seen_hub_sequences


def test_ephemeral_buffer_replay_then_live_dedupe():
    state = StreamSequenceState()
    first = prepare_publish(state, {"type": "model_delta", "delta": "a"})
    second = prepare_publish(state, {"type": "model_delta", "delta": "b"})
    prepare_publish(state, {"type": "step_committed", "sequence_index": 3})

    assert len(state.ephemeral_events) == 0
    assert first[HUB_SEQUENCE_KEY] == 1
    assert second[HUB_SEQUENCE_KEY] == 2

    seen: set[int] = set()
    for event in [first, second]:
        hub_sequence = event[HUB_SEQUENCE_KEY]
        seen.add(hub_sequence)
        assert public_stream_payload(event) == {"type": "model_delta", "delta": event["delta"]}

    skip, _ = should_skip_live_event(
        first,
        seen_hub_sequences=seen,
        last_durable_sequence=3,
    )
    assert skip is True


def test_ephemeral_dropped_on_overflow_durable_never_dropped():
    state = StreamSequenceState()
    ephemeral = prepare_publish(state, {"type": "model_delta", "delta": "x"})
    durable = prepare_publish(state, {"type": "run_finished", "status": "completed", "sequence_index": 1})

    bounded = queue.Queue(maxsize=1)
    bounded.put({"type": "placeholder"}, block=False)

    dropped = fanout_to_subscribers([bounded], ephemeral)
    assert dropped == 1
    assert bounded.qsize() == 1

    bounded.get_nowait()
    fanout_to_subscribers([bounded], durable)
    assert bounded.get_nowait() == durable


def test_durable_sse_types_clear_ephemeral_buffer():
    state = StreamSequenceState()
    prepare_publish(state, {"type": "model_delta", "delta": "partial"})
    assert len(state.ephemeral_events) == 1
    prepare_publish(state, {"type": next(iter(DURABLE_SSE_TYPES)), "sequence_index": 1})
    assert state.ephemeral_events == []


def test_ephemeral_types_are_model_delta_only():
    assert EPHEMERAL_SSE_TYPES == frozenset({"model_delta"})
