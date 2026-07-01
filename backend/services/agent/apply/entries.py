# CALLING SPEC:
# - Purpose: apply approved entry proposals by converting payloads to service commands.
# - Inputs: validated `CreateEntryPayload`, `UpdateEntryPayload`, or `DeleteEntryPayload`;
#   `Session`; approving `RequestPrincipal`.
# - Outputs: `AppliedResource` with the affected entry id.
# - Side effects: delegates to `create_entry_from_command`, `update_entry_from_command`, or
#   `soft_delete_entry` in `backend/services/entries.py`.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
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
    create_entry_from_command,
    soft_delete_entry,
    update_entry_from_command,
)
from backend.services.runtime_settings import resolve_runtime_settings


def apply_create_entry(
    db: Session,
    payload: CreateEntryPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    settings = resolve_runtime_settings(db)
    entry = create_entry_from_command(
        db,
        command=payload.to_create_command(default_currency_code=settings.default_currency_code),
        principal=principal,
    )
    return AppliedResource(resource_type="entry", resource_id=entry.id)


def apply_update_entry(
    db: Session,
    payload: UpdateEntryPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    find_unique_entry_by_id(db, payload.entry_id, principal=principal)
    entry = update_entry_from_command(
        db,
        entry_id=payload.entry_id,
        command=payload.to_update_command(),
        principal=principal,
    )
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
