# CALLING SPEC:
# - Purpose: deterministic ModelDecision validation and tool transition executor.
# - Inputs: RunState and ModelDecision; tool execution context/result helpers.
# - Outputs: PreparedStep plus deterministic tool recovery results.
# - Side effects: none.
from __future__ import annotations

from typing import Protocol

from backend.services.agent.harness.contracts import (
    AssistantMessage,
    ModelDecision,
    ModelDecisionCommittedEvent,
    PreparedStep,
    RunState,
    StepRecord,
    ToolCallRecord,
    ToolRequest,
    TranscriptMessageRecord,
)
from backend.services.agent.assistant_content import final_assistant_content as clean_final_assistant_content
from backend.services.agent.harness.repository import (
    new_step_id,
    new_tool_call_id,
    new_transcript_message_id,
)
from backend.services.agent.harness.tools import (
    ToolExecutionContext,
    ToolExecutionResult,
    ToolExecutor,
)
from backend.services.agent.harness.transcript import next_sequence_index
from backend.services.agent.protocol_helpers import tool_call_decode_error_result


class StopSignal(Protocol):
    def is_stop_requested(self, run_id: str) -> bool: ...


class InMemoryStopSignal:
    def __init__(self, repository: object) -> None:
        self._repository = repository

    def is_stop_requested(self, run_id: str) -> bool:
        state = self._repository.load(run_id)
        return state.stop_requested


def _decode_error_execution_result(
    tool_request: ToolRequest,
) -> ToolExecutionResult:
    decode_error = tool_request.arguments_decode_error or "arguments are not valid JSON"
    decoded = tool_call_decode_error_result(
        tool_name=tool_request.tool_name,
        raw_arguments=tool_request.raw_arguments,
        decode_error=decode_error,
    )
    return ToolExecutionResult(
        content=decoded.output_text,
        is_error=True,
        error_code="argument_decode_error",
        output_json=decoded.output_json,
    )


def execute_tool_request(
    tool_request: ToolRequest,
    *,
    tool_executor: ToolExecutor,
    tool_context: ToolExecutionContext,
) -> ToolExecutionResult:
    if tool_request.arguments_decode_error:
        return _decode_error_execution_result(tool_request)
    return tool_executor.execute(tool_request, tool_context)


def tool_execution_context(state: RunState) -> ToolExecutionContext:
    return ToolExecutionContext(
        principal=state.principal,
        run_id=state.run_id,
        thread_id=state.thread_id,
        approval_policy=state.approval_policy.value,
        metadata=dict(state.metadata),
    )


def interrupted_tool_execution_result(tool_name: str) -> ToolExecutionResult:
    return ToolExecutionResult(
        content=(
            "ERROR\n"
            "summary: tool execution outcome is unknown after process interruption\n"
            f"details: {tool_name} was claimed before execution, so it was not retried automatically."
        ),
        is_error=True,
        error_code="execution_outcome_unknown",
        output_json={
            "status": "error",
            "summary": "tool execution outcome is unknown after process interruption",
        },
    )


def prepare_model_decision(
    state: RunState,
    decision: ModelDecision,
) -> PreparedStep:
    step_index = state.completed_steps + 1
    step_id = new_step_id()
    assistant_id = new_transcript_message_id()
    seq = next_sequence_index(state.transcript)

    assistant_content = decision.content
    if not decision.tool_requests:
        assistant_content = clean_final_assistant_content(decision.content) or decision.content
    assistant_message = AssistantMessage(
        content=assistant_content,
        reasoning_text=decision.reasoning_text,
        tool_requests=list(decision.tool_requests),
    )
    assistant_record = TranscriptMessageRecord(
        id=assistant_id,
        sequence_index=seq,
        message=assistant_message,
    )

    events: list = [
        ModelDecisionCommittedEvent(
            run_id=state.run_id,
            step_index=step_index,
            assistant_message_id=assistant_id,
            has_tool_requests=bool(decision.tool_requests),
            reasoning_text=decision.reasoning_text,
        )
    ]

    queued_tool_calls: list[ToolCallRecord] = []
    for call_index, tool_request in enumerate(decision.tool_requests):
        queued_tool_calls.append(
            ToolCallRecord(
                id=new_tool_call_id(),
                step_id=step_id,
                call_index=call_index,
                tool_request_id=tool_request.tool_request_id,
                tool_name=tool_request.tool_name,
                arguments_json=dict(tool_request.arguments_json),
                status="queued",
            )
        )

    step_record = StepRecord(
        id=step_id,
        step_index=step_index,
        assistant_message_id=assistant_id,
        status="running",
        usage=decision.usage,
        finish_reason=decision.finish_reason,
        latency_ms=decision.latency_ms,
    )

    should_continue = bool(decision.tool_requests)
    updated_state = state.model_copy(
        update={
            "transcript": list(state.transcript) + [assistant_record],
            "steps": list(state.steps) + [step_record],
            "tool_calls": list(state.tool_calls) + queued_tool_calls,
        }
    )

    return PreparedStep(
        state=updated_state,
        assistant=assistant_record,
        step=step_record,
        tool_calls=queued_tool_calls,
        events=events,
        should_continue=should_continue,
    )
