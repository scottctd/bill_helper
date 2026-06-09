# CALLING SPEC:
# - Purpose: export canonical run/step/decision/tool trace from harness RunResult.
# - Inputs: RunResult and optional CollectingEventSink events.
# - Outputs: JSON-serializable trace dict for benchmarks and offline scoring.
# - Side effects: none.
from __future__ import annotations

from typing import Any

from backend.services.agent.harness.contracts import RunResult


def export_run_trace(result: RunResult, *, events: list[Any] | None = None) -> dict[str, Any]:
    return {
        "run_id": result.run_id,
        "status": result.status.value,
        "completed_steps": result.completed_steps,
        "final_assistant_content": result.final_assistant_content,
        "accumulated_usage": result.accumulated_usage.model_dump(),
        "terminal_error": result.terminal_error.model_dump() if result.terminal_error else None,
        "transcript": [record.model_dump() for record in result.transcript],
        "tool_calls": [record.model_dump() for record in result.tool_calls],
        "events": [event.model_dump() for event in (events or [])],
    }
