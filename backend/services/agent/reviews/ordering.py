# CALLING SPEC:
# - Purpose: dependency-friendly review ordering for agent change items.
# - Inputs: callers that import `backend/services/agent/reviews/ordering.py` and pass `AgentChangeItem` rows.
# - Outputs: sort keys and ordered item lists aligned with the web review modal.
# - Side effects: none.
from __future__ import annotations

from backend.enums_agent import AgentChangeType
from backend.models_agent import AgentChangeItem

CHANGE_TYPE_REVIEW_ORDER: dict[AgentChangeType, int] = {
    AgentChangeType.CREATE_ACCOUNT: 100,
    AgentChangeType.UPDATE_ACCOUNT: 101,
    AgentChangeType.DELETE_ACCOUNT: 102,
    AgentChangeType.CREATE_SNAPSHOT: 200,
    AgentChangeType.DELETE_SNAPSHOT: 201,
    AgentChangeType.CREATE_ENTITY: 300,
    AgentChangeType.UPDATE_ENTITY: 301,
    AgentChangeType.DELETE_ENTITY: 302,
    AgentChangeType.CREATE_TAG: 400,
    AgentChangeType.UPDATE_TAG: 401,
    AgentChangeType.DELETE_TAG: 402,
    AgentChangeType.CREATE_GROUP: 500,
    AgentChangeType.UPDATE_GROUP: 501,
    AgentChangeType.DELETE_GROUP: 502,
    AgentChangeType.CREATE_ENTRY: 600,
    AgentChangeType.UPDATE_ENTRY: 601,
    AgentChangeType.DELETE_ENTRY: 602,
    AgentChangeType.CREATE_GROUP_MEMBER: 700,
    AgentChangeType.DELETE_GROUP_MEMBER: 701,
}


def change_item_review_sort_key(item: AgentChangeItem) -> tuple[int, str, str]:
    return (
        CHANGE_TYPE_REVIEW_ORDER[item.change_type],
        item.created_at.isoformat(),
        item.id,
    )


def sort_change_items_for_review(items: list[AgentChangeItem]) -> list[AgentChangeItem]:
    return sorted(items, key=change_item_review_sort_key)
