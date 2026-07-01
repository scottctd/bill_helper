# CALLING SPEC:
# - Purpose: hub sequence numbers, ephemeral model_delta buffer, fan-out delivery, and reconnect dedupe.
# - Inputs: event payloads, StreamSequenceState, subscriber queues, replay cursors.
# - Outputs: sequenced payloads, skip/yield decisions for live replay, public SSE payloads.
# - Side effects: non-blocking (and optionally blocking) Queue.put on caller-owned subscriber queues.
#
# Drop policy:
# - Production subscriber queues are unbounded, so non-blocking put succeeds under normal load.
# - When a subscriber queue is bounded and full, ephemeral SSE types (model_delta) are dropped
#   with a debug log; durable SSE types never drop silently and fall back to blocking put.
# - The in-memory ephemeral buffer retains model_delta events until the next durable SSE type
#   clears it; reconnect replays persisted events first, then buffered ephemeral, then live fan-out.
from __future__ import annotations

import logging
import queue
from dataclasses import dataclass, field
from typing import Any

from backend.enums_agent import AgentRunStatus

logger = logging.getLogger(__name__)

HUB_SEQUENCE_KEY = "_hub_sequence"

EPHEMERAL_SSE_TYPES = frozenset({"model_delta"})
DURABLE_SSE_TYPES = frozenset(
    {
        "model_decision_committed",
        "tool_started",
        "tool_finished",
        "run_finished",
        "run_started",
        "model_request_started",
        "step_committed",
    }
)


@dataclass
class StreamSequenceState:
    next_hub_sequence: int = 0
    ephemeral_events: list[dict[str, Any]] = field(default_factory=list)


def event_sse_type(payload: dict[str, Any]) -> str:
    return str(payload.get("type") or "")


def is_ephemeral_sse_type(event_type: str) -> bool:
    return event_type in EPHEMERAL_SSE_TYPES


def is_durable_sse_type(event_type: str) -> bool:
    return event_type in DURABLE_SSE_TYPES


def prepare_publish(state: StreamSequenceState, payload: dict[str, Any]) -> dict[str, Any]:
    event_copy = dict(payload)
    state.next_hub_sequence += 1
    event_copy[HUB_SEQUENCE_KEY] = state.next_hub_sequence
    event_type = event_sse_type(event_copy)
    if is_durable_sse_type(event_type):
        state.ephemeral_events.clear()
    elif is_ephemeral_sse_type(event_type):
        state.ephemeral_events.append(event_copy)
    return event_copy


def fanout_to_subscribers(
    subscribers: list[queue.Queue[Any]],
    event: dict[str, Any],
) -> int:
    """Deliver one event to every subscriber queue; return count of dropped ephemeral events."""
    event_type = event_sse_type(event)
    dropped = 0
    for subscriber in list(subscribers):
        try:
            subscriber.put(event, block=False)
        except queue.Full:
            if is_ephemeral_sse_type(event_type):
                dropped += 1
                logger.debug(
                    "dropped ephemeral stream event on subscriber overflow",
                    extra={
                        "event_type": event_type,
                        "hub_sequence": event.get(HUB_SEQUENCE_KEY),
                    },
                )
                continue
            subscriber.put(event, block=True)
    return dropped


def public_stream_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if key != HUB_SEQUENCE_KEY}


def should_skip_live_event(
    item: dict[str, Any],
    *,
    seen_hub_sequences: set[int],
    last_durable_sequence: int,
) -> tuple[bool, int]:
    """Return (skip, updated_last_durable_sequence) for one live hub event."""
    updated_last_durable = last_durable_sequence
    hub_sequence = item.get(HUB_SEQUENCE_KEY)
    if isinstance(hub_sequence, int):
        if hub_sequence in seen_hub_sequences:
            return True, updated_last_durable
        seen_hub_sequences.add(hub_sequence)
    durable_sequence = item.get("sequence_index")
    if isinstance(durable_sequence, int):
        if durable_sequence <= last_durable_sequence:
            return True, updated_last_durable
        updated_last_durable = durable_sequence
    return False, updated_last_durable


def is_terminal_sse_payload(payload: dict[str, Any]) -> bool:
    if event_sse_type(payload) != "run_finished":
        return False
    status = str(payload.get("status") or "")
    return status in {
        AgentRunStatus.COMPLETED.value,
        AgentRunStatus.FAILED.value,
        AgentRunStatus.INTERRUPTED.value,
        AgentRunStatus.MAX_STEPS.value,
    }
