# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `groups` routes.
# - Inputs: FastAPI dependencies and validated group HTTP schemas.
# - Outputs: group read responses mapped from service read builders.
# - Side effects: HTTP routing; commits on mutating routes only.
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.contracts_groups import GroupCreateCommand, GroupMemberCreateCommand, GroupPatch
from backend.database import get_db
from backend.schemas_finance import GroupCreate, GroupMemberCreate, GroupRead, GroupSummaryRead, GroupUpdate
from backend.services.group_membership import GroupMembershipContext
from backend.services.groups import (
    add_group_member as add_group_member_service,
    build_group_read,
    create_group as create_group_service,
    delete_group as delete_group_service,
    get_group_read_for_principal,
    list_group_summaries_for_principal,
    load_group,
    remove_group_member as remove_group_member_service,
    update_group as update_group_service,
)

router = APIRouter(prefix="/groups", tags=["groups"])


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
    membership = GroupMembershipContext.load_for_owner(db, owner_user_id=group.owner_user_id)
    return build_group_read(db, group, membership=membership)


@router.get("", response_model=list[GroupSummaryRead])
def list_group_summaries(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[GroupSummaryRead]:
    return list_group_summaries_for_principal(db, principal=principal)


@router.get("/{group_id}", response_model=GroupRead)
def get_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    return get_group_read_for_principal(db, group_id=group_id, principal=principal)


@router.patch("/{group_id}", response_model=GroupRead)
def update_group(
    group_id: str,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    from backend.services.access_scope import get_group_for_principal_or_404

    group = get_group_for_principal_or_404(db, group_id=group_id, principal=principal)
    updated_group = update_group_service(
        db,
        group=group,
        patch=GroupPatch.model_validate(payload.model_dump(exclude_unset=True)),
    )
    db.commit()
    membership = GroupMembershipContext.load_for_owner(db, owner_user_id=updated_group.owner_user_id)
    return build_group_read(db, updated_group, membership=membership)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    from backend.services.access_scope import get_group_for_principal_or_404

    group = get_group_for_principal_or_404(db, group_id=group_id, principal=principal)
    delete_group_service(db, group=group)
    db.commit()


@router.post("/{group_id}/members", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
def add_group_member(
    group_id: str,
    payload: GroupMemberCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> GroupRead:
    from backend.services.access_scope import get_group_for_principal_or_404

    group = get_group_for_principal_or_404(db, group_id=group_id, principal=principal)
    command = GroupMemberCreateCommand.model_validate(payload.model_dump())
    add_group_member_service(db, group=group, command=command)
    db.commit()
    updated_group = load_group(db, group_id)
    if updated_group is None:  # pragma: no cover
        raise RuntimeError("Failed to load group after membership commit.")
    membership = GroupMembershipContext.load_for_owner(db, owner_user_id=updated_group.owner_user_id)
    return build_group_read(db, updated_group, membership=membership)


@router.delete("/{group_id}/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group_member(
    group_id: str,
    membership_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> None:
    from backend.services.access_scope import get_group_for_principal_or_404

    group = get_group_for_principal_or_404(db, group_id=group_id, principal=principal)
    remove_group_member_service(db, group=group, membership_id=membership_id)
    db.commit()
