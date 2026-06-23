# CALLING SPEC:
# - Purpose: build EntryRuleContext values used by group rule evaluation.
# - Inputs: entry rows, category paths, and account entity ids.
# - Outputs: EntryRuleContext instances.
# - Side effects: none.
from __future__ import annotations

from backend.enums_finance import EntryKind
from backend.models_finance import Entry
from backend.services.group_rules import EntryRuleContext


def build_entry_rule_context(
    entry: Entry,
    *,
    category_path: str | None,
    account_entity_ids: set[str],
) -> EntryRuleContext:
    return EntryRuleContext(
        kind=EntryKind(entry.kind),
        tag_names=frozenset(tag.name.strip().lower() for tag in entry.tags if tag.name),
        is_internal_transfer=(
            entry.from_entity_id is not None
            and entry.to_entity_id is not None
            and entry.from_entity_id in account_entity_ids
            and entry.to_entity_id in account_entity_ids
        ),
        category_path=category_path,
        from_entity=entry.from_entity,
        to_entity=entry.to_entity,
        amount_minor=entry.amount_minor,
        occurred_at=entry.occurred_at,
    )
