# CALLING SPEC:
# - Purpose: Agent subsystem helpers for `payload_normalization`.
# - Inputs: Callers import `backend/services/agent/payload_normalization` and invoke `normalize_loose_text`, `normalize_required_text`, `normalize_optional_category`.
# - Outputs: Exports `normalize_loose_text`, `normalize_required_text`, `normalize_optional_category`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from backend.validation.finance_names import normalize_entity_category


def normalize_loose_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def normalize_required_text(value: str) -> str:
    normalized = normalize_loose_text(value)
    if normalized is None:
        raise ValueError("value cannot be empty")
    return normalized


def normalize_optional_category(value: str | None) -> str | None:
    return normalize_entity_category(value)
