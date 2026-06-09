# CALLING SPEC:
# - Purpose: direct harness evaluation caller without product chat ORM setup.
# - Inputs: RunRequest, optional decision gateway or production model gateway.
# - Outputs: RunResult with canonical transcript, steps, tool calls.
# - Side effects: in-memory persistence only unless caller supplies DB repository.
from __future__ import annotations

import uuid
from typing import Any

from backend.services.agent.decision_injection import DecisionQueueGateway
from backend.services.agent.harness.contracts import (
    HarnessApprovalPolicy,
    HarnessModelConfig,
    HarnessPrincipal,
    HarnessRunOrigin,
    RunRequest,
    RunResult,
    SystemMessage,
    UserMessage,
)
from backend.services.agent.harness.events import CollectingEventSink, NullEventSink
from backend.services.agent.harness.harness import AgentHarness
from backend.services.agent.harness.repository import InMemoryRunRepository
from backend.services.agent.harness.step_executor import InMemoryStopSignal
from backend.services.agent.harness.tools import RegistryToolExecutor
from backend.services.agent.production_tools import ProductionToolExecutor
from backend.services.agent.tool_runtime_support.catalog import TOOLS
from backend.services.agent.production_repository import tool_definitions_from_catalog


def build_isolated_harness(
    *,
    model_gateway: Any,
    tool_executor: Any | None = None,
    event_sink: Any | None = None,
) -> tuple[AgentHarness, InMemoryRunRepository, CollectingEventSink]:
    repo = InMemoryRunRepository()
    events = event_sink or CollectingEventSink()
    harness = AgentHarness(
        repository=repo,
        model_gateway=model_gateway,
        tool_executor=tool_executor or ProductionToolExecutor(),
        event_sink=events,
        stop_signal=InMemoryStopSignal(repo),
    )
    return harness, repo, events


def run_isolated_evaluation(
    *,
    user_content: str,
    system_content: str = "You are a helpful assistant.",
    model_gateway: Any,
    principal_user_id: str = "eval-user",
    max_steps: int = 20,
) -> RunResult:
    harness, _repo, _events = build_isolated_harness(model_gateway=model_gateway)
    request = RunRequest(
        run_id=str(uuid.uuid4()),
        principal=HarnessPrincipal(user_id=principal_user_id),
        initial_transcript=[
            SystemMessage(content=system_content),
            UserMessage(content=user_content),
        ],
        model_params=HarnessModelConfig(model_name="eval/model"),
        tool_catalog=tool_definitions_from_catalog(list(TOOLS.values())),
        max_steps=max_steps,
        approval_policy=HarnessApprovalPolicy.DEFAULT,
        origin=HarnessRunOrigin(surface="benchmark"),
    )
    return harness.run(request)
