# CALLING SPEC:
# - Purpose: test/eval seam for supplying ModelDecision without LiteLLM.
# - Inputs: queued ModelDecision values or a callable decision source.
# - Outputs: ModelGateway-compatible adapter for AgentHarness.
# - Side effects: consumes queued decisions in order.
from __future__ import annotations

from collections import deque
from collections.abc import Callable, Iterator
from typing import Any

from backend.services.agent.harness.contracts import ModelDecision, ModelRequest


class DecisionQueueGateway:
    def __init__(self, decisions: list[ModelDecision] | Iterator[ModelDecision]) -> None:
        self._queue: deque[ModelDecision] = deque(decisions)

    def complete(self, request: ModelRequest) -> ModelDecision:
        if not self._queue:
            raise RuntimeError("decision queue exhausted")
        return self._queue.popleft()


class CallableDecisionGateway:
    def __init__(
        self,
        source: Callable[[ModelRequest], ModelDecision],
    ) -> None:
        self._source = source

    def complete(self, request: ModelRequest) -> ModelDecision:
        return self._source(request)


def decision_gateway_from_list(decisions: list[ModelDecision]) -> DecisionQueueGateway:
    return DecisionQueueGateway(decisions)
