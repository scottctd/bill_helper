from __future__ import annotations

from backend.enums_agent import AgentChangeType
from backend.models_agent import AgentChangeItem
from backend.services.import_workflow.dedup import proposal_dedup_signature


def _entry_item(**payload) -> AgentChangeItem:
    return AgentChangeItem(
        id="proposal-1",
        run_id="run-1",
        change_type=AgentChangeType.CREATE_ENTRY,
        payload_json={
            "kind": "EXPENSE",
            "date": "2026-03-15",
            "name": "Farm Boy",
            "amount_minor": 1234,
            "currency_code": "CAD",
            "from_entity": "Main Checking",
            "to_entity": "Cafe",
            **payload,
        },
    )


def test_create_entry_dedup_signature_distinguishes_category_and_lifecycle() -> None:
    base = _entry_item()
    categorized = _entry_item(category="food_drink/groceries", lifecycle="day_to_day")
    tagged = _entry_item(tags=["travel"])

    assert proposal_dedup_signature(base) != proposal_dedup_signature(categorized)
    assert proposal_dedup_signature(base) != proposal_dedup_signature(tagged)
    assert proposal_dedup_signature(categorized) != proposal_dedup_signature(tagged)
