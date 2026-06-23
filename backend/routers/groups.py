# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `groups` routes.
# - Inputs: callers that import `backend/routers/groups.py` and pass module-defined arguments or framework events.
# - Outputs: router callables and request/response adapters for `groups`.
# - Side effects: FastAPI routing and HTTP error translation.
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.contracts_groups import GroupCreateCommand, GroupMemberCreateCommand, GroupPatch
from backend.database import get_db
from backend.models_finance import Group
from backend.schemas_finance import GroupCreate, GroupMemberCreate, GroupRead, GroupSummaryRead, GroupUpdate
from backend.services.access_scope import get_group_for_principal_or_404, group_owner_filter
from backend.services.crud_policy import PolicyViolation
from backend.services.groups import (
    add_group_member as add_group_member_service,
    build_group_read,
    build_group_summary,
    create_group as create_group_service,
    delete_group as delete_group_service,
    group_load_options,
    list_account_entity_ids_for_principal,
    load_group,
    remove_group_member as remove_group_member_service,
    update_group as update_group_service,
)

router = APIRouter(prefix="/groups", tags=["groups"])


def _get_group_or_404(
    db: Session,
    *,
    group_id: str,
    principal: RequestPrincipal,
) -> Group:
    return get_group_for_principal_or_404(
        db,
        group_id=group_id,
        principal=principal,
        stmt=select(Group).options(*group_load_options()),
    )


@router.post("", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    group = create_group_service(
        db,
        command=GroupCreateCommand.model_validate(payload.model_dump()),
        owner_user_id=principal.user_id,
    )
    db.commit()
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    return build_group_read(db, group, account_entity_ids=account_entity_ids)


@router.get("", response_model=list[GroupSummaryRead])
def list_group_summaries(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[GroupSummaryRead]:
    groups = list(
        db.scalars(
            select(Group)
            .where(group_owner_filter(principal))
            .options(*group_load_options())
            .order_by(Group.position.asc(), Group.created_at.asc())
        )
    )
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    summaries = [
        build_group_summary(db, group, account_entity_ids=account_entity_ids) for group in groups
    ]
    return sorted(
        summaries,
        key=lambda summary: (
            summary.last_occurred_at is None,
            summary.last_occurred_at or summary.name,
            summary.name.lower(),
            summary.id,
        ),
        reverse=True,
    )


@router.get("/{group_id}", response_model=GroupRead)
def get_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    group = _get_group_or_404(db, group_id=group_id, principal=principal)
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    return build_group_read(db, group, account_entity_ids=account_entity_ids)


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(
    group_id: str,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    group = _get_group_or_404(db, group_id=group_id, principal=principal)
    updated_group = update_group_service(
        db,
        group=group,
        patch=GroupPatch.model_validate(payload.model_dump(exclude_unset=True)),
    )
    db.commit()
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    return build_group_read(db, updated_group, account_entity_ids=account_entity_ids)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    group = _get_group_or_404(db, group_id=group_id, principal=principal)
    delete_group_service(db, group=group)
    db.commit()


@router.post("/{group_id}/members", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
def add_group_member(
    group_id: str,
    payload: GroupMemberCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    group = _get_group_or_404(db, group_id=group_id, principal=principal)
    command = GroupMemberCreateCommand.model_validate(payload.model_dump())
    try:
        add_group_member_service(db, group=group, command=command)
    except IntegrityError as exc:
        db.rollback()
        raise PolicyViolation.conflict("Group membership already exists.") from exc
    db.commit()
    updated_group = load_group(db, group_id)
    if updated_group is None:  # pragma: no cover
        raise RuntimeError("Failed to load group after membership commit.")
    account_entity_ids = list_account_entity_ids_for_principal(db, principal=principal)
    return build_group_read(db, updated_group, account_entity_ids=account_entity_ids)


@router.delete("/{group_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_member(
    group_id: str,
    membership_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    group = _get_group_or_404(db, group_id=group_id, principal=principal)
    remove_group_member_service(db, group=group, membership_id=membership_id)
    db.commit()
