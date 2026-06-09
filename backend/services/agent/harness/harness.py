# CALLING SPEC:
# - Purpose: product-native AgentHarness coordinator for run and resume.
# - Inputs: RunRequest, injected ModelGateway, ToolExecutor, RunRepository, EventSink, StopSignal.
# - Outputs: RunResult terminal product results.
# - Side effects: persistence and event publication through injected adapters.
from __future__ import annotations

import logging
import time
from typing import Protocol

from backend.services.agent.harness.contracts import (
    HarnessRunStatus,
    HarnessTerminalError,
    ModelDecision,
    ModelRequest,
    ModelRequestStartedEvent,
    RunFinishedEvent,
    RunRequest,
    RunResult,
    RunStartedEvent,
    RunState,
    StepCommittedEvent,
    ToolFinishedEvent,
    ToolStartedEvent,
)
from backend.services.agent.harness.errors import (
    HarnessError,
    HarnessMaxStepsReached,
    HarnessProviderError,
    HarnessStopRequested,
)
from backend.services.agent.harness.events import EventSink
from backend.services.agent.harness.repository import RunRepository
from backend.services.agent.harness.step_executor import (
    StopSignal,
    execute_tool_request,
    interrupted_tool_execution_result,
    prepare_model_decision,
    tool_execution_context,
)
from backend.services.agent.harness.tools import ToolExecutor
from backend.services.agent.harness.tools import ToolExecutionResult
from backend.services.agent.harness.transcript import model_visible_transcript

logger = logging.getLogger(__name__)


class ModelGateway(Protocol):
    def complete(self, request: ModelRequest) -> ModelDecision: ...


