# CALLING SPEC:
# - Purpose: dependency-friendly review ordering for agent change items.
# - Inputs: callers that import `backend/services/agent/reviews/ordering.py` and pass `AgentChangeItem` rows.
# - Outputs: sort keys and ordered item lists aligned with the web review modal.
# - Side effects: none.
from __future__ import annotations

from backend.models_agent import AgentChangeItem
from backend.services.agent.change_registry import change_type_review_order

CHANGE_TYPE_REVIEW_ORDER = change_type_review_order()


def change_item_review_sort_key(item: AgentChangeItem) -> tuple[int, str, str]:
    return (
        CHANGE_TYPE_REVIEW_ORDER[item.change_type],
        item.created_at.isoformat(),
        item.id,
    )


def sort_change_items_for_review(items: list[AgentChangeItem]) -> list[AgentChangeItem]:
    return sorted(items, key=change_item_review_sort_key)
