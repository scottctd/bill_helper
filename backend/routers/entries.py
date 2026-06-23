# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `entries` routes.
# - Inputs: callers that import `backend/routers/entries.py` and pass module-defined arguments or framework events.
# - Outputs: router callables and request/response adapters for `entries`.
# - Side effects: FastAPI routing and HTTP error translation.
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.enums_finance import EntryKind
from backend.models_finance import Entry, Group, Tag, Taxonomy, TaxonomyAssignment, TaxonomyTerm
from backend.schemas_finance import (
    EntryCreate,
    EntryDetailRead,
    EntryListResponse,
    EntryRead,
    EntryTagSuggestionRequest,
    EntryTagSuggestionResponse,
    EntryUpdate,
)
from backend.services.access_scope import (
    entry_owner_filter,
    get_entry_for_principal_or_404,
    group_owner_filter,
)
from backend.services.crud_policy import PolicyViolation
from backend.services.entries import (
    EntityRef,
    EntityRefPatch,
    EntryCreateCommand,
    EntryUpdateCommand,
    UserRef,
    UserRefPatch,
    create_entry_from_command,
    soft_delete_entry,
    update_entry_from_command,
)
from backend.services.entry_tag_suggestions import EntryTagSuggestionError, suggest_entry_tags
from backend.services.groups import (
    entry_matches_group,
    group_load_options,
    list_account_entity_ids_for_principal,
    load_group,
)
from backend.services.serializers import build_entry_groups, entry_to_detail_schema, entry_to_schema
from backend.services.taxonomy import get_entry_category_path_map, normalize_term_name
from backend.services.taxonomy_constants import ENTRY_CATEGORY_SUBJECT_TYPE, ENTRY_CATEGORY_TAXONOMY_KEY
from backend.validation.finance_names import normalize_tag_name

router = APIRouter(prefix="/entries", tags=["entries"])


class EntryListQueryParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_date: date | None = None
    end_date: date | None = None
    kind: EntryKind | None = None
    tag: str | None = None
    currency: str | None = None
    source: str | None = None
    account_id: str | None = None
    category: str | None = None
    group_id: str | None = None
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


def _entity_ref_or_none(
    *,
    entity_id: str | None,
    entity_name: str | None,
) -> EntityRef | None:
    if entity_id is None and entity_name is None:
        return None
    return EntityRef(entity_id=entity_id, name=entity_name)


def _entity_ref_patch_or_none(
    *,
    entity_id: str | None,
    entity_name: str | None,
    fields_set: set[str],
    id_field: str,
    name_field: str,
) -> EntityRefPatch | None:
    if id_field not in fields_set and name_field not in fields_set:
        return None
    return EntityRefPatch(entity_id=entity_id, name=entity_name)


def _user_ref_or_none(*, user_id: str | None, user_name: str | None) -> UserRef | None:
    if user_id is None and user_name is None:
        return None
    return UserRef(user_id=user_id, name=user_name)


def _user_ref_patch_or_none(
    *,
    user_id: str | None,
    user_name: str | None,
    fields_set: set[str],
) -> UserRefPatch | None:
    if "owner_user_id" not in fields_set and "owner" not in fields_set:
        return None
    return UserRefPatch(user_id=user_id, name=user_name)


def _entry_create_command_from_request(payload: EntryCreate) -> EntryCreateCommand:
    return EntryCreateCommand(
        kind=payload.kind,
        occurred_at=payload.occurred_at,
        name=payload.name,
        amount_minor=payload.amount_minor,
        currency_code=payload.currency_code,
        from_ref=_entity_ref_or_none(
            entity_id=payload.from_entity_id,
            entity_name=payload.from_entity,
        ),
        to_ref=_entity_ref_or_none(
            entity_id=payload.to_entity_id,
            entity_name=payload.to_entity,
        ),
        owner_ref=_user_ref_or_none(
            user_id=payload.owner_user_id,
            user_name=payload.owner,
        ),
        markdown_body=payload.markdown_body,
        tags=payload.tags,
        group_ids=payload.group_ids,
        category=payload.category,
        lifecycle=payload.lifecycle,
    )


def _entry_update_command_from_request(payload: EntryUpdate) -> EntryUpdateCommand:
    fields_set = set(payload.model_fields_set)
    command_payload = payload.model_dump(
        exclude_unset=True,
        exclude={
            "from_entity_id",
            "from_entity",
            "to_entity_id",
            "to_entity",
            "owner_user_id",
            "owner",
        },
    )
    from_ref = _entity_ref_patch_or_none(
        entity_id=payload.from_entity_id,
        entity_name=payload.from_entity,
        fields_set=fields_set,
        id_field="from_entity_id",
        name_field="from_entity",
    )
    if from_ref is not None:
        command_payload["from_ref"] = from_ref
    to_ref = _entity_ref_patch_or_none(
        entity_id=payload.to_entity_id,
        entity_name=payload.to_entity,
        fields_set=fields_set,
        id_field="to_entity_id",
        name_field="to_entity",
    )
    if to_ref is not None:
        command_payload["to_ref"] = to_ref
    owner_ref = _user_ref_patch_or_none(
        user_id=payload.owner_user_id,
        user_name=payload.owner,
        fields_set=fields_set,
    )
    if owner_ref is not None:
        command_payload["owner_ref"] = owner_ref
    return EntryUpdateCommand.model_validate(command_payload)


def _entry_load_options():
    return (selectinload(Entry.tags), selectinload(Entry.group_members))


def _load_groups_for_principal(db: Session, principal: RequestPrincipal) -> list[Group]:
    return list(
        db.scalars(
            select(Group)
            .where(group_owner_filter(principal))
            .options(*group_load_options())
        )
    )


