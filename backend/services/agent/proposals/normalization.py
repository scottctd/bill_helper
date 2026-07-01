# CALLING SPEC:
# - Purpose: Build and validate agent proposal payloads for `normalization`.
# - Inputs: Callers import `backend/services/agent/proposals/normalization` and invoke `normalize_payload_for_change_type`.
# - Outputs: Exports `normalize_payload_for_change_type`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from backend.enums_agent import AgentChangeType
from backend.services.agent.change_registry import payload_normalizers
from backend.services.agent.tool_types import ToolContext


ProposalPayloadNormalizer = Callable[[ToolContext, dict[str, Any]], dict[str, Any]]

PAYLOAD_NORMALIZERS: dict[AgentChangeType, ProposalPayloadNormalizer] = payload_normalizers()


def normalize_payload_for_change_type(
    context: ToolContext,
    *,
    change_type: AgentChangeType,
    payload: dict[str, Any],
) -> dict[str, Any]:
    normalizer = PAYLOAD_NORMALIZERS.get(change_type)
    if normalizer is None:
        raise ValueError(f"unsupported proposal change type: {change_type.value}")
    return normalizer(context, payload)
