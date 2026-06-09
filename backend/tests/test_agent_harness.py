# CALLING SPEC:
# - Purpose: pure harness contract and execution tests without DB/HTTP/LiteLLM.
# - Inputs: in-memory repository, decision injection, fake tools.
# - Outputs: pytest assertions on RunResult and event ordering.
# - Side effects: none.
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from backend.services.agent.decision_injection import decision_gateway_from_list
from backend.services.agent.harness.contracts import (
    AssistantMessage,
    HarnessApprovalPolicy,
    HarnessModelConfig,
    HarnessPrincipal,
    HarnessRunOrigin,
    HarnessRunStatus,
    ModelDecision,
    ModelUsage,
    RunRequest,
    SystemMessage,
    ToolDefinition,
    ToolRequest,
    UserMessage,
)
from backend.services.agent.harness.errors import HarnessValidationError
from backend.services.agent.harness.events import CollectingEventSink
from backend.services.agent.harness.harness import AgentHarness
from backend.services.agent.harness.repository import InMemoryRunRepository
from backend.services.agent.harness.step_executor import InMemoryStopSignal
from backend.services.agent.harness.step_executor import prepare_model_decision
from backend.services.agent.harness.tools import RegistryToolExecutor, ToolExecutionContext, ToolExecutionResult


def _base_request(**overrides) -> RunRequest:
    run_id = overrides.pop("run_id", str(uuid.uuid4()))
    defaults = {
        "run_id": run_id,
        "thread_id": "thread-1",
        "turn_index": 0,
        "principal": HarnessPrincipal(user_id="user-1", user_name="Test"),
        "initial_transcript": [
            SystemMessage(content="You are helpful."),
            UserMessage(content="Hello"),
        ],
        "model_params": HarnessModelConfig(model_name="test/model"),
        "tool_catalog": [
            ToolDefinition(
                name="echo",
                description="echo tool",
                parameters_json_schema={"type": "object", "properties": {}},
            )
        ],
        "max_steps": 5,
        "approval_policy": HarnessApprovalPolicy.DEFAULT,
        "origin": HarnessRunOrigin(surface="test"),
    }
    defaults.update(overrides)
    return RunRequest(**defaults)


def _echo_executor() -> RegistryToolExecutor:
    def echo_handler(request: ToolRequest, context: ToolExecutionContext) -> ToolExecutionResult:
        return ToolExecutionResult(content=f"echo:{request.arguments_json.get('text', '')}")

    return RegistryToolExecutor(
        handlers={"echo": echo_handler},
        definitions=[],
    )


def _harness(
    decisions: list[ModelDecision],
    *,
    max_steps: int = 5,
) -> tuple[AgentHarness, CollectingEventSink, InMemoryRunRepository]:
    repo = InMemoryRunRepository()
    events = CollectingEventSink()
    harness = AgentHarness(
        repository=repo,
        model_gateway=decision_gateway_from_list(decisions),
        tool_executor=_echo_executor(),
        event_sink=events,
        stop_signal=InMemoryStopSignal(repo),
    )
    return harness, events, repo


def test_run_request_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        RunRequest.model_validate(
            {
                "run_id": "r1",
                "principal": {"user_id": "u1"},
                "initial_transcript": [{"role": "system", "content": "hi"}],
                "model_params": {"model_name": "m"},
                "tool_catalog": [],
                "origin": {"surface": "test"},
                "extra_field": True,
            }
        )


def test_terminal_assistant_decision_completes_run():
    harness, events, _repo = _harness(
        [ModelDecision(content="Done.", usage=ModelUsage(input_tokens=10, output_tokens=5))]
    )
    result = harness.run(_base_request())
    assert result.status == HarnessRunStatus.COMPLETED
    assert result.final_assistant_content == "Done."
    assert result.completed_steps == 1
    assert events.events[-1].event_type == "run_finished"


