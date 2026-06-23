# CALLING SPEC:
# - Purpose: compute deterministic dedup signatures for import-job proposal aggregation.
# - Inputs: agent change items from import task runs.
# - Outputs: hashable signature tuples keyed by change type.
# - Side effects: none.
from __future__ import annotations

import hashlib
import json
from typing import Any

from backend.enums_agent import AgentChangeType
from backend.models_agent import AgentChangeItem
from backend.validation.finance_names import normalize_entity_name, normalize_tag_name


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def proposal_dedup_signature(item: AgentChangeItem) -> tuple[Any, ...]:
    payload = item.payload_json
    change_type = item.change_type

    if change_type == AgentChangeType.CREATE_ENTRY:
        normalized_tags = sorted(normalize_tag_name(str(tag)) for tag in (payload.get("tags") or []) if tag)
        return (
            change_type.value,
            payload.get("kind"),
            payload.get("date"),
            payload.get("amount_minor"),
            payload.get("currency_code"),
            payload.get("from_entity"),
            payload.get("to_entity"),
            payload.get("name"),
            payload.get("markdown_notes"),
            payload.get("category"),
            payload.get("lifecycle"),
            tuple(normalized_tags),
        )
    if change_type in {AgentChangeType.CREATE_ENTITY, AgentChangeType.CREATE_ACCOUNT}:
        name = payload.get("name")
        normalized = normalize_entity_name(str(name)) if isinstance(name, str) else name
        return (change_type.value, normalized, payload.get("entity_category"))
    if change_type == AgentChangeType.CREATE_TAG:
        name = payload.get("name")
        normalized = normalize_tag_name(str(name)) if isinstance(name, str) else name
        return (change_type.value, normalized)
    if change_type == AgentChangeType.CREATE_GROUP:
        return (change_type.value, payload.get("name"), payload.get("source"))
    if change_type.value.startswith("update_") or change_type.value.startswith("delete_"):
        payload_hash = hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()
        return (
            change_type.value,
            item.applied_resource_type,
            item.applied_resource_id,
            payload_hash,
        )
    payload_hash = hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()
    return (change_type.value, payload_hash)
