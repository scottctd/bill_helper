# CALLING SPEC:
# - Purpose: entry list/detail read-model assembly and filtered queries for principals.
# - Inputs: `Session`, `RequestPrincipal`, list filter params, and entry ids for detail reads.
# - Outputs: `EntryRead`, `EntryDetailRead`, and `EntryListResponse` payloads.
# - Side effects: database reads only.
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryKind
from backend.models_finance import Entry, Group, Tag, Taxonomy, TaxonomyAssignment, TaxonomyTerm
from backend.schemas_finance import EntryDetailRead, EntryListResponse, EntryRead
from backend.services.access_scope import (
    entry_owner_filter,
    get_entry_for_principal_or_404,
    get_group_for_principal_or_404,
)
from backend.services.group_membership import GroupMembershipContext
from backend.services.groups import group_load_options
from backend.services.serializers import build_entry_groups, entry_to_detail_schema, entry_to_schema
from backend.services.taxonomy import normalize_term_name
from backend.services.taxonomy_constants import ENTRY_CATEGORY_SUBJECT_TYPE, ENTRY_CATEGORY_TAXONOMY_KEY
from backend.validation.finance_names import normalize_tag_name


@dataclass(frozen=True, slots=True)
class EntryListFilters:
    start_date: date | None = None
    end_date: date | None = None
    kind: EntryKind | None = None
    tag: str | None = None
    currency: str | None = None
    source: str | None = None
    account_id: str | None = None
    category: str | None = None
    group_id: str | None = None
    from_entity: tuple[str, ...] = ()
    to_entity: tuple[str, ...] = ()
    limit: int = 50
    offset: int = 0


def entry_load_options():
    return (selectinload(Entry.tags), selectinload(Entry.group_members))


def load_entry_for_read(
    db: Session,
    *,
    entry_id: str,
    principal: RequestPrincipal,
) -> Entry:
    return get_entry_for_principal_or_404(
        db,
        entry_id=entry_id,
        principal=principal,
        stmt=select(Entry).options(*entry_load_options()),
    )


def build_entry_read(
    entry: Entry,
    *,
    membership: GroupMembershipContext,
) -> EntryRead:
    entry_groups = build_entry_groups(entry, membership=membership)
    return entry_to_schema(
        entry,
        category_path=membership.category_paths.get(entry.id),
        groups=entry_groups,
    )


def build_entry_detail_read(
    entry: Entry,
    *,
    membership: GroupMembershipContext,
) -> EntryDetailRead:
    read = build_entry_read(entry, membership=membership)
    return entry_to_detail_schema(
        entry,
        category_path=membership.category_paths.get(entry.id),
        groups=read.groups,
    )


def get_entry_detail_for_principal(
    db: Session,
    *,
    entry_id: str,
    principal: RequestPrincipal,
) -> EntryDetailRead:
    entry = load_entry_for_read(db, entry_id=entry_id, principal=principal)
    membership = GroupMembershipContext.load_for_principal(db, principal=principal)
    return build_entry_detail_read(entry, membership=membership)


def list_entries_for_principal(
    db: Session,
    *,
    principal: RequestPrincipal,
    filters: EntryListFilters,
) -> EntryListResponse:
    conditions = _entry_list_conditions(principal=principal, filters=filters)
    stmt = (
        select(Entry)
        .where(*conditions)
        .options(selectinload(Entry.tags), *entry_load_options())
        .order_by(Entry.occurred_at.desc(), Entry.created_at.desc())
    )
    count_stmt = select(func.count(func.distinct(Entry.id))).where(*conditions)

    if filters.tag:
        normalized = normalize_tag_name(filters.tag)
        stmt = stmt.join(Entry.tags).where(Tag.name == normalized)
        count_stmt = count_stmt.select_from(Entry).join(Entry.tags).where(
            Tag.name == normalized,
            *conditions,
        )

    membership: GroupMembershipContext | None = None
    if filters.group_id is not None:
        group = get_group_for_principal_or_404(
            db,
            group_id=filters.group_id,
            principal=principal,
            stmt=select(Group).options(*group_load_options()),
        )
        membership = GroupMembershipContext.load_for_principal(db, principal=principal)
        effective_ids = membership.effective_entry_ids_for_group(group)
        if not effective_ids:
            return EntryListResponse(
                items=[],
                total=0,
                limit=filters.limit,
                offset=filters.offset,
            )
        stmt = stmt.where(Entry.id.in_(effective_ids))
        count_stmt = count_stmt.where(Entry.id.in_(effective_ids))

    total = int(db.scalar(count_stmt) or 0)
    entries = list(db.scalars(stmt.limit(filters.limit).offset(filters.offset)))

    if membership is None:
        membership = GroupMembershipContext.load_for_principal(db, principal=principal)

    return EntryListResponse(
        items=[build_entry_read(entry, membership=membership) for entry in entries],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )


