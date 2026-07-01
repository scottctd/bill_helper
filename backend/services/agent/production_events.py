# CALLING SPEC:
# - Purpose: map harness events to SSE payloads with tool display enrichment.
# - Inputs: HarnessEvent instances from harness execution.
# - Outputs: client-facing SSE payload dicts; None for non-public events.
# - Side effects: none; stream hub publishes separately.
from __future__ import annotations

from typing import Any

from backend.services.agent.harness.contracts import ToolFinishedEvent, ToolStartedEvent
from backend.services.agent.tool_call_display import build_tool_call_display

_TOOL_EVENT_REFERENCE_FIELDS = frozenset({"arguments_json", "output_json"})


def enrich_harness_event_for_publication(event: Any) -> Any:
    if isinstance(event, ToolStartedEvent):
        if event.display_label is not None:
            return event
        display = build_tool_call_display(
            event.tool_name,
            input_json=event.arguments_json,
        )
        return event.model_copy(
            update={
                "display_label": display.label,
                "display_detail": display.detail,
            }
        )
    if isinstance(event, ToolFinishedEvent):
        if event.display_label is not None:
            return event
        display = build_tool_call_display(
            event.tool_name,
            input_json=event.arguments_json,
            output_json=event.output_json,
        )
        return event.model_copy(
            update={
                "display_label": display.label,
                "display_detail": display.detail,
            }
        )
    return event


def harness_event_public_payload(event: Any) -> dict[str, Any]:
    enriched = enrich_harness_event_for_publication(event)
    return enriched.model_dump(
        exclude={"event_type", *_TOOL_EVENT_REFERENCE_FIELDS},
    )


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
            **harness_event_public_payload(event),
        }
    return None
