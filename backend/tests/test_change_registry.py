# CALLING SPEC:
# - Purpose: verify the change-type registry stays complete and behavior-identical to legacy wiring.
# - Inputs: registry exports and the derived proposal/apply/normalization surfaces.
# - Outputs: pytest assertions for equality, completeness, and summary coverage.
# - Side effects: none.
from __future__ import annotations

from dataclasses import fields
from datetime import date

import pytest

from backend.enums_agent import AgentChangeType
from backend.enums_finance import EntryKind, GroupSource
from backend.services.agent.apply.dispatch import APPLY_CHANGE_HANDLERS
from backend.services.agent.change_contracts import CHANGE_PAYLOAD_MODELS
from backend.services.agent.change_registry import (
    CHANGE_TYPE_SPECS,
    apply_change_handlers,
    change_payload_models,
    change_type_review_order,
    change_type_spec,
    payload_normalizers,
    proposal_summary_for_payload,
)
from backend.services.agent.proposal_metadata import ProposalMetadata, proposal_metadata_for_change_type
from backend.services.agent.proposals.normalization import PAYLOAD_NORMALIZERS
from backend.services.agent.reviews.ordering import CHANGE_TYPE_REVIEW_ORDER


def _legacy_metadata_by_change_type() -> dict[str, ProposalMetadata]:
    return {
        change_type.value: proposal_metadata_for_change_type(change_type)
        for change_type in AgentChangeType
    }


def _registry_metadata_by_change_type() -> dict[str, ProposalMetadata]:
    return {
        spec.change_type.value: ProposalMetadata(
            change_action=spec.action,
            proposal_type=spec.domain,
            cli_command=spec.bh_command_label,
        )
        for spec in CHANGE_TYPE_SPECS.values()
    }


def test_registry_payload_models_match_legacy_map() -> None:
    assert change_payload_models() == CHANGE_PAYLOAD_MODELS


def test_registry_normalizers_match_legacy_map() -> None:
    assert payload_normalizers() == PAYLOAD_NORMALIZERS


def test_registry_apply_handlers_match_legacy_map() -> None:
    assert apply_change_handlers() == APPLY_CHANGE_HANDLERS


def test_registry_review_order_matches_legacy_map() -> None:
    assert change_type_review_order() == CHANGE_TYPE_REVIEW_ORDER


def test_registry_metadata_matches_legacy_metadata() -> None:
    assert _registry_metadata_by_change_type() == _legacy_metadata_by_change_type()


def test_every_agent_change_type_has_registry_spec() -> None:
    assert set(CHANGE_TYPE_SPECS) == set(AgentChangeType)


def test_every_registry_spec_field_is_populated() -> None:
    optional_null_fields = {"stored_payload_model", "benchmark_prediction", "benchmark_bucket"}
    for change_type in AgentChangeType:
        spec = change_type_spec(change_type)
        for field in fields(spec):
            value = getattr(spec, field.name)
            if field.name in optional_null_fields:
                continue
            assert value is not None, f"{change_type.value}.{field.name} must be set"


def test_summaries_use_registry_summarizers() -> None:
    for change_type in AgentChangeType:
        payload = _representative_payload(change_type)
        spec = change_type_spec(change_type)
        assert proposal_summary_for_payload(change_type, payload) == spec.summarize(payload)


def test_summarize_returns_non_empty_string_for_each_change_type() -> None:
    for change_type in AgentChangeType:
        payload = _representative_payload(change_type)
        summary = change_type_spec(change_type).summarize(payload)
        assert isinstance(summary, str)
        assert summary.strip()


def test_missing_spec_would_fail_completeness() -> None:
    incomplete = dict(CHANGE_TYPE_SPECS)
    incomplete.pop(AgentChangeType.CREATE_TAG)
    with pytest.raises(AssertionError):
        assert set(incomplete) == set(AgentChangeType)


def _representative_payload(change_type: AgentChangeType) -> dict:
    builders = {
        AgentChangeType.CREATE_TAG: lambda: {"name": "food", "type": "expense"},
        AgentChangeType.UPDATE_TAG: lambda: {"name": "food", "patch": {"type": "expense"}},
        AgentChangeType.DELETE_TAG: lambda: {"name": "food"},
        AgentChangeType.CREATE_ENTITY: lambda: {"name": "Cash", "category": "asset"},
        AgentChangeType.UPDATE_ENTITY: lambda: {"name": "Cash", "patch": {"category": "asset"}},
        AgentChangeType.DELETE_ENTITY: lambda: {"name": "Cash"},
        AgentChangeType.CREATE_ACCOUNT: lambda: {
            "name": "Checking",
            "currency_code": "USD",
            "is_active": True,
        },
        AgentChangeType.UPDATE_ACCOUNT: lambda: {"name": "Checking", "patch": {"is_active": False}},
        AgentChangeType.DELETE_ACCOUNT: lambda: {"name": "Checking"},
        AgentChangeType.CREATE_SNAPSHOT: lambda: {
            "account_id": "abcd1234567890123456789012345678",
            "account_name": "Checking",
            "currency_code": "USD",
            "snapshot_at": "2026-01-01",
            "balance_minor": 1000,
        },
        AgentChangeType.DELETE_SNAPSHOT: lambda: {
            "account_id": "abcd1234567890123456789012345678",
            "account_name": "Checking",
            "currency_code": "USD",
            "snapshot_id": "snap1234567890123456789012345678",
            "snapshot_at": "2026-01-01",
            "balance_minor": 1000,
        },
        AgentChangeType.CREATE_ENTRY: lambda: {
            "kind": EntryKind.EXPENSE.value,
            "date": date(2026, 1, 1).isoformat(),
            "name": "Coffee",
            "amount_minor": 500,
            "currency_code": "USD",
            "from_entity": "Cash",
            "to_entity": "Coffee Shop",
            "tags": ["food"],
            "category": "dining",
            "lifecycle": None,
            "markdown_notes": "morning coffee",
        },
        AgentChangeType.UPDATE_ENTRY: lambda: {
            "entry_id": "entr1234567890123456789012345678",
            "patch": {"name": "Updated Coffee"},
        },
        AgentChangeType.DELETE_ENTRY: lambda: {"entry_id": "entr1234567890123456789012345678"},
        AgentChangeType.CREATE_GROUP: lambda: {"name": "Trips", "source": GroupSource.MANUAL.value},
        AgentChangeType.UPDATE_GROUP: lambda: {
            "group_id": "grp123456789012345678901234567890",
            "patch": {"name": "Updated Trips"},
        },
        AgentChangeType.DELETE_GROUP: lambda: {"group_id": "grp123456789012345678901234567890"},
        AgentChangeType.CREATE_GROUP_MEMBER: lambda: {
            "action": "add",
            "group_ref": {"group_id": "grp123456789012345678901234567890"},
            "target": {
                "target_type": "entry",
                "entry_ref": {"entry_id": "entr1234567890123456789012345678"},
            },
        },
        AgentChangeType.DELETE_GROUP_MEMBER: lambda: {
            "action": "remove",
            "group_ref": {"group_id": "grp123456789012345678901234567890"},
            "target": {
                "target_type": "entry",
                "entry_ref": {"entry_id": "entr1234567890123456789012345678"},
            },
        },
    }
    return builders[change_type]()
