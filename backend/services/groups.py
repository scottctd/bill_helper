# CALLING SPEC:
# - Purpose: implement group CRUD, membership mutations, and read-model summaries.
# - Inputs: commands, principal scope, and optional `GroupMembershipContext` snapshots.
# - Outputs: group service functions, load options, and list/summary read builders.
# - Side effects: database persistence and validation.
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.contracts_groups import GroupCreateCommand, GroupMemberCreateCommand, GroupPatch
from backend.enums_finance import GroupMemberOverride, GroupSource
from backend.models_finance import Entry, Group, GroupMember
from backend.schemas_group_rules import GroupRule
from backend.schemas_finance import GroupMemberRead, GroupRead, GroupSummaryRead
from backend.services.crud_policy import PolicyViolation
from backend.services.group_membership import (
    GroupMembershipContext,
    sorted_group_members,
)
from backend.services.group_rules import summarize_group_rule
from backend.services.tags import normalize_tag_color


def group_load_options():
    return (
        selectinload(Group.members).selectinload(GroupMember.entry).selectinload(Entry.tags),
    )


def load_group(db: Session, group_id: str) -> Group | None:
    return db.scalar(
        select(Group)
        .execution_options(populate_existing=True)
        .options(*group_load_options())
        .where(Group.id == group_id)
    )


def list_groups_for_principal(db: Session, *, principal: RequestPrincipal) -> list[Group]:
    from backend.services.access_scope import group_owner_filter

    return list(
        db.scalars(
            select(Group)
            .where(group_owner_filter(principal))
            .options(*group_load_options())
            .order_by(Group.position.asc(), Group.created_at.asc())
        )
    )


def list_group_summaries_for_principal(
    db: Session,
    *,
    principal: RequestPrincipal,
) -> list[GroupSummaryRead]:
    groups = list_groups_for_principal(db, principal=principal)
    contexts_by_owner: dict[str, GroupMembershipContext] = {}
    summaries: list[GroupSummaryRead] = []
    for group in groups:
        owner_id = group.owner_user_id
        if owner_id not in contexts_by_owner:
            contexts_by_owner[owner_id] = GroupMembershipContext.load_for_owner(
                db,
                owner_user_id=owner_id,
            )
        summaries.append(
            build_group_summary(
                db,
                group,
                membership=contexts_by_owner[owner_id],
            )
        )
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


def normalize_group_name(name: str) -> str:
    normalized = " ".join(name.split()).strip()
    if not normalized:
        raise PolicyViolation.bad_request("Group name cannot be empty")
    return normalized


def create_group(
    db: Session,
    *,
    command: GroupCreateCommand,
    owner_user_id: str,
) -> Group:
    normalized_name = normalize_group_name(command.name)
    next_position = int(
        db.scalar(
            select(func.coalesce(func.max(Group.position), -1)).where(
                Group.owner_user_id == owner_user_id
            )
        )
        or -1
    ) + 1
    group = Group(
        owner_user_id=owner_user_id,
        name=normalized_name,
        description=_normalize_optional_text(command.description),
        color=normalize_tag_color(command.color),
        source=command.source,
        definition_json=command.rule.model_dump(mode="json") if command.rule is not None else None,
        position=next_position,
    )
    db.add(group)
    db.flush()
    loaded = load_group(db, group.id)
    if loaded is None:  # pragma: no cover
        raise RuntimeError("Failed to load created group.")
    return loaded


def update_group(
    db: Session,
    *,
    group: Group,
    patch: GroupPatch,
) -> Group:
    if group.source == GroupSource.MANUAL and "rule" in patch.model_fields_set:
        raise PolicyViolation.bad_request("Manual groups cannot update their rule.")
    if "name" in patch.model_fields_set and patch.name is not None:
        group.name = normalize_group_name(patch.name)
    if "description" in patch.model_fields_set:
        group.description = _normalize_optional_text(patch.description)
    if "color" in patch.model_fields_set:
        group.color = normalize_tag_color(patch.color)
    if "rule" in patch.model_fields_set and patch.rule is not None:
        if group.source != GroupSource.RULE:
            raise PolicyViolation.bad_request("Only rule groups accept rule updates.")
        group.definition_json = patch.rule.model_dump(mode="json")
    db.add(group)
    db.flush()
    loaded = load_group(db, group.id)
    if loaded is None:  # pragma: no cover
        raise RuntimeError("Failed to load updated group.")
    return loaded


def delete_group(db: Session, *, group: Group) -> None:
    db.delete(group)
    db.flush()


def add_group_member(
    db: Session,
    *,
    group: Group,
    command: GroupMemberCreateCommand,
) -> GroupMember:
    entry = db.get(Entry, command.entry_id)
    if entry is None or entry.is_deleted:
        raise PolicyViolation.not_found("Entry not found.")
    if entry.owner_user_id != group.owner_user_id:
        raise PolicyViolation.bad_request("Entry and group must belong to the same owner.")

    if group.source == GroupSource.MANUAL:
        if command.override is not None:
            raise PolicyViolation.bad_request("Manual groups do not accept override values.")
    elif command.override is None:
        raise PolicyViolation.bad_request("Rule group membership changes require an override.")

    existing = db.scalar(
        select(GroupMember).where(
            GroupMember.group_id == group.id,
            GroupMember.entry_id == entry.id,
        )
    )
    if existing is not None:
        raise PolicyViolation.conflict("Entry is already a member of this group.")

    member = GroupMember(
        group_id=group.id,
        entry_id=entry.id,
        override=command.override,
        position=_next_member_position(group),
    )
    db.add(member)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise PolicyViolation.conflict("Group membership already exists.") from exc
    loaded = db.get(GroupMember, member.id)
    if loaded is None:  # pragma: no cover
        raise RuntimeError("Failed to load created membership.")
    return loaded