def _load_owner_entries(db: Session, principal: RequestPrincipal) -> list[Entry]:
    return list(
        db.scalars(
            select(Entry)
            .where(Entry.is_deleted.is_(False), entry_owner_filter(principal))
            .options(selectinload(Entry.tags))
        )
    )


def _serialize_entry_read(
    db: Session,
    entry: Entry,
    *,
    principal: RequestPrincipal,
    groups: list[Group] | None = None,
    all_entries: list[Entry] | None = None,
    category_paths: dict[str, str] | None = None,
    account_entity_ids: set[str] | None = None,
) -> EntryRead:
    loaded_groups = groups if groups is not None else _load_groups_for_principal(db, principal)
    loaded_entries = all_entries if all_entries is not None else _load_owner_entries(db, principal)
    loaded_paths = category_paths if category_paths is not None else _entry_category_paths(db, loaded_entries)
    loaded_account_entity_ids = (
        account_entity_ids
        if account_entity_ids is not None
        else list_account_entity_ids_for_principal(db, principal=principal)
    )
    entry_groups = build_entry_groups(
        entry,
        groups=loaded_groups,
        category_path=loaded_paths.get(entry.id),
        account_entity_ids=loaded_account_entity_ids,
        all_entries=loaded_entries,
        category_paths=loaded_paths,
    )
    return entry_to_schema(entry, category_path=loaded_paths.get(entry.id), groups=entry_groups)


def _serialize_entry_detail(
    db: Session,
    entry: Entry,
    *,
    principal: RequestPrincipal,
) -> EntryDetailRead:
    read = _serialize_entry_read(db, entry, principal=principal)
    return EntryDetailRead(**read.model_dump())


def _get_entry_or_404(
    db: Session,
    entry_id: str,
    principal: RequestPrincipal,
) -> Entry:
    return get_entry_for_principal_or_404(
        db,
        entry_id=entry_id,
        principal=principal,
        stmt=select(Entry).options(*_entry_load_options()),
    )


def _entry_category_paths(db: Session, entries: list[Entry]) -> dict[str, str]:
    return get_entry_category_path_map(db, entry_ids=[entry.id for entry in entries])


@router.post("", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: EntryCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryRead:
    entry = create_entry_from_command(
        db,
        command=_entry_create_command_from_request(payload),
        principal=principal,
    )

    db.commit()
    return _serialize_entry_read(
        db,
        _get_entry_or_404(db, entry.id, principal),
        principal=principal,
    )


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


@router.get("", response_model=EntryListResponse)
def list_entries(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
    filters: EntryListQueryParams = Depends(),
    from_entity: list[str] | None = Query(default=None),
    to_entity: list[str] | None = Query(default=None),
) -> EntryListResponse:
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
    conditions.extend(_entry_entity_filter_conditions(from_entity=from_entity, to_entity=to_entity))

    stmt = (
        select(Entry)
        .where(*conditions)
        .options(selectinload(Entry.tags), *_entry_load_options())
        .order_by(Entry.occurred_at.desc(), Entry.created_at.desc())
    )
    count_stmt = select(func.count(func.distinct(Entry.id))).where(*conditions)

    if filters.tag:
        normalized = normalize_tag_name(filters.tag)
        stmt = stmt.join(Entry.tags).where(Tag.name == normalized)
        count_stmt = count_stmt.select_from(Entry).join(Entry.tags).where(Tag.name == normalized, *conditions)

    if filters.group_id is not None:
        group = load_group(db, filters.group_id)
        if group is None or group.owner_user_id != principal.user_id:
            raise PolicyViolation.not_found("Group not found")
        matching_entries = [
            entry
            for entry in db.scalars(stmt)
            if entry_matches_group(db, entry=entry, group=group, principal=principal)
        ]
        total = len(matching_entries)
        entries = matching_entries[filters.offset : filters.offset + filters.limit]
    else:
        total = int(db.scalar(count_stmt) or 0)
        entries = list(db.scalars(stmt.limit(filters.limit).offset(filters.offset)))

    groups = _load_groups_for_principal(db, principal)
    all_entries = _load_owner_entries(db, principal)
    category_paths = _entry_category_paths(db, all_entries)
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    return EntryListResponse(
        items=[
            _serialize_entry_read(
                db,
                entry,
                principal=principal,
                groups=groups,
                all_entries=all_entries,
                category_paths=category_paths,
                account_entity_ids=account_entity_ids,
            )
            for entry in entries
        ],
        total=total,
        limit=filters.limit,
        offset=filters.offset,
    )


@router.post("/tag-suggestion", response_model=EntryTagSuggestionResponse)
def suggest_tags_for_entry(
    payload: EntryTagSuggestionRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryTagSuggestionResponse:
    try:
        return suggest_entry_tags(
            db,
            principal=principal,
            draft=payload,
        )
    except EntryTagSuggestionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/{entry_id}", response_model=EntryDetailRead)
def get_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryDetailRead:
    entry = _get_entry_or_404(db, entry_id, principal)
    return _serialize_entry_detail(db, entry, principal=principal)


@router.patch("/{entry_id}", response_model=EntryRead)
def update_entry(
    entry_id: str,
    payload: EntryUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryRead:
    entry = update_entry_from_command(
        db,
        entry_id=entry_id,
        command=_entry_update_command_from_request(payload),
        principal=principal,
    )

    db.commit()
    return _serialize_entry_read(
        db,
        _get_entry_or_404(db, entry.id, principal),
        principal=principal,
    )


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    entry = _get_entry_or_404(db, entry_id, principal)
    soft_delete_entry(db, entry)
    db.commit()
