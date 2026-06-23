# CALLING SPEC:
# - Purpose: implement focused service logic for `filter_groups`.
# - Inputs: callers that import `backend/services/filter_groups.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `filter_groups`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.enums_finance import EntryKind
from backend.models_finance import Account, Entry, FilterGroup
from backend.schemas_finance import (
    FilterGroupCreate,
    FilterGroupRead,
    FilterGroupRule,
    FilterGroupUpdate,
)
from backend.services.access_scope import account_owner_filter, load_filter_group_for_principal
from backend.services.crud_policy import PolicyViolation
from backend.services.filter_group_rules import (
    FilterEntryContext,
    evaluate_filter_group_rule,
    summarize_filter_group_rule,
)
from backend.services.tags import normalize_tag_color

@dataclass(frozen=True, slots=True)
class FilterGroupDefinition:
    id: str
    key: str
    name: str
    description: str | None
    color: str | None
    is_default: bool
    position: int
    rule: FilterGroupRule
    created_at: datetime
    updated_at: datetime


def normalize_filter_group_name(name: str) -> str:
    normalized = " ".join(name.split()).strip()
    if not normalized:
        raise PolicyViolation.bad_request("Filter group name cannot be empty")
    return normalized


def list_filter_group_definitions(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> list[FilterGroupDefinition]:
    rows = list(
        db.scalars(
            select(FilterGroup)
            .where(FilterGroup.owner_user_id == principal.user_id)
            .order_by(FilterGroup.position.asc(), FilterGroup.created_at.asc())
        )
    )
    return [_build_definition(row) for row in rows]


def list_filter_group_reads(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> list[FilterGroupRead]:
    return [build_filter_group_read(definition) for definition in list_filter_group_definitions(db, principal=principal)]


def get_filter_group_definition(
    db: Session,
    *,
    filter_group_id: str,
    principal: RequestPrincipal,
) -> FilterGroupDefinition:
    row = load_filter_group_for_principal(
        db,
        filter_group_id=filter_group_id,
        principal=principal,
    )
    return _build_definition(row)


def create_filter_group(
    db: Session,
    *,
    payload: FilterGroupCreate,
    principal: RequestPrincipal,
) -> FilterGroupDefinition:
    normalized_name = normalize_filter_group_name(payload.name)
    _assert_unique_name(db, principal=principal, name=normalized_name)

    next_position = int(
        db.scalar(
            select(func.coalesce(func.max(FilterGroup.position), -1)).where(
                FilterGroup.owner_user_id == principal.user_id
            )
        )
        or -1
    ) + 1

    row = FilterGroup(
        owner_user_id=principal.user_id,
        key=f"custom_{uuid4().hex[:12]}",
        name=normalized_name,
        description=_normalize_optional_text(payload.description),
        color=normalize_tag_color(payload.color),
        is_default=False,
        position=next_position,
        definition_json=payload.rule.model_dump(mode="json"),
    )
    db.add(row)
    db.flush()
    return _build_definition(row)


def update_filter_group(
    db: Session,
    *,
    filter_group_id: str,
    payload: FilterGroupUpdate,
    principal: RequestPrincipal,
) -> FilterGroupDefinition:
    row = load_filter_group_for_principal(
        db,
        filter_group_id=filter_group_id,
        principal=principal,
    )

    if "name" in payload.model_fields_set:
        normalized_name = normalize_filter_group_name(payload.name or "")
        _assert_unique_name(db, principal=principal, name=normalized_name, current_id=row.id)
        row.name = normalized_name

    if "description" in payload.model_fields_set:
        row.description = _normalize_optional_text(payload.description)
    if "color" in payload.model_fields_set:
        row.color = normalize_tag_color(payload.color)
    if "rule" in payload.model_fields_set and payload.rule is not None:
        row.definition_json = payload.rule.model_dump(mode="json")

    db.add(row)
    db.flush()
    return _build_definition(row)


def delete_filter_group(
    db: Session,
    *,
    filter_group_id: str,
    principal: RequestPrincipal,
) -> None:
    row = load_filter_group_for_principal(
        db,
        filter_group_id=filter_group_id,
        principal=principal,
    )
    db.delete(row)
    db.flush()


def build_filter_group_read(definition: FilterGroupDefinition) -> FilterGroupRead:
    return FilterGroupRead(
        id=definition.id,
        key=definition.key,
        name=definition.name,
        description=_filter_group_description(definition),
        color=definition.color,
        is_default=definition.is_default,
        position=definition.position,
        rule=definition.rule,
        rule_summary=_filter_group_rule_summary(definition),
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )


def build_filter_group_read_from_row(row: FilterGroup) -> FilterGroupRead:
    return build_filter_group_read(_build_definition(row))


def list_account_entity_ids_for_principal(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> set[str]:
    return {
        entity_id
        for entity_id in db.scalars(
            select(Account.id).where(account_owner_filter(principal))
        ).all()
        if entity_id
    }


def entry_matches_filter_group(
    entry: Entry,
    *,
    filter_group: FilterGroupDefinition,
    account_entity_ids: set[str],
    filter_groups: list[FilterGroupDefinition],
) -> bool:
    context = build_filter_entry_context(
        entry,
        account_entity_ids=account_entity_ids,
    )
    return filter_group.key in matching_filter_group_keys(
        context=context,
        filter_groups=filter_groups,
    )


def build_filter_entry_context(
    entry: Entry,
    *,
    account_entity_ids: set[str],
) -> FilterEntryContext:
    return FilterEntryContext(
        kind=EntryKind(entry.kind),
        tag_names=frozenset(tag.name.strip().lower() for tag in entry.tags if tag.name),
        is_internal_transfer=(
            entry.from_entity_id is not None
            and entry.to_entity_id is not None
            and entry.from_entity_id in account_entity_ids
            and entry.to_entity_id in account_entity_ids
        ),
    )


def matching_filter_group_keys(
    *,
    context: FilterEntryContext,
    filter_groups: list[FilterGroupDefinition],
) -> list[str]:
    """Return every filter-group key whose rule matches the context.

    Filter groups are user-defined auxiliary bundles. An entry may match several
    cross-cuts, so all matching keys are returned in definition order.
    """
    return [
        filter_group.key
        for filter_group in filter_groups
        if evaluate_filter_group_rule(filter_group.rule, context)
    ]


def _assert_unique_name(
    db: Session,
    *,
    principal: RequestPrincipal,
    name: str,
    current_id: str | None = None,
) -> None:
    existing = db.scalar(
        select(FilterGroup).where(
            FilterGroup.owner_user_id == principal.user_id,
            func.lower(FilterGroup.name) == name.lower(),
        )
    )
    if existing is None or existing.id == current_id:
        return
    raise PolicyViolation.conflict("Filter group name already exists")


def _build_definition(row: FilterGroup) -> FilterGroupDefinition:
    return FilterGroupDefinition(
        id=row.id,
        key=row.key,
        name=row.name,
        description=row.description,
        color=row.color,
        is_default=row.is_default,
        position=row.position,
        rule=FilterGroupRule.model_validate(row.definition_json),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def _filter_group_description(definition: FilterGroupDefinition) -> str | None:
    return definition.description


def _filter_group_rule_summary(definition: FilterGroupDefinition) -> str:
    return summarize_filter_group_rule(definition.rule)
