# CALLING SPEC:
# - Purpose: format short proposal summaries per change payload shape for HTTP and review UI.
# - Inputs: validated or stored proposal payload dicts keyed by field names.
# - Outputs: one-line human-readable summary strings; optional benchmark prediction dicts.
# - Side effects: none.
from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def summarize_create_entry_payload(payload: Mapping[str, Any]) -> str:
    category = payload.get("category")
    lifecycle = payload.get("lifecycle")
    classification = []
    if category:
        classification.append(f"category={category}")
    if lifecycle:
        classification.append(f"lifecycle={lifecycle}")
    classification_text = f" {' '.join(classification)}" if classification else ""
    return (
        f"create entry {payload.get('date')} {payload.get('name')} {payload.get('amount_minor')} "
        f"{payload.get('currency_code')} from={payload.get('from_entity')} to={payload.get('to_entity')} "
        f"tags={payload.get('tags') or []}{classification_text}"
    )


def summarize_update_entry_payload(payload: Mapping[str, Any]) -> str:
    return f"update entry target={payload.get('entry_id')} patch={payload.get('patch') or {}}"


def summarize_delete_entry_payload(payload: Mapping[str, Any]) -> str:
    return f"delete entry target={payload.get('entry_id')}"


def summarize_create_group_payload(payload: Mapping[str, Any]) -> str:
    return f"create group name={payload.get('name')} source={payload.get('source')}"


def summarize_update_group_payload(payload: Mapping[str, Any]) -> str:
    return f"update group group_id={payload.get('group_id')} patch={payload.get('patch') or {}}"


def summarize_delete_group_payload(payload: Mapping[str, Any]) -> str:
    return f"delete group group_id={payload.get('group_id')}"


def summarize_create_group_member_payload(payload: Mapping[str, Any]) -> str:
    target = payload.get("target") or {}
    override = target.get("override") if isinstance(target, dict) else None
    override_text = f" override={override}" if override else ""
    return (
        f"add group member group_ref={payload.get('group_ref')} "
        f"target={payload.get('target')}{override_text}"
    )


def summarize_delete_group_member_payload(payload: Mapping[str, Any]) -> str:
    return f"remove group member group_ref={payload.get('group_ref')} target={payload.get('target')}"


def summarize_create_tag_payload(payload: Mapping[str, Any]) -> str:
    return f"create tag name={payload.get('name')} type={payload.get('type')}"


def summarize_update_tag_payload(payload: Mapping[str, Any]) -> str:
    return f"update tag name={payload.get('name')} patch={payload.get('patch') or {}}"


def summarize_delete_tag_payload(payload: Mapping[str, Any]) -> str:
    return f"delete tag name={payload.get('name')}"


def summarize_create_entity_payload(payload: Mapping[str, Any]) -> str:
    return f"create entity name={payload.get('name')} category={payload.get('category')}"


def summarize_update_entity_payload(payload: Mapping[str, Any]) -> str:
    return f"update entity name={payload.get('name')} patch={payload.get('patch') or {}}"


def summarize_delete_entity_payload(payload: Mapping[str, Any]) -> str:
    return f"delete entity name={payload.get('name')}"


def summarize_create_account_payload(payload: Mapping[str, Any]) -> str:
    return (
        f"create account name={payload.get('name')} currency={payload.get('currency_code')} "
        f"is_active={payload.get('is_active')}"
    )


def summarize_update_account_payload(payload: Mapping[str, Any]) -> str:
    return f"update account name={payload.get('name')} patch={payload.get('patch') or {}}"


def summarize_delete_account_payload(payload: Mapping[str, Any]) -> str:
    return f"delete account name={payload.get('name')}"


def summarize_create_snapshot_payload(payload: Mapping[str, Any]) -> str:
    return (
        f"create snapshot account_id={payload.get('account_id')} date={payload.get('snapshot_at')} "
        f"balance_minor={payload.get('balance_minor')}"
    )


def summarize_delete_snapshot_payload(payload: Mapping[str, Any]) -> str:
    return (
        f"delete snapshot account_id={payload.get('account_id')} "
        f"snapshot_id={payload.get('snapshot_id')}"
    )


def benchmark_create_tag_prediction(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": payload.get("name"),
        "type": payload.get("type"),
    }


def benchmark_create_entity_prediction(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": payload.get("name"),
        "category": payload.get("category"),
    }


def benchmark_create_entry_prediction(payload: Mapping[str, Any]) -> dict[str, Any]:
    entry_prediction = {
        "kind": payload.get("kind"),
        "date": payload.get("date"),
        "name": payload.get("name"),
        "amount_minor": payload.get("amount_minor"),
        "currency_code": payload.get("currency_code"),
        "from_entity": payload.get("from_entity"),
        "to_entity": payload.get("to_entity"),
        "tags": payload.get("tags", []),
        "category": payload.get("category"),
        "lifecycle": payload.get("lifecycle"),
    }
    entry_prediction["markdown_notes"] = payload.get("markdown_notes")
    return entry_prediction
