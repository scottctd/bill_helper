# CALLING SPEC:
# - Purpose: implement focused service logic for `entries`.
# - Inputs: callers that import `backend/services/agent/apply/entries.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `entries`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.models_finance import Entry
from backend.services.agent.apply.common import (
    AppliedResource,
    find_unique_entry_by_id,
)
from backend.services.agent.change_contracts.entries import (
    CreateEntryPayload,
    DeleteEntryPayload,
    UpdateEntryPayload,
)
from backend.services.entries import (
    _validate_category_and_tags,
    normalize_entry_category_reference,
    set_entry_tags,
    soft_delete_entry,
)
from backend.services.entities import ensure_entity_by_name
from backend.services.runtime_settings import resolve_runtime_settings
from backend.services.taxonomy import assign_single_term_by_name
from backend.services.taxonomy_constants import ENTRY_CATEGORY_SUBJECT_TYPE, ENTRY_CATEGORY_TAXONOMY_KEY


def apply_create_entry(
    db: Session,
    payload: CreateEntryPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    settings = resolve_runtime_settings(db)
    currency_code = (payload.currency_code or settings.default_currency_code).strip().upper()

    from_entity = ensure_entity_by_name(db, payload.from_entity, owner_user_id=principal.user_id)
    to_entity = ensure_entity_by_name(db, payload.to_entity, owner_user_id=principal.user_id)

    entry = Entry(
        kind=payload.kind,
        occurred_at=payload.date,
        name=payload.name,
        amount_minor=payload.amount_minor,
        currency_code=currency_code,
        from_entity_id=from_entity.id,
        to_entity_id=to_entity.id,
        owner_user_id=principal.user_id,
        from_entity=from_entity.name,
        to_entity=to_entity.name,
        owner=principal.user_name,
        markdown_body=payload.markdown_notes,
        lifecycle=payload.lifecycle,
    )
    db.add(entry)
    db.flush()
    resolved_category = (
        normalize_entry_category_reference(payload.category) if payload.category is not None else None
    )
    _validate_category_and_tags(
        db,
        category=resolved_category,
        tags=payload.tags,
        owner_user_id=principal.user_id,
    )
    set_entry_tags(db, entry, payload.tags)
    if resolved_category is not None:
        assign_single_term_by_name(
            db,
            taxonomy_key=ENTRY_CATEGORY_TAXONOMY_KEY,
            subject_type=ENTRY_CATEGORY_SUBJECT_TYPE,
            subject_id=entry.id,
            term_name=resolved_category,
            owner_user_id=principal.user_id,
        )
    db.flush()
    return AppliedResource(resource_type="entry", resource_id=entry.id)


def apply_update_entry(
    db: Session,
    payload: UpdateEntryPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    entry = find_unique_entry_by_id(db, payload.entry_id, principal=principal)

    if "kind" in payload.patch.model_fields_set and payload.patch.kind is not None:
        entry.kind = payload.patch.kind
    if "date" in payload.patch.model_fields_set and payload.patch.date is not None:
        entry.occurred_at = payload.patch.date
    if "name" in payload.patch.model_fields_set and payload.patch.name is not None:
        entry.name = payload.patch.name
    if "amount_minor" in payload.patch.model_fields_set and payload.patch.amount_minor is not None:
        entry.amount_minor = payload.patch.amount_minor
    if "currency_code" in payload.patch.model_fields_set and payload.patch.currency_code is not None:
        entry.currency_code = payload.patch.currency_code

    if "from_entity" in payload.patch.model_fields_set:
        if payload.patch.from_entity is None:
            entry.from_entity_id = None
            entry.from_entity = None
        else:
            from_entity = ensure_entity_by_name(
                db,
                payload.patch.from_entity,
                owner_user_id=entry.owner_user_id,
            )
            entry.from_entity_id = from_entity.id
            entry.from_entity = from_entity.name

    if "to_entity" in payload.patch.model_fields_set:
        if payload.patch.to_entity is None:
            entry.to_entity_id = None
            entry.to_entity = None
        else:
            to_entity = ensure_entity_by_name(
                db,
                payload.patch.to_entity,
                owner_user_id=entry.owner_user_id,
            )
            entry.to_entity_id = to_entity.id
            entry.to_entity = to_entity.name

    if "markdown_notes" in payload.patch.model_fields_set:
        entry.markdown_body = payload.patch.markdown_notes

    category_value = payload.patch.category if "category" in payload.patch.model_fields_set else None
    tags_value = payload.patch.tags if "tags" in payload.patch.model_fields_set else None
    resolved_category = (
        normalize_entry_category_reference(category_value)
        if category_value is not None
        else None
    )
    if resolved_category is not None or tags_value is not None:
        _validate_category_and_tags(
            db,
            category=resolved_category,
            tags=tags_value,
            owner_user_id=entry.owner_user_id,
        )

    if "tags" in payload.patch.model_fields_set:
        set_entry_tags(db, entry, payload.patch.tags or [])

    if "lifecycle" in payload.patch.model_fields_set:
        entry.lifecycle = payload.patch.lifecycle

    if "category" in payload.patch.model_fields_set:
        if payload.patch.category is None:
            assign_single_term_by_name(
                db,
                taxonomy_key=ENTRY_CATEGORY_TAXONOMY_KEY,
                subject_type=ENTRY_CATEGORY_SUBJECT_TYPE,
                subject_id=entry.id,
                term_name=None,
                owner_user_id=entry.owner_user_id,
            )
        else:
            assign_single_term_by_name(
                db,
                taxonomy_key=ENTRY_CATEGORY_TAXONOMY_KEY,
                subject_type=ENTRY_CATEGORY_SUBJECT_TYPE,
                subject_id=entry.id,
                term_name=normalize_entry_category_reference(payload.patch.category),
                owner_user_id=entry.owner_user_id,
            )

    db.add(entry)
    db.flush()
    return AppliedResource(resource_type="entry", resource_id=entry.id)


def apply_delete_entry(
    db: Session,
    payload: DeleteEntryPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    entry = find_unique_entry_by_id(db, payload.entry_id, principal=principal)
    soft_delete_entry(db, entry)
    db.flush()
    return AppliedResource(resource_type="entry", resource_id=entry.id)
