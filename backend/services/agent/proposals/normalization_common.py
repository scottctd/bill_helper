# CALLING SPEC:
# - Purpose: Build and validate agent proposal payloads for `normalization_common`.
# - Inputs: Callers import `backend/services/agent/proposals/normalization_common` and invoke `parse_typed_change_payload`, `raise_normalization_error`.
# - Outputs: Exports `parse_typed_change_payload`, `raise_normalization_error`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from typing import Any, TypeVar

from pydantic import BaseModel

from backend.enums_agent import AgentChangeType
from backend.services.agent.change_contracts import parse_change_payload
from backend.services.agent.tool_types import ToolExecutionResult


TChangePayload = TypeVar("TChangePayload", bound=BaseModel)


def parse_typed_change_payload(
    *,
    change_type: AgentChangeType,
    payload: dict[str, Any],
    model_type: type[TChangePayload],
) -> TChangePayload:
    parsed = parse_change_payload(change_type, payload)
    if not isinstance(parsed, model_type):  # pragma: no cover - enum/model map guard
        raise ValueError(f"unexpected payload model for change type: {change_type.value}")
    return parsed


def raise_normalization_error(result: ToolExecutionResult, *, default_message: str) -> None:
    raise ValueError(str(result.output_json.get("summary", default_message)))