def remove_group_member(
    db: Session,
    *,
    group: Group,
    membership_id: str,
) -> None:
    membership = db.scalar(
        select(GroupMember).where(
            GroupMember.id == membership_id,
            GroupMember.group_id == group.id,
        )
    )
    if membership is None:
        raise PolicyViolation.not_found("Group membership not found.")
    if group.source == GroupSource.RULE and membership.override is None:
        raise PolicyViolation.bad_request("Rule groups only allow removing override memberships.")
    db.delete(membership)
    db.flush()


def set_entry_manual_group_ids(
    db: Session,
    *,
    entry: Entry,
    group_ids: list[str],
    principal: RequestPrincipal,
) -> None:
    desired = set(group_ids)
    current_memberships = list(
        db.scalars(
            select(GroupMember)
            .join(Group, Group.id == GroupMember.group_id)
            .where(
                GroupMember.entry_id == entry.id,
                Group.source == GroupSource.MANUAL,
                GroupMember.override.is_(None),
            )
        )
    )
    current_by_group = {member.group_id: member for member in current_memberships}

    for group_id, member in current_by_group.items():
        if group_id not in desired:
            db.delete(member)

    if current_by_group:
        db.flush()
        db.expire(entry, ["group_members"])

    for group_id in desired:
        if group_id in current_by_group:
            continue
        group = load_group(db, group_id)
        if group is None or group.owner_user_id != principal.user_id:
            raise PolicyViolation.not_found("Group not found.")
        if group.source != GroupSource.MANUAL:
            raise PolicyViolation.bad_request("Only manual groups can be assigned directly to entries.")
        add_group_member(
            db,
            group=group,
            command=GroupMemberCreateCommand(entry_id=entry.id),
        )
    db.flush()


def build_group_summary(
    db: Session,
    group: Group,
    *,
    membership: GroupMembershipContext | None = None,
) -> GroupSummaryRead:
    ctx = membership or GroupMembershipContext.load_for_owner(db, owner_user_id=group.owner_user_id)
    effective_ids = ctx.effective_entry_ids_for_group(group)
    effective_entries = [entry for entry in ctx.entries_list if entry.id in effective_ids]
    first_occurred_at = min((entry.occurred_at for entry in effective_entries), default=None)
    last_occurred_at = max((entry.occurred_at for entry in effective_entries), default=None)
    return GroupSummaryRead(
        id=group.id,
        name=group.name,
        description=group.description,
        color=group.color,
        source=group.source,
        rule_summary=_rule_summary(group),
        member_count=len(effective_ids),
        first_occurred_at=first_occurred_at,
        last_occurred_at=last_occurred_at,
        position=group.position,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


def build_group_read(
    db: Session,
    group: Group,
    *,
    membership: GroupMembershipContext | None = None,
) -> GroupRead:
    ctx = membership or GroupMembershipContext.load_for_owner(db, owner_user_id=group.owner_user_id)
    summary = build_group_summary(db, group, membership=ctx)
    members = _build_member_reads(group, membership=ctx)
    return GroupRead(
        **summary.model_dump(),
        members=members,
        rule=_group_rule(group),
    )


def list_account_entity_ids_for_owner(db: Session, *, owner_user_id: str) -> set[str]:
    from backend.models_finance import Account

    return {
        entity_id
        for entity_id in db.scalars(
            select(Account.id).where(Account.owner_user_id == owner_user_id)
        ).all()
        if entity_id
    }


def list_account_entity_ids_for_principal(db: Session, *, principal: RequestPrincipal) -> set[str]:
    from backend.models_finance import Account
    from backend.services.access_scope import account_owner_filter

    return {
        entity_id
        for entity_id in db.scalars(select(Account.id).where(account_owner_filter(principal))).all()
        if entity_id
    }


def _build_member_reads(
    group: Group,
    *,
    membership: GroupMembershipContext,
) -> list[GroupMemberRead]:
    effective_ids = membership.effective_entry_ids_for_group(group)
    reads: list[GroupMemberRead] = []
    for member in sorted_group_members(group):
        if member.entry_id not in effective_ids:
            continue
        entry = member.entry
        if entry is None:
            continue
        reads.append(
            GroupMemberRead(
                id=member.id,
                entry_id=member.entry_id,
                override=member.override,
                entry_name=entry.name,
                occurred_at=entry.occurred_at,
                kind=entry.kind,
                amount_minor=entry.amount_minor,
                currency_code=entry.currency_code,
            )
        )
    return reads


def get_group_read_for_principal(
    db: Session,
    *,
    group_id: str,
    principal: RequestPrincipal,
) -> GroupRead:
    from backend.services.access_scope import get_group_for_principal_or_404

    group = get_group_for_principal_or_404(
        db,
        group_id=group_id,
        principal=principal,
        stmt=select(Group).options(*group_load_options()),
    )
    membership = GroupMembershipContext.load_for_owner(db, owner_user_id=group.owner_user_id)
    return build_group_read(db, group, membership=membership)


def _next_member_position(group: Group) -> int:
    if not group.members:
        return 0
    return max(member.position for member in group.members) + 1


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split()).strip()
    return normalized or None


def _group_rule(group: Group) -> GroupRule | None:
    if group.definition_json is None:
        return None
    return GroupRule.model_validate(group.definition_json)


def _rule_summary(group: Group) -> str | None:
    rule = _group_rule(group)
    if rule is None:
        return None
    return summarize_group_rule(rule)
