# CALLING SPEC:
# - Purpose: evaluate group rule trees against entry context and summarize rules.
# - Inputs: callers that import `backend/services/group_rules.py` with GroupRule and EntryRuleContext.
# - Outputs: rule evaluation and summary helpers.
# - Side effects: module-local behavior only.
from __future__ import annotations

from datetime import date

from backend.enums_finance import EntryKind
from backend.schemas_group_rules import (
    GroupRule,
    GroupRuleCondition,
    GroupRuleGroup,
    GroupRuleNode,
)


class EntryRuleContext:
    __slots__ = (
        "kind",
        "tag_names",
        "is_internal_transfer",
        "category_path",
        "from_entity",
        "to_entity",
        "amount_minor",
        "occurred_at",
    )

    def __init__(
        self,
        *,
        kind: EntryKind,
        tag_names: frozenset[str],
        is_internal_transfer: bool,
        category_path: str | None,
        from_entity: str | None,
        to_entity: str | None,
        amount_minor: int,
        occurred_at: date,
    ) -> None:
        self.kind = kind
        self.tag_names = tag_names
        self.is_internal_transfer = is_internal_transfer
        self.category_path = category_path
        self.from_entity = (from_entity or "").strip().lower()
        self.to_entity = (to_entity or "").strip().lower()
        self.amount_minor = amount_minor
        self.occurred_at = occurred_at


def evaluate_group_rule(rule: GroupRule, context: EntryRuleContext) -> bool:
    if not _evaluate_group(rule.include, context):
        return False
    if rule.exclude is not None and _evaluate_group(rule.exclude, context):
        return False
    return True


def summarize_group_rule(rule: GroupRule) -> str:
    include_summary = _summarize_group(rule.include)
    if rule.exclude is None:
        return include_summary
    return f"{include_summary}; excluding {_summarize_group(rule.exclude)}"


def _evaluate_group(group: GroupRuleGroup, context: EntryRuleContext) -> bool:
    results = [_evaluate_node(child, context) for child in group.children]
    return all(results) if group.operator == "AND" else any(results)


def _evaluate_node(node: GroupRuleNode, context: EntryRuleContext) -> bool:
    if isinstance(node, GroupRuleGroup):
        return _evaluate_group(node, context)
    return _evaluate_condition(node, context)


def _evaluate_condition(condition: GroupRuleCondition, context: EntryRuleContext) -> bool:
    if condition.field == "entry_kind":
        return context.kind == EntryKind(str(condition.value))
    if condition.field == "is_internal_transfer":
        return context.is_internal_transfer is bool(condition.value)
    if condition.field == "tags":
        tag_values = frozenset(str(value) for value in condition.value) if isinstance(condition.value, list) else frozenset()
        if condition.operator == "has_any":
            return bool(context.tag_names & tag_values)
        if condition.operator == "has_none":
            return not bool(context.tag_names & tag_values)
        return False
    if condition.field == "category":
        category = (context.category_path or "").strip().lower()
        value = str(condition.value).strip().lower()
        if condition.operator == "is":
            return category == value
        return category.startswith(value)
    if condition.field == "from_entity":
        return context.from_entity == str(condition.value).strip().lower()
    if condition.field == "to_entity":
        return context.to_entity == str(condition.value).strip().lower()
    if condition.field == "amount_minor":
        if condition.operator == "gte":
            return context.amount_minor >= int(condition.value)
        if condition.operator == "lte":
            return context.amount_minor <= int(condition.value)
        if condition.operator == "eq":
            return context.amount_minor == int(condition.value)
        low, high = condition.value
        return int(low) <= context.amount_minor <= int(high)
    if condition.field == "occurred_at":
        if condition.operator == "before":
            return context.occurred_at < date.fromisoformat(str(condition.value))
        if condition.operator == "after":
            return context.occurred_at > date.fromisoformat(str(condition.value))
        start, end = condition.value
        return date.fromisoformat(str(start)) <= context.occurred_at <= date.fromisoformat(str(end))
    return False


def _summarize_group(group: GroupRuleGroup) -> str:
    joiner = " and " if group.operator == "AND" else " or "
    parts = [_summarize_node(child) for child in group.children]
    if len(parts) == 1:
        return parts[0]
    return f"({joiner.join(parts)})"


def _summarize_node(node: GroupRuleNode) -> str:
    if isinstance(node, GroupRuleGroup):
        return _summarize_group(node)
    return _summarize_condition(node)


def _summarize_condition(condition: GroupRuleCondition) -> str:
    if condition.field == "entry_kind":
        return f"kind is {str(condition.value).lower()}"
    if condition.field == "is_internal_transfer":
        return "is an internal transfer" if bool(condition.value) else "is not an internal transfer"
    if condition.field == "category":
        return f"category {condition.operator} {condition.value}"
    if condition.field == "from_entity":
        return f"from entity is {condition.value}"
    if condition.field == "to_entity":
        return f"to entity is {condition.value}"
    if condition.field == "amount_minor":
        return f"amount {condition.operator} {condition.value}"
    if condition.field == "occurred_at":
        return f"date {condition.operator} {condition.value}"
    values = [str(value) for value in condition.value] if isinstance(condition.value, list) else []
    if condition.operator == "has_any":
        return f"tags include {_join_values(values)}"
    return f"tags exclude {_join_values(values)}"


def _join_values(values: list[str]) -> str:
    if not values:
        return "(none)"
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} or {values[1]}"
    return f"{', '.join(values[:-1])}, or {values[-1]}"
