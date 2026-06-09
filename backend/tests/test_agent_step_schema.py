from types import SimpleNamespace
from datetime import datetime, timezone

from backend.enums_agent import AgentStepStatus
from backend.services.agent.serializers import step_to_schema


def test_step_to_schema_projects_assistant_reasoning() -> None:
    created_at = datetime(2026, 2, 15, 10, 0, tzinfo=timezone.utc)
    step = SimpleNamespace(
        id="step-1",
        run_id="run-1",
        step_index=1,
        status=AgentStepStatus.COMMITTED,
        finish_reason=None,
        latency_ms=120,
        input_tokens=10,
        output_tokens=5,
        cache_read_tokens=None,
        cache_write_tokens=None,
        created_at=created_at,
        assistant_message=SimpleNamespace(reasoning_text="Checking accounts before listing entries."),
    )

    schema = step_to_schema(step, tool_calls_by_step={})

    assert schema.reasoning_text == "Checking accounts before listing entries."
    assert schema.progress_note is None