def _entry_list_conditions(*, principal: RequestPrincipal, filters: EntryListFilters) -> list:
    conditions = [Entry.is_deleted.is_(False), entry_owner_filter(principal)]

    if filters.start_date is not None:
        conditions.append(Entry.occurred_at >= filters.start_date)
    if filters.end_date is not None:
        conditions.append(Entry.occurred_at <= filters.end_date)
    if filters.kind is not None:
        conditions.append(Entry.kind == filters.kind)
    if filters.currency is not None:
        conditions.append(Entry.currency_code == filters.currency.upper())
    if filters.account_id is not None:
        conditions.append(
            or_(
                Entry.from_entity_id == filters.account_id,
                Entry.to_entity_id == filters.account_id,
            )
        )
    if filters.source is not None:
        pattern = f"%{filters.source}%"
        conditions.append(
            or_(
                Entry.name.ilike(pattern),
                Entry.from_entity.ilike(pattern),
                Entry.to_entity.ilike(pattern),
            )
        )
    if filters.category is not None:
        conditions.append(_entry_category_filter_condition(filters.category))
    conditions.extend(
        _entry_entity_filter_conditions(
            from_entity=list(filters.from_entity),
            to_entity=list(filters.to_entity),
        )
    )
    return conditions


def _entry_entity_filter_conditions(
    *,
    from_entity: list[str] | None,
    to_entity: list[str] | None,
) -> list:
    conditions = []
    if from_entity:
        normalized_from = [value.strip() for value in from_entity if value.strip()]
        if normalized_from:
            conditions.append(
                or_(
                    *[
                        func.lower(Entry.from_entity) == value.lower()
                        for value in normalized_from
                    ]
                )
            )
    if to_entity:
        normalized_to = [value.strip() for value in to_entity if value.strip()]
        if normalized_to:
            conditions.append(
                or_(
                    *[
                        func.lower(Entry.to_entity) == value.lower()
                        for value in normalized_to
                    ]
                )
            )
    return conditions


def _entry_category_filter_condition(category: str):
    normalized_category = normalize_term_name(category.rsplit("/", 1)[-1])
    assigned_term = aliased(TaxonomyTerm)
    parent_term = aliased(TaxonomyTerm)
    category_assignment = (
        select(TaxonomyAssignment.id)
        .join(Taxonomy, Taxonomy.id == TaxonomyAssignment.taxonomy_id)
        .join(assigned_term, assigned_term.id == TaxonomyAssignment.term_id)
        .outerjoin(parent_term, parent_term.id == assigned_term.parent_term_id)
        .where(
            Taxonomy.key == ENTRY_CATEGORY_TAXONOMY_KEY,
            TaxonomyAssignment.subject_type == ENTRY_CATEGORY_SUBJECT_TYPE,
            TaxonomyAssignment.subject_id == Entry.id,
        )
    )
    if normalized_category == "uncategorized":
        return ~category_assignment.exists()
    return category_assignment.where(
        or_(
            assigned_term.normalized_name == normalized_category,
            parent_term.normalized_name == normalized_category,
        )
    ).exists()
