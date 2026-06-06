# CALLING SPEC:
# - Purpose: verify append-only per-turn LLM context shaping for conversation history.
# - Inputs: pytest fixtures and direct calls into turn-context helpers.
# - Outputs: assertions on restored assistant/tool messages and interrupt steering.
# - Side effects: none.
from __future__ import annotations

import json

from backend.enums_agent import (
    AgentRunEventSource,
    AgentRunEventType,
    AgentToolCallStatus,
)
from backend.models_agent import AgentMessage, AgentRun, AgentRunEvent, AgentToolCall
from backend.services.agent.message_history_turn_context import (
    INTERRUPTED_TURN_STEERING_MESSAGE,
    build_turn_context_insert,
    build_turn_llm_messages,
)


def _run_with_events(*events: AgentRunEvent, tool_calls: list[AgentToolCall] | None = None) -> AgentRun:
    run = AgentRun(
        id="run-1",
        thread_id="thread-1",
        user_message_id="user-1",
        status="failed",
        model_name="test-model",
    )
    run.events = list(events)
    run.tool_calls = tool_calls or []
    return run


def _reasoning_event(
    *,
    sequence_index: int,
    message: str,
    source: AgentRunEventSource,
) -> AgentRunEvent:
    return AgentRunEvent(
        id=f"event-reasoning-{sequence_index}",
        run_id="run-1",
        sequence_index=sequence_index,
        event_type=AgentRunEventType.REASONING_UPDATE,
        source=source,
        message=message,
    )


def _tool_event(
    *,
    sequence_index: int,
    event_type: AgentRunEventType,
    tool_call_id: str,
) -> AgentRunEvent:
    return AgentRunEvent(
        id=f"event-tool-{sequence_index}",
        run_id="run-1",
        sequence_index=sequence_index,
        event_type=event_type,
        tool_call_id=tool_call_id,
    )


def test_build_turn_llm_messages_restores_reasoning_only_step() -> None:
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Checking January spend before summarizing.",
            source=AgentRunEventSource.MODEL_REASONING,
        )
    )

    messages = build_turn_llm_messages(run)

    assert messages == [
        {
            "role": "assistant",
            "content": "",
            "reasoning": "Checking January spend before summarizing.",
        }
    ]


def test_build_turn_llm_messages_restores_completed_tool_step() -> None:
    tool_call = AgentToolCall(
        id="tool-1",
        run_id="run-1",
        llm_tool_call_id="call_bh_1",
        tool_name="run_bh",
        input_json={"command": "bh tags list"},
        output_json={"status": "OK"},
        output_text="OK\nsummary: bh command completed\nstdout: groceries|expense",
        status=AgentToolCallStatus.OK,
    )
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="I'll inspect tags first.",
            source=AgentRunEventSource.MODEL_REASONING,
        ),
        _reasoning_event(
            sequence_index=2,
            message="",
            source=AgentRunEventSource.ASSISTANT_CONTENT,
        ),
        _tool_event(
            sequence_index=3,
            event_type=AgentRunEventType.TOOL_CALL_QUEUED,
            tool_call_id="tool-1",
        ),
        _tool_event(
            sequence_index=4,
            event_type=AgentRunEventType.TOOL_CALL_COMPLETED,
            tool_call_id="tool-1",
        ),
        tool_calls=[tool_call],
    )

    messages = build_turn_llm_messages(run)

    assert messages[0]["role"] == "assistant"
    assert messages[0]["reasoning"] == "I'll inspect tags first."
    assert messages[0]["tool_calls"] == [
        {
            "id": "call_bh_1",
            "type": "function",
            "function": {
                "name": "run_bh",
                "arguments": json.dumps({"command": "bh tags list"}, separators=(",", ":")),
            },
        }
    ]
    assert messages[1] == {
        "role": "tool",
        "tool_call_id": "call_bh_1",
        "name": "run_bh",
        "content": "OK\nsummary: bh command completed\nstdout: groceries|expense",
    }


def test_build_turn_llm_messages_merges_final_assistant_message() -> None:
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Summarizing results.",
            source=AgentRunEventSource.MODEL_REASONING,
        )
    )
    final_assistant = AgentMessage(
        id="assistant-1",
        thread_id="thread-1",
        role="assistant",
        content_markdown="Here is the January summary.",
    )
    run.assistant_message = final_assistant
    run.assistant_message_id = final_assistant.id
    run.status = "completed"

    messages = build_turn_llm_messages(run)

    assert messages == [
        {
            "role": "assistant",
            "content": "Here is the January summary.",
            "reasoning": "Summarizing results.",
        }
    ]


