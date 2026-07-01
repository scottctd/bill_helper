# CALLING SPEC:
# - Purpose: map finance ORM rows to HTTP read DTOs for entries and shared ref shapes.
# - Inputs: entry rows plus optional category paths, group refs, or a membership snapshot.
# - Outputs: `EntryRead`, `EntryDetailRead`, `TagSummaryRead`, and `GroupRefRead` payloads.
# - Side effects: none.
from __future__ import annotations

from backend.models_finance import Entry, Group, Tag
from backend.schemas_finance import EntryDetailRead, EntryRead, GroupRefRead, TagSummaryRead
from backend.services.group_membership import GroupMembershipContext


def tag_to_summary(tag: Tag) -> TagSummaryRead:
    return TagSummaryRead(id=tag.id, name=tag.name, color=tag.color, description=tag.description)


def group_to_ref(group: Group) -> GroupRefRead:
    return GroupRefRead(
        id=group.id,
        name=group.name,
        source=group.source,
        color=group.color,
    )


def build_entry_groups(
    entry: Entry,
    *,
    membership: GroupMembershipContext,
) -> list[GroupRefRead]:
    return [group_to_ref(group) for group in membership.groups_for_entry(entry)]


def entry_to_schema(
    entry: Entry,
    *,
    category_path: str | None = None,
    groups: list[GroupRefRead] | None = None,
) -> EntryRead:
    from_entity_missing = bool(entry.from_entity and entry.from_entity_id is None)
    to_entity_missing = bool(entry.to_entity and entry.to_entity_id is None)
    return EntryRead(
        id=entry.id,
        kind=entry.kind,
        occurred_at=entry.occurred_at,
        name=entry.name,
        amount_minor=entry.amount_minor,
        currency_code=entry.currency_code,
        from_entity_id=entry.from_entity_id,
        to_entity_id=entry.to_entity_id,
        owner_user_id=entry.owner_user_id,
        from_entity=entry.from_entity,
        from_entity_missing=from_entity_missing,
        to_entity=entry.to_entity,
        to_entity_missing=to_entity_missing,
        owner=entry.owner,
        markdown_body=entry.markdown_body,
        lifecycle=entry.lifecycle,
        category=category_path,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        tags=[tag_to_summary(tag) for tag in entry.tags],
        groups=groups or [],
    )


def entry_to_detail_schema(
    entry: Entry,
    *,
    category_path: str | None = None,
    groups: list[GroupRefRead] | None = None,
) -> EntryDetailRead:
    return EntryDetailRead(**entry_to_schema(entry, category_path=category_path, groups=groups).model_dump())
