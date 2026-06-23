from __future__ import annotations

from types import SimpleNamespace

from backend.enums_agent import AgentChangeType
from backend.models_agent import AgentChangeItem
from backend.services.agent.benchmark_interface import _predictions_from_change_items
from backend.services.agent.proposal_http import _proposal_summary
from backend.services.agent.proposals.entries import entry_preview_from_proposal
from backend.services.entries import normalize_entry_category_reference


def test_normalize_entry_category_reference_accepts_leaf_and_path() -> None:
    assert normalize_entry_category_reference("groceries") == "groceries"
    assert normalize_entry_category_reference("food_drink/groceries") == "groceries"
    assert normalize_entry_category_reference("food_drink/groceries/") == "groceries"


def test_predictions_from_change_items_includes_entry_category_and_lifecycle() -> None:
    item = AgentChangeItem(
        id="proposal-1",
        run_id="run-1",
        change_type=AgentChangeType.CREATE_ENTRY,
        payload_json={
            "kind": "EXPENSE",
            "date": "2026-03-15",
            "name": "Farm Boy",
            "amount_minor": 1234,
            "currency_code": "CAD",
            "from_entity": "Checking",
            "to_entity": "Farm Boy",
            "tags": ["grocery"],
            "category": "food_drink/groceries",
            "lifecycle": "day_to_day",
        },
    )

    predictions = _predictions_from_change_items([item])

    assert len(predictions.entries) == 1
    assert predictions.entries[0]["category"] == "food_drink/groceries"
    assert predictions.entries[0]["lifecycle"] == "day_to_day"


def test_entry_preview_from_proposal_includes_category_and_lifecycle() -> None:
    item = SimpleNamespace(
        id="proposal-12345678",
        status=SimpleNamespace(value="pending_review"),
        payload_json={
            "kind": "EXPENSE",
            "date": "2026-03-15",
            "name": "Farm Boy",
            "amount_minor": 1234,
            "currency_code": "CAD",
            "from_entity": "Checking",
            "to_entity": "Farm Boy",
            "category": "food_drink/groceries",
            "lifecycle": "day_to_day",
        },
    )

    preview = entry_preview_from_proposal(item)

    assert preview["category"] == "food_drink/groceries"
    assert preview["lifecycle"] == "day_to_day"


def test_proposal_summary_includes_create_entry_category_and_lifecycle() -> None:
    item = SimpleNamespace(
        change_type=AgentChangeType.CREATE_ENTRY,
        payload_json={
            "date": "2026-03-15",
            "name": "Farm Boy",
            "amount_minor": 1234,
            "currency_code": "CAD",
            "from_entity": "Checking",
            "to_entity": "Farm Boy",
            "tags": [],
            "category": "food_drink/groceries",
            "lifecycle": "day_to_day",
        },
    )

    summary = _proposal_summary(item)

    assert "category=food_drink/groceries" in summary
    assert "lifecycle=day_to_day" in summary