def test_tool_decision_executes_and_continues():
    harness, events, _repo = _harness(
        [
            ModelDecision(
                content="",
                tool_requests=[
                    ToolRequest(
                        tool_request_id="tc-1",
                        tool_name="echo",
                        arguments_json={"text": "hi"},
                    )
                ],
            ),
            ModelDecision(content="All done."),
        ]
    )
    result = harness.run(_base_request())
    assert result.status == HarnessRunStatus.COMPLETED
    assert result.completed_steps == 2
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].status == "ok"
    event_types = [event.event_type for event in events.events]
    assert "tool_started" in event_types
    assert "tool_finished" in event_types


def test_unknown_tool_fails_validation():
    harness, _events, _repo = _harness(
        [
            ModelDecision(
                content="",
                tool_requests=[
                    ToolRequest(
                        tool_request_id="tc-1",
                        tool_name="missing",
                        arguments_json={},
                    )
                ],
            )
        ]
    )
    result = harness.run(_base_request())
    assert result.status == HarnessRunStatus.FAILED


def test_stop_request_interrupts_run():
    repo = InMemoryRunRepository()
    events = CollectingEventSink()
    harness = AgentHarness(
        repository=repo,
        model_gateway=decision_gateway_from_list(
            [
                ModelDecision(content="step1"),
                ModelDecision(content="step2"),
            ]
        ),
        tool_executor=_echo_executor(),
        event_sink=events,
        stop_signal=InMemoryStopSignal(repo),
    )
    request = _base_request(max_steps=10)
    state = repo.create(request)
    repo.request_stop(request.run_id)
    result = harness.resume(request.run_id)
    assert result.status == HarnessRunStatus.INTERRUPTED


def test_max_steps_terminal_status():
    harness, _events, _repo = _harness(
        [
            ModelDecision(
                content="",
                tool_requests=[
                    ToolRequest(
                        tool_request_id=f"tc-{i}",
                        tool_name="echo",
                        arguments_json={"text": str(i)},
                    )
                ],
            )
            for i in range(10)
        ],
    )
    result = harness.run(_base_request(max_steps=2))
    assert result.status == HarnessRunStatus.MAX_STEPS


def test_transcript_round_trip():
    msg = AssistantMessage(
        content="answer",
        reasoning_text="thought",
        tool_requests=[
            ToolRequest(tool_request_id="t1", tool_name="echo", arguments_json={})
        ],
    )
    restored = AssistantMessage.model_validate(msg.model_dump())
    assert restored == msg


def test_initial_transcript_validation():
    with pytest.raises(HarnessValidationError):
        InMemoryRunRepository().create(
            _base_request(initial_transcript=[])
        )


def test_resume_does_not_repeat_tool_left_running():
    executions = 0

    def echo_handler(request: ToolRequest, context: ToolExecutionContext) -> ToolExecutionResult:
        nonlocal executions
        executions += 1
        return ToolExecutionResult(content="unexpected")

    repo = InMemoryRunRepository()
    request = _base_request()
    state = repo.create(request)
    prepared = prepare_model_decision(
        state,
        ModelDecision(
            content="",
            tool_requests=[
                ToolRequest(
                    tool_request_id="tc-ambiguous",
                    tool_name="echo",
                    arguments_json={"text": "hi"},
                )
            ],
        ),
    )
    state = repo.prepare_step(state, prepared)
    repo.mark_tool_running(state.run_id, prepared.tool_calls[0].id)
    events = CollectingEventSink()
    harness = AgentHarness(
        repository=repo,
        model_gateway=decision_gateway_from_list([ModelDecision(content="Recovered.")]),
        tool_executor=RegistryToolExecutor(handlers={"echo": echo_handler}, definitions=[]),
        event_sink=events,
        stop_signal=InMemoryStopSignal(repo),
    )

    result = harness.resume(request.run_id)

    assert result.status == HarnessRunStatus.COMPLETED
    assert executions == 0
    assert result.tool_calls[0].status == "error"
    assert result.tool_calls[0].error_code == "execution_outcome_unknown"
