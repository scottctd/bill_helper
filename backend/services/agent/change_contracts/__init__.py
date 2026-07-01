# CALLING SPEC:
# - Purpose: define package exports and module boundaries for `backend/services/agent/change_contracts`.
# - Inputs: callers that import `backend/services/agent/change_contracts/__init__.py` and pass module-defined arguments or framework events.
# - Outputs: package-level exports for `backend/services/agent/change_contracts`.
# - Side effects: import-time package wiring only.
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from pydantic import BaseModel

from backend.enums_agent import AgentChangeType
from . import catalog as catalog_contracts
from . import entries as entry_contracts
from . import groups as group_contracts
from .patches import (
    PROPOSAL_MUTABLE_ROOTS,
    parse_patch_path,
    validate_patch_map_paths,
)


type ChangePayloadModel = (
    catalog_contracts.CreateTagPayload
    | catalog_contracts.UpdateTagPayload
    | catalog_contracts.DeleteTagPayload
    | catalog_contracts.CreateEntityPayload
    | catalog_contracts.UpdateEntityPayload
    | catalog_contracts.DeleteEntityPayload
    | catalog_contracts.CreateAccountPayload
    | catalog_contracts.UpdateAccountPayload
    | catalog_contracts.DeleteAccountPayload
    | catalog_contracts.SnapshotCreatePayload
    | catalog_contracts.SnapshotDeletePayload
    | entry_contracts.CreateEntryPayload
    | entry_contracts.UpdateEntryPayload
    | entry_contracts.DeleteEntryPayload
    | group_contracts.CreateGroupPayload
    | group_contracts.UpdateGroupPayload
    | group_contracts.DeleteGroupPayload
    | group_contracts.CreateGroupMemberPayload
    | group_contracts.DeleteGroupMemberPayload
)


def _payload_models() -> dict[AgentChangeType, type[BaseModel]]:
    from backend.services.agent.change_registry import change_payload_models

    return change_payload_models()


def _payload_model_types() -> tuple[type[BaseModel], ...]:
    return tuple(_payload_models().values())


def validate_change_payload(change_type: AgentChangeType, payload: dict[str, Any]) -> BaseModel:
    model_type = _payload_models().get(change_type)
    if model_type is None:  # pragma: no cover - enum guard
        raise ValueError(f"unsupported proposal change type: {change_type.value}")
    return model_type.model_validate(payload)


def parse_change_payload(
    change_type: AgentChangeType,
    payload: Mapping[str, Any],
) -> ChangePayloadModel:
    parsed = validate_change_payload(change_type, dict(payload))
    if not isinstance(parsed, _payload_model_types()):  # pragma: no cover - enum/model map guard
        raise ValueError(f"unsupported proposal change type: {change_type.value}")
    return cast(ChangePayloadModel, parsed)


def __getattr__(name: str) -> object:
    if name == "CHANGE_PAYLOAD_MODELS":
        return _payload_models()
    if name == "CHANGE_PAYLOAD_MODEL_TYPES":
        return _payload_model_types()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "CHANGE_PAYLOAD_MODELS",
    "PROPOSAL_MUTABLE_ROOTS",
    "ChangePayloadModel",
    "parse_change_payload",
    "parse_patch_path",
    "validate_change_payload",
    "validate_patch_map_paths",
]
