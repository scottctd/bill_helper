# CALLING SPEC:
# - Purpose: RunRepository protocol and in-memory implementation for harness tests.
# - Inputs: RunRequest, PreparedStep, tool results, RunResult.
# - Outputs: durable RunState snapshots and resumable step transitions.
# - Side effects: in-memory store mutations; production uses SQLAlchemy adapter.
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Protocol
import uuid

from backend.services.agent.harness.contracts import (
    AssistantMessage,
    HarnessRunStatus,
    ModelUsage,
    PreparedStep,
    RunRequest,
    RunResult,
    RunState,
    ToolResultMessage,
    TranscriptMessageRecord,
)
from backend.services.agent.harness.errors import HarnessPersistenceError
from backend.services.agent.harness.transcript import next_sequence_index
from backend.services.agent.harness.tools import ToolExecutionResult


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RunRepository(Protocol):
    def create(self, request: RunRequest) -> RunState: ...

    def load(self, run_id: str) -> RunState: ...

    def prepare_step(self, previous_state: RunState, prepared_step: PreparedStep) -> RunState: ...

    def mark_tool_running(self, run_id: str, tool_call_id: str) -> RunState: ...

    def commit_tool_result(
        self,
        run_id: str,
        tool_call_id: str,
        result: ToolExecutionResult,
    ) -> RunState: ...

    def finalize_step(self, run_id: str, step_id: str) -> RunState: ...

    def finish(self, run_result: RunResult) -> bool: ...

    def request_stop(self, run_id: str) -> None: ...


class InMemoryRunRepository:
    def __init__(self) -> None:
        self._runs: dict[str, RunState] = {}

    def create(self, request: RunRequest) -> RunState:
        from backend.services.agent.harness.transcript import validate_initial_transcript

        validate_initial_transcript(request.initial_transcript)
        now = _utc_now()
        transcript = []
        for index, message in enumerate(request.initial_transcript):
            transcript.append(
                {
                    "id": str(uuid.uuid4()),
                    "sequence_index": index,
                    "message": message,
                }
            )
        from backend.services.agent.harness.contracts import TranscriptMessageRecord

        records = [
            TranscriptMessageRecord.model_validate(record) for record in transcript
        ]
        state = RunState(
            run_id=request.run_id,
            thread_id=request.thread_id,
            turn_index=request.turn_index,
            principal=request.principal,
            model_params=request.model_params,
            tool_catalog=request.tool_catalog,
            max_steps=request.max_steps,
            approval_policy=request.approval_policy,
            origin=request.origin,
            metadata=dict(request.metadata),
            transcript=records,
            created_at=now,
        )
        self._runs[request.run_id] = state
        return deepcopy(state)

    def load(self, run_id: str) -> RunState:
        state = self._runs.get(run_id)
        if state is None:
            raise HarnessPersistenceError(f"run not found: {run_id}")
        return deepcopy(state)

    def prepare_step(self, previous_state: RunState, prepared_step: PreparedStep) -> RunState:
        if previous_state.run_id != prepared_step.state.run_id:
            raise HarnessPersistenceError("run_id mismatch on step prepare")
        self._runs[previous_state.run_id] = deepcopy(prepared_step.state)
        return deepcopy(prepared_step.state)

    def mark_tool_running(self, run_id: str, tool_call_id: str) -> RunState:
        state = self.load(run_id)
        now = _utc_now()
        state.tool_calls = [
            call.model_copy(update={"status": "running", "started_at": now})
            if call.id == tool_call_id and call.status == "queued"
            else call
            for call in state.tool_calls
        ]
        self._runs[run_id] = state
        return deepcopy(state)

    def commit_tool_result(
        self,
        run_id: str,
        tool_call_id: str,
        result: ToolExecutionResult,
    ) -> RunState:
        state = self.load(run_id)
        target = next((call for call in state.tool_calls if call.id == tool_call_id), None)
        if target is None:
            raise HarnessPersistenceError(f"tool call not found: {tool_call_id}")
        if target.status in {"ok", "error", "cancelled"}:
            return state
        status = "error" if result.is_error else "ok"
        state.tool_calls = [
            call.model_copy(
                update={
                    "status": status,
                    "result_content": result.content,
                    "output_json": result.output_json,
                    "error_code": result.error_code,
                    "completed_at": _utc_now(),
                }
            )
            if call.id == tool_call_id
            else call
            for call in state.tool_calls
        ]
        state.transcript.append(
            TranscriptMessageRecord(
                id=new_transcript_message_id(),
                sequence_index=next_sequence_index(state.transcript),
                message=ToolResultMessage(
                    tool_request_id=target.tool_request_id,
                    tool_name=target.tool_name,
                    content=result.content,
                    is_error=result.is_error,
                ),
            )
        )
        self._runs[run_id] = state
        return deepcopy(state)

    def finalize_step(self, run_id: str, step_id: str) -> RunState:
        state = self.load(run_id)
        step = next((item for item in state.steps if item.id == step_id), None)
        if step is None:
            raise HarnessPersistenceError(f"step not found: {step_id}")
        if step.status == "committed":
            return state
        pending = [
            call for call in state.tool_calls
            if call.step_id == step_id and call.status in {"queued", "running"}
        ]
        if pending:
            raise HarnessPersistenceError(f"step has unfinished tools: {step_id}")
        state.steps = [
            item.model_copy(update={"status": "committed"}) if item.id == step_id else item
            for item in state.steps
        ]
        state.completed_steps = max(state.completed_steps, step.step_index)
        state.accumulated_usage = _accumulate_usage(state.accumulated_usage, step.usage)
        assistant = next(
            (
                record.message
                for record in state.transcript
                if record.id == step.assistant_message_id
                and isinstance(record.message, AssistantMessage)
            ),
            None,
        )
        if assistant is not None and not assistant.tool_requests:
            state.final_assistant_content = assistant.content
        self._runs[run_id] = state
        return deepcopy(state)

    def finish(self, run_result: RunResult) -> bool:
        state = self._runs.get(run_result.run_id)
        if state is None:
            raise HarnessPersistenceError(f"run not found: {run_result.run_id}")
        if state.status != HarnessRunStatus.RUNNING:
            return False
        state.status = run_result.status
        state.final_assistant_content = run_result.final_assistant_content
        state.terminal_error = run_result.terminal_error
        state.completed_steps = run_result.completed_steps
        state.accumulated_usage = run_result.accumulated_usage
        self._runs[run_result.run_id] = state
        return True

    def request_stop(self, run_id: str) -> None:
        state = self._runs.get(run_id)
        if state is None:
            raise HarnessPersistenceError(f"run not found: {run_id}")
        state.stop_requested = True
        self._runs[run_id] = state


def new_transcript_message_id() -> str:
    return str(uuid.uuid4())


def new_step_id() -> str:
    return str(uuid.uuid4())


def new_tool_call_id() -> str:
    return str(uuid.uuid4())


def _accumulate_usage(current: ModelUsage, addition: ModelUsage) -> ModelUsage:
    def _add(a: int | None, b: int | None) -> int | None:
        if a is None and b is None:
            return None
        return (a or 0) + (b or 0)

    return ModelUsage(
        input_tokens=_add(current.input_tokens, addition.input_tokens),
        output_tokens=_add(current.output_tokens, addition.output_tokens),
        cache_read_tokens=_add(current.cache_read_tokens, addition.cache_read_tokens),
        cache_write_tokens=_add(current.cache_write_tokens, addition.cache_write_tokens),
    )
