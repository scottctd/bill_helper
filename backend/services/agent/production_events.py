# CALLING SPEC:
# - Purpose: map harness events to SSE payloads and stream publication adapters.
# - Inputs: HarnessEvent instances from harness execution.
# - Outputs: client-facing SSE payload dicts; None for non-public events.
# - Side effects: none; stream hub publishes separately.
from __future__ import annotations

from typing import Any


def harness_event_to_sse_payload(event: Any) -> dict[str, Any] | None:
    event_type = str(getattr(event, "event_type", ""))
    if event_type == "model_delta":
        return {
            "type": "model_delta",
            "run_id": event.run_id,
            "delta_type": event.delta_type,
            "text": event.text,
            "step_index": event.step_index,
        }
    if event_type in {
        "model_decision_committed",
        "tool_started",
        "tool_finished",
        "run_finished",
        "run_started",
        "model_request_started",
        "step_committed",
    }:
        return {
            "type": event_type,
            **event.model_dump(exclude={"event_type"}),
        }
    return None
