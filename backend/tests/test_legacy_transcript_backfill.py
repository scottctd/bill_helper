# CALLING SPEC:
# - Purpose: unit tests for legacy transcript port planning logic.
# - Inputs: synthetic LegacyAgentSnapshot fixtures.
# - Outputs: pytest assertions on transcript roles and turn_index assignment.
# - Side effects: none.
from __future__ import annotations

from datetime import datetime, timezone

from backend.services.agent.legacy_transcript_backfill import (
    LegacyAgentSnapshot,
    LegacyEventRow,
    LegacyMessageRow,
    LegacyRunRow,
    LegacyThreadRow,
    LegacyToolCallRow,
    plan_harness_backfill,
)
from backend.services.agent.legacy_transcript_backfill_apply import validate_harness_backfill
import pytest


def test_plan_backfill_builds_user_assistant_and_tool_rows():
    now = datetime.now(timezone.utc)
    thread_id = "thread-1"
    user_id = "user-msg-1"
    assistant_id = "assistant-msg-1"
    run_id = "run-1"
    tool_call_id = "tool-1"
    snapshot = LegacyAgentSnapshot(
        threads=[
            LegacyThreadRow(
                id=thread_id,
                owner_user_id="owner-1",
                title="Test",
                summary=None,
                created_at=now,
                updated_at=now,
            )
        ],
        messages=[
            LegacyMessageRow(
                id=user_id,
                thread_id=thread_id,
                role="USER",
                content_markdown="Hello",
                created_at=now,
            ),
            LegacyMessageRow(
                id=assistant_id,
                thread_id=thread_id,
                role="ASSISTANT",
                content_markdown="Done.",
                created_at=now,
            ),
        ],
        runs=[
            LegacyRunRow(
                id=run_id,
                thread_id=thread_id,
                user_message_id=user_id,
                assistant_message_id=assistant_id,
                status="COMPLETED",
                model_name="test/model",
                approval_policy="default",
                surface="app",
                input_tokens=10,
                output_tokens=5,
                cache_read_tokens=None,
                cache_write_tokens=None,
                input_cost_usd=None,
                output_cost_usd=None,
                total_cost_usd=None,
                error_text=None,
                created_at=now,
                completed_at=now,
            )
        ],
        tool_calls=[
            LegacyToolCallRow(
                id=tool_call_id,
                run_id=run_id,
                llm_tool_call_id="tc-1",
                tool_name="echo",
                input_json={"text": "hi"},
                output_json={"status": "ok"},
                output_text="echo:hi",
                status="OK",
                created_at=now,
                started_at=now,
                completed_at=now,
            )
        ],
        events=[
            LegacyEventRow(
                id="event-1",
                run_id=run_id,
                sequence_index=1,
                event_type="REASONING_UPDATE",
                source="MODEL_REASONING",
                message="thinking",
                tool_call_id=None,
                created_at=now,
            ),
            LegacyEventRow(
                id="event-2",
                run_id=run_id,
                sequence_index=2,
                event_type="TOOL_CALL_QUEUED",
                source="TOOL_CALL",
                message=None,
                tool_call_id=tool_call_id,
                created_at=now,
            ),
            LegacyEventRow(
                id="event-3",
                run_id=run_id,
                sequence_index=3,
                event_type="TOOL_CALL_COMPLETED",
                source="TOOL_CALL",
                message=None,
                tool_call_id=tool_call_id,
                created_at=now,
            ),
        ],
    )

    plan = plan_harness_backfill(snapshot)
    roles = [row.role for row in plan.transcript_messages]
    assert roles == ["USER", "ASSISTANT", "TOOL", "ASSISTANT"]
    assert plan.runs[0]["turn_index"] == 0
    assert plan.runs[0]["principal_user_id"] == "owner-1"
    assert plan.runs[0]["metadata_json"] == {}
    assert plan.runs[0]["final_transcript_message_id"] == plan.transcript_messages[-1].id
    assert len(plan.steps) == 1
    assert plan.steps[0]["status"] == "COMMITTED"
    assert len(plan.tool_calls) == 1
    assert plan.tool_calls[0]["arguments_json"] == {"text": "hi"}
    assert plan.tool_calls[0]["result_content_json"]["output_json"] == {"status": "ok"}
    assert [event["id"] for event in plan.events] == ["event-1", "event-2", "event-3"]
    validate_harness_backfill(snapshot, plan)


def test_backfill_refuses_to_drop_unported_conversation_messages():
    now = datetime.now(timezone.utc)
    snapshot = LegacyAgentSnapshot(
        threads=[
            LegacyThreadRow(
                id="thread-1",
                owner_user_id="owner-1",
                title=None,
                summary=None,
                created_at=now,
                updated_at=now,
            )
        ],
        messages=[
            LegacyMessageRow(
                id="orphan-message",
                thread_id="thread-1",
                role="USER",
                content_markdown="Do not lose me",
                created_at=now,
            )
        ],
    )

    plan = plan_harness_backfill(snapshot)

    with pytest.raises(RuntimeError, match="without losing legacy conversation messages"):
        validate_harness_backfill(snapshot, plan)
