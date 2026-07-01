# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `entries` routes.
# - Inputs: FastAPI dependencies (`Session`, `RequestPrincipal`) and validated HTTP schemas.
# - Outputs: `EntryRead` / `EntryDetailRead` responses mapped from service-layer reads.
# - Side effects: HTTP routing; commits on mutating routes only.
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.enums_finance import EntryKind
from backend.schemas_finance import (
    EntryCreate,
    EntryDetailRead,
    EntryListResponse,
    EntryRead,
    EntryTagSuggestionRequest,
    EntryTagSuggestionResponse,
    EntryUpdate,
)
from backend.services.entries import (
    create_entry_from_command,
    entry_create_command_from_http,
    entry_update_command_from_http,
    soft_delete_entry,
    update_entry_from_command,
)
from backend.services.entries_read import (
    EntryListFilters,
    build_entry_read,
    get_entry_detail_for_principal,
    list_entries_for_principal,
    load_entry_for_read,
)
from backend.services.entry_tag_suggestions import suggest_entry_tags
from backend.services.group_membership import GroupMembershipContext

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


@router.post("", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: EntryCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryRead:
    entry = create_entry_from_command(
        db,
        command=entry_create_command_from_http(payload),
        principal=principal,
    )

    db.commit()
    entry = load_entry_for_read(db, entry_id=entry.id, principal=principal)
    membership = GroupMembershipContext.load_for_principal(db, principal=principal)
    return build_entry_read(entry, membership=membership)


@router.get("", response_model=EntryListResponse)
def list_entries(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
    filters: EntryListQueryParams = Depends(),
    from_entity: list[str] | None = Query(default=None),
    to_entity: list[str] | None = Query(default=None),
) -> EntryListResponse:
    return list_entries_for_principal(
        db,
        principal=principal,
        filters=EntryListFilters(
            start_date=filters.start_date,
            end_date=filters.end_date,
            kind=filters.kind,
            tag=filters.tag,
            currency=filters.currency,
            source=filters.source,
            account_id=filters.account_id,
            category=filters.category,
            group_id=filters.group_id,
            from_entity=tuple(from_entity or ()),
            to_entity=tuple(to_entity or ()),
            limit=filters.limit,
            offset=filters.offset,
        ),
    )


@router.post("/tag-suggestion", response_model=EntryTagSuggestionResponse)
def suggest_tags_for_entry(
    payload: EntryTagSuggestionRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryTagSuggestionResponse:
    return suggest_entry_tags(
        db,
        principal=principal,
        draft=payload,
    )


@router.get("/{entry_id}", response_model=EntryDetailRead)
def get_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> EntryDetailRead:
    return get_entry_detail_for_principal(db, entry_id=entry_id, principal=principal)


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
        command=entry_update_command_from_http(payload),
        principal=principal,
    )

    db.commit()
    entry = load_entry_for_read(db, entry_id=entry.id, principal=principal)
    membership = GroupMembershipContext.load_for_principal(db, principal=principal)
    return build_entry_read(entry, membership=membership)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    entry = load_entry_for_read(db, entry_id=entry_id, principal=principal)
    soft_delete_entry(db, entry)
    db.commit()
