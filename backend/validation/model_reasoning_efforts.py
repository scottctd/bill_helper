# CALLING SPEC:
# - Purpose: validate, persist, and resolve per-model reasoning-effort settings.
# - Inputs: JSON-like model-to-effort maps, stored JSON text, and available model ids.
# - Outputs: canonical effort maps or a selected model's configured effort.
# - Side effects: none.
from __future__ import annotations

import json
from typing import Literal, TypeAlias, cast

from backend.validation.runtime_settings import normalize_agent_model_item_or_none

ReasoningEffort: TypeAlias = Literal["none", "low", "medium", "high", "xhigh", "max"]
REASONING_EFFORTS: tuple[ReasoningEffort, ...] = (
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
)
_REASONING_EFFORT_SET = frozenset(REASONING_EFFORTS)
AGENT_MODEL_REASONING_EFFORTS_MAX_KEYS = 64


def normalize_agent_model_reasoning_efforts_payload_or_none(
    value: object | None,
) -> dict[str, ReasoningEffort] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("agent_model_reasoning_efforts must be a JSON object or null")
    normalized: dict[str, ReasoningEffort] = {}
    seen_keys: set[str] = set()
    for raw_key, raw_value in value.items():
        key = normalize_agent_model_item_or_none(str(raw_key))
        if key is None:
            continue
        key_fold = key.casefold()
        if key_fold in seen_keys:
            continue
        seen_keys.add(key_fold)
        effort = str(raw_value).strip().casefold()
        if effort not in _REASONING_EFFORT_SET:
            raise ValueError(
                "agent_model_reasoning_efforts values must be one of: "
                + ", ".join(REASONING_EFFORTS)
            )
        normalized[key] = cast(ReasoningEffort, effort)
        if len(normalized) > AGENT_MODEL_REASONING_EFFORTS_MAX_KEYS:
            raise ValueError(
                f"agent_model_reasoning_efforts must have at most {AGENT_MODEL_REASONING_EFFORTS_MAX_KEYS} entries"
            )
    return normalized or None


def parse_agent_model_reasoning_efforts_or_none(
    value: object,
) -> dict[str, ReasoningEffort] | None:
    if value is None or isinstance(value, dict):
        return normalize_agent_model_reasoning_efforts_payload_or_none(value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return None
    return normalize_agent_model_reasoning_efforts_payload_or_none(decoded)


def finalize_agent_model_reasoning_efforts_for_storage(
    payload: dict[str, ReasoningEffort] | None,
    *,
    available_agent_models: list[str],
) -> str | None:
    if not payload:
        return None
    available_by_fold = {model.casefold(): model for model in available_agent_models}
    normalized = normalize_agent_model_reasoning_efforts_payload_or_none(payload) or {}
    pruned = {
        canonical: effort
        for key, effort in normalized.items()
        if (canonical := available_by_fold.get(key.casefold())) is not None
    }
    return json.dumps(pruned, ensure_ascii=False) if pruned else None


def resolve_model_reasoning_effort(
    model_name: str,
    configured_efforts: dict[str, ReasoningEffort],
) -> ReasoningEffort | None:
    selected_key = model_name.casefold()
    return next(
        (effort for model, effort in configured_efforts.items() if model.casefold() == selected_key),
        None,
    )
