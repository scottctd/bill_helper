# CALLING SPEC:
# - Purpose: Apply approved agent change payloads for the `groups` domain.
# - Inputs: Callers import `backend/services/agent/apply/groups` and invoke `apply_create_group`, `apply_update_group`, `apply_delete_group`, `apply_create_group_member`.
# - Outputs: Exports `apply_create_group`, `apply_update_group`, `apply_delete_group`, `apply_create_group_member`.
# - Side effects: May read or write SQLAlchemy sessions and commit domain mutations.
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.contracts_groups import GroupCreateCommand, GroupMemberCreateCommand, GroupPatch
from backend.services.agent.apply.common import (
    AppliedResource,
    find_scoped_group_by_id,
    find_unique_entry_by_id,
    resolve_applied_group_id,
    resolve_applied_group_member_entry_id,
)
from backend.services.agent.change_contracts.groups import (
    CreateGroupMemberPayload,
    CreateGroupPayload,
    DeleteGroupMemberPayload,
    DeleteGroupPayload,
    UpdateGroupPayload,
)
from backend.services.groups import (
    add_group_member,
    create_group,
    delete_group,
    remove_group_member,
    update_group,
)


def apply_create_group(
    db: Session,
    payload: CreateGroupPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    group = create_group(
        db,
        command=GroupCreateCommand(
            name=payload.name,
            source=payload.source,
            description=payload.description,
            color=payload.color,
            rule=payload.rule,
        ),
        owner_user_id=principal.user_id,
    )
    db.flush()
    return AppliedResource(resource_type="group", resource_id=group.id)


def apply_update_group(
    db: Session,
    payload: UpdateGroupPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    group = find_scoped_group_by_id(db, group_id=payload.group_id, principal=principal)
    updated = update_group(
        db,
        group=group,
        patch=GroupPatch.model_validate(payload.patch.model_dump(exclude_unset=True)),
    )
    db.flush()
    return AppliedResource(resource_type="group", resource_id=updated.id)


def apply_delete_group(
    db: Session,
    payload: DeleteGroupPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    group = find_scoped_group_by_id(db, group_id=payload.group_id, principal=principal)
    resource_id = group.id
    delete_group(db, group=group)
    db.flush()
    return AppliedResource(resource_type="group", resource_id=resource_id)


def apply_create_group_member(
    db: Session,
    payload: CreateGroupMemberPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    group_id = resolve_applied_group_id(db, payload.group_ref, principal=principal)
    group = find_scoped_group_by_id(db, group_id=group_id, principal=principal)

    target_entry_id = resolve_applied_group_member_entry_id(
        db,
        target=payload.target,
        principal=principal,
    )
    entry = find_unique_entry_by_id(db, target_entry_id, principal=principal)
    command = GroupMemberCreateCommand(
        entry_id=entry.id,
        override=payload.target.override,
    )

    membership = add_group_member(db, group=group, command=command)
    db.flush()
    return AppliedResource(resource_type="group_membership", resource_id=membership.id)


def apply_delete_group_member(
    db: Session,
    payload: DeleteGroupMemberPayload,
    principal: RequestPrincipal,
) -> AppliedResource:
    group = find_scoped_group_by_id(db, group_id=payload.group_ref.group_id or "", principal=principal)

    target_entry_id = resolve_applied_group_member_entry_id(
        db,
        target=payload.target,
        principal=principal,
    )
    membership = next(
        (item for item in group.members if item.entry_id == target_entry_id),
        None,
    )
    if membership is None:
        raise ValueError("Group membership not found")
    membership_id = membership.id
    remove_group_member(db, group=group, membership_id=membership_id)
    db.flush()
    return AppliedResource(resource_type="group_membership", resource_id=membership_id)