def test_build_turn_llm_messages_restores_cancelled_tool_with_user_cancellation_result() -> None:
    completed_tool = AgentToolCall(
        id="tool-completed",
        run_id="run-1",
        llm_tool_call_id="call_bh_done",
        tool_name="run_bh",
        input_json={"command": "bh tags list"},
        output_json={"status": "OK"},
        output_text="OK\nsummary: bh command completed",
        status=AgentToolCallStatus.OK,
    )
    cancelled_tool = AgentToolCall(
        id="tool-cancelled",
        run_id="run-1",
        llm_tool_call_id="call_bh_cancelled",
        tool_name="run_bh",
        input_json={"command": "bh accounts list"},
        output_json={},
        output_text="",
        status=AgentToolCallStatus.CANCELLED,
    )
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Running two lookups.",
            source=AgentRunEventSource.MODEL_REASONING,
        ),
        _tool_event(
            sequence_index=2,
            event_type=AgentRunEventType.TOOL_CALL_QUEUED,
            tool_call_id="tool-completed",
        ),
        _tool_event(
            sequence_index=3,
            event_type=AgentRunEventType.TOOL_CALL_QUEUED,
            tool_call_id="tool-cancelled",
        ),
        _tool_event(
            sequence_index=4,
            event_type=AgentRunEventType.TOOL_CALL_COMPLETED,
            tool_call_id="tool-completed",
        ),
        _tool_event(
            sequence_index=5,
            event_type=AgentRunEventType.TOOL_CALL_CANCELLED,
            tool_call_id="tool-cancelled",
        ),
        tool_calls=[completed_tool, cancelled_tool],
    )

    messages = build_turn_llm_messages(run)

    assert len(messages[0]["tool_calls"]) == 2
    assert messages[1]["tool_call_id"] == "call_bh_done"
    assert messages[2]["tool_call_id"] == "call_bh_cancelled"
    assert "cancelled by user" in messages[2]["content"]


def test_build_turn_llm_messages_fills_orphan_queued_tools_on_failed_run() -> None:
    orphaned_tool = AgentToolCall(
        id="tool-orphan",
        run_id="run-1",
        llm_tool_call_id="call_bh_orphan",
        tool_name="run_bh",
        input_json={"command": "bh accounts list"},
        output_json={},
        output_text="",
        status=AgentToolCallStatus.QUEUED,
    )
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Starting lookups.",
            source=AgentRunEventSource.MODEL_REASONING,
        ),
        _tool_event(
            sequence_index=2,
            event_type=AgentRunEventType.TOOL_CALL_QUEUED,
            tool_call_id="tool-orphan",
        ),
        AgentRunEvent(
            id="event-failed",
            run_id="run-1",
            sequence_index=3,
            event_type=AgentRunEventType.RUN_FAILED,
            message="model request failed",
        ),
        tool_calls=[orphaned_tool],
    )
    run.status = "failed"
    run.error_text = "model request failed"

    messages = build_turn_llm_messages(run)

    assert len(messages[0]["tool_calls"]) == 1
    assert messages[1]["tool_call_id"] == "call_bh_orphan"
    assert "cancelled by user" in messages[1]["content"]


def test_build_turn_llm_messages_restores_multi_step_react_loop() -> None:
    first_tool = AgentToolCall(
        id="tool-1",
        run_id="run-1",
        llm_tool_call_id="call_bh_1",
        tool_name="run_bh",
        input_json={"command": "bh tags list"},
        output_json={"status": "OK"},
        output_text="OK\nsummary: listed tags",
        status=AgentToolCallStatus.OK,
    )
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Step one reasoning.",
            source=AgentRunEventSource.MODEL_REASONING,
        ),
        _tool_event(
            sequence_index=2,
            event_type=AgentRunEventType.TOOL_CALL_QUEUED,
            tool_call_id="tool-1",
        ),
        _tool_event(
            sequence_index=3,
            event_type=AgentRunEventType.TOOL_CALL_COMPLETED,
            tool_call_id="tool-1",
        ),
        _reasoning_event(
            sequence_index=4,
            message="Step two reasoning.",
            source=AgentRunEventSource.MODEL_REASONING,
        ),
        tool_calls=[first_tool],
    )
    final_assistant = AgentMessage(
        id="assistant-1",
        thread_id="thread-1",
        role="assistant",
        content_markdown="All done.",
    )
    run.assistant_message = final_assistant
    run.assistant_message_id = final_assistant.id
    run.status = "completed"

    messages = build_turn_llm_messages(run)

    assert [message.get("role") for message in messages] == [
        "assistant",
        "tool",
        "assistant",
    ]
    assert messages[0]["reasoning"] == "Step one reasoning."
    assert messages[1]["name"] == "run_bh"
    assert messages[2]["content"] == "All done."
    assert messages[2]["reasoning"] == "Step two reasoning."


def test_build_turn_context_insert_appends_interrupt_steering_before_follow_up() -> None:
    user_message = AgentMessage(
        id="user-1",
        thread_id="thread-1",
        role="user",
        content_markdown="Please summarize January spend.",
    )
    follow_up_user = AgentMessage(
        id="user-2",
        thread_id="thread-1",
        role="user",
        content_markdown="Continue with February.",
    )
    run = _run_with_events(
        _reasoning_event(
            sequence_index=1,
            message="Checking January spend.",
            source=AgentRunEventSource.MODEL_REASONING,
        )
    )
    run.status = "failed"
    run.error_text = "Run interrupted by user."

    turn_context = build_turn_context_insert(
        run=run,
        user_message=user_message,
        current_user_message_id=follow_up_user.id,
        history=[user_message, follow_up_user],
    )

    assert turn_context is not None
    assert turn_context.messages[-1] == {
        "role": "user",
        "content": INTERRUPTED_TURN_STEERING_MESSAGE,
    }