class AgentHarness:
    def __init__(
        self,
        *,
        repository: RunRepository,
        model_gateway: ModelGateway,
        tool_executor: ToolExecutor,
        event_sink: EventSink,
        stop_signal: StopSignal,
    ) -> None:
        self._repository = repository
        self._model_gateway = model_gateway
        self._tool_executor = tool_executor
        self._event_sink = event_sink
        self._stop_signal = stop_signal

    def run(self, request: RunRequest) -> RunResult:
        state = self._repository.create(request)
        self._publish(RunStartedEvent(run_id=state.run_id))
        return self._execute_until_terminal(state)

    def resume(self, run_id: str) -> RunResult:
        state = self._repository.load(run_id)
        if state.status != HarnessRunStatus.RUNNING:
            return self._terminal_result_from_state(state)
        if not state.steps:
            self._publish(RunStartedEvent(run_id=state.run_id))
        return self._execute_until_terminal(state)

    def _execute_until_terminal(self, state: RunState) -> RunResult:
        total_latency_ms = 0
        current = state
        try:
            while current.status == HarnessRunStatus.RUNNING:
                if self._stop_signal.is_stop_requested(current.run_id):
                    raise HarnessStopRequested("run interrupted by user")
                pending_step = next(
                    (step for step in current.steps if step.status == "running"),
                    None,
                )
                if pending_step is not None:
                    current, should_continue = self._complete_prepared_step(
                        current,
                        step_id=pending_step.id,
                    )
                    if not should_continue:
                        current = current.model_copy(
                            update={"status": HarnessRunStatus.COMPLETED}
                        )
                        break
                    continue

                if current.completed_steps >= current.max_steps:
                    raise HarnessMaxStepsReached(
                        f"max steps ({current.max_steps}) reached"
                    )

                step_index = current.completed_steps + 1
                self._publish(
                    ModelRequestStartedEvent(
                        run_id=current.run_id,
                        step_index=step_index,
                    )
                )
                model_request = ModelRequest(
                    transcript=model_visible_transcript(current.transcript),
                    tool_definitions=current.tool_catalog,
                    model_params=current.model_params,
                    trace_metadata={
                        "run_id": current.run_id,
                        "step_index": step_index,
                        "thread_id": current.thread_id,
                        "attachments_use_ocr": current.metadata.get("attachments_use_ocr", False),
                    },
                )
                started = time.monotonic()
                decision = self._model_gateway.complete(model_request)
                if self._stop_signal.is_stop_requested(current.run_id):
                    raise HarnessStopRequested("run interrupted by user")
                total_latency_ms += int((time.monotonic() - started) * 1000)

                prepared_step = prepare_model_decision(current, decision)
                current = self._repository.prepare_step(current, prepared_step)
                for event in prepared_step.events:
                    self._publish(event)
                current, should_continue = self._complete_prepared_step(
                    current,
                    step_id=prepared_step.step.id,
                )
                if self._stop_signal.is_stop_requested(current.run_id):
                    raise HarnessStopRequested("run interrupted by user")

                if not should_continue:
                    current = current.model_copy(
                        update={"status": HarnessRunStatus.COMPLETED}
                    )
                    break

            run_result = self._build_run_result(
                current,
                total_latency_ms=total_latency_ms,
            )
            if self._repository.finish(run_result):
                self._publish(
                    RunFinishedEvent(
                        run_id=run_result.run_id,
                        status=run_result.status,
                        final_assistant_content=run_result.final_assistant_content,
                        terminal_error=run_result.terminal_error,
                    )
                )
            else:
                ensure_event = getattr(self._repository, "ensure_run_finished_event", None)
                if callable(ensure_event):
                    ensure_event(run_result)
                return self._terminal_result_from_state(self._repository.load(current.run_id))
            return run_result

        except HarnessStopRequested as exc:
            return self._fail_run(
                current,
                status=HarnessRunStatus.INTERRUPTED,
                error=HarnessTerminalError(code=exc.code, detail=exc.detail),
                total_latency_ms=total_latency_ms,
            )
        except HarnessMaxStepsReached as exc:
            return self._fail_run(
                current,
                status=HarnessRunStatus.MAX_STEPS,
                error=HarnessTerminalError(code=exc.code, detail=exc.detail),
                total_latency_ms=total_latency_ms,
            )
        except HarnessError as exc:
            return self._fail_run(
                current,
                status=HarnessRunStatus.FAILED,
                error=HarnessTerminalError(code=exc.code, detail=exc.detail),
                total_latency_ms=total_latency_ms,
            )
        except Exception as exc:
            logger.exception(
                "unexpected harness failure run_id=%s step=%s",
                current.run_id,
                current.completed_steps + 1,
            )
            return self._fail_run(
                current,
                status=HarnessRunStatus.FAILED,
                error=HarnessTerminalError(
                    code="unexpected_error",
                    detail=str(exc),
                ),
                total_latency_ms=total_latency_ms,
            )

    def _complete_prepared_step(
        self,
        state: RunState,
        *,
        step_id: str,
    ) -> tuple[RunState, bool]:
        step = next(item for item in state.steps if item.id == step_id)
        assistant = next(
            record.message
            for record in state.transcript
            if record.id == step.assistant_message_id
        )
        requests = {
            request.tool_request_id: request
            for request in getattr(assistant, "tool_requests", [])
        }
        current = state
        for tool_call in [
            call for call in current.tool_calls if call.step_id == step_id
        ]:
            if tool_call.status in {"ok", "error", "cancelled"}:
                continue
            if tool_call.status == "queued":
                current = self._repository.mark_tool_running(current.run_id, tool_call.id)
                self._publish(
                    ToolStartedEvent(
                        run_id=current.run_id,
                        step_index=step.step_index,
                        tool_call_id=tool_call.id,
                        tool_name=tool_call.tool_name,
                    )
                )
                request = requests[tool_call.tool_request_id]
                try:
                    result = execute_tool_request(
                        request,
                        tool_executor=self._tool_executor,
                        tool_context=tool_execution_context(current),
                    )
                except Exception as exc:
                    logger.exception(
                        "tool execution failed run_id=%s step=%s tool=%s",
                        current.run_id,
                        step.step_index,
                        tool_call.tool_name,
                    )
                    result = ToolExecutionResult(
                        content=f"tool execution failed: {exc}",
                        is_error=True,
                        error_code="tool_execution_exception",
                        output_json={
                            "status": "error",
                            "summary": "tool execution failed",
                        },
                    )
            else:
                result = interrupted_tool_execution_result(tool_call.tool_name)
            current = self._repository.commit_tool_result(
                current.run_id,
                tool_call.id,
                result,
            )
            self._publish(
                ToolFinishedEvent(
                    run_id=current.run_id,
                    step_index=step.step_index,
                    tool_call_id=tool_call.id,
                    tool_name=tool_call.tool_name,
                    status="error" if result.is_error else "ok",
                )
            )
        current = self._repository.finalize_step(current.run_id, step_id)
        self._publish(StepCommittedEvent(run_id=current.run_id, step_index=step.step_index))
        return current, bool(requests)

    def _fail_run(
        self,
        state: RunState,
        *,
        status: HarnessRunStatus,
        error: HarnessTerminalError,
        total_latency_ms: int,
    ) -> RunResult:
        failed_state = state.model_copy(
            update={
                "status": status,
                "terminal_error": error,
            }
        )
        run_result = self._build_run_result(
            failed_state,
            total_latency_ms=total_latency_ms,
        )
        if not self._repository.finish(run_result):
            ensure_event = getattr(self._repository, "ensure_run_finished_event", None)
            if callable(ensure_event):
                ensure_event(run_result)
            return self._terminal_result_from_state(self._repository.load(state.run_id))
        self._publish(
            RunFinishedEvent(
                run_id=run_result.run_id,
                status=run_result.status,
                final_assistant_content=run_result.final_assistant_content,
                terminal_error=run_result.terminal_error,
            )
        )
        return run_result

    def _build_run_result(
        self,
        state: RunState,
        *,
        total_latency_ms: int | None,
    ) -> RunResult:
        return RunResult(
            run_id=state.run_id,
            status=state.status,
            final_assistant_content=state.final_assistant_content,
            transcript=list(state.transcript),
            completed_steps=state.completed_steps,
            tool_calls=list(state.tool_calls),
            accumulated_usage=state.accumulated_usage,
            total_latency_ms=total_latency_ms,
            terminal_error=state.terminal_error,
        )

    def _terminal_result_from_state(self, state: RunState) -> RunResult:
        return self._build_run_result(state, total_latency_ms=None)

    def _publish(self, event: object) -> None:
        self._event_sink.publish(event)
