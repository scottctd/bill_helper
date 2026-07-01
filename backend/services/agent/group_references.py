# CALLING SPEC:
# - Purpose: Agent subsystem helpers for `group_references`.
# - Inputs: Callers import `backend/services/agent/group_references` and invoke `GroupSummaryPublicRecord`, `GroupMemberPublicRecord`, `GroupDetailPublicRecord`, `GroupIdAmbiguityDetails`.
# - Outputs: Exports `GroupSummaryPublicRecord`, `GroupMemberPublicRecord`, `GroupDetailPublicRecord`, `GroupIdAmbiguityDetails`.
# - Side effects: May read or write SQLAlchemy sessions and commit domain mutations.
from __future__ import annotations

from datetime import date
from typing import NotRequired, TypedDict

from sqlalchemy import false, func, select
from sqlalchemy.orm import Session

from backend.models_finance import Group
from backend.schemas_finance import GroupMemberRead, GroupSummaryRead
from backend.services.agent.entry_references import entry_public_id
from backend.services.groups import build_group_read, build_group_summary, group_load_options

GROUP_PUBLIC_ID_LENGTH = 8


class GroupSummaryPublicRecord(TypedDict):
    group_id: str
    name: str
    source: str
    description: NotRequired[str | None]
    color: NotRequired[str | None]
    rule_summary: NotRequired[str | None]
    member_count: int
    first_occurred_at: str | None
    last_occurred_at: str | None


class GroupMemberPublicRecord(TypedDict):
    membership_id: str
    entry_id: str
    name: str
    occurred_at: str
    kind: str
    amount_minor: int
    override: NotRequired[str]


class GroupDetailPublicRecord(GroupSummaryPublicRecord):
    members: list[GroupMemberPublicRecord]


class GroupIdAmbiguityDetails(TypedDict):
    group_id: str
    candidate_count: int
    candidate_group_ids: list[str]
    candidates: list[GroupSummaryPublicRecord]


def group_public_id(group_id: str, *, full: bool = False) -> str:
    normalized = str(group_id)
    return normalized if full else normalized[:GROUP_PUBLIC_ID_LENGTH]


def group_owner_condition(user_id: str | None):
    if user_id is None:
        return false()
    return Group.owner_user_id == user_id


def _json_public_value(value: object) -> object:
    if isinstance(value, date):
        return value.isoformat()
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, (str, int, float, bool)) or enum_value is None:
        return enum_value if hasattr(value, "value") else value
    return value


def group_summary_to_public_record(summary: GroupSummaryRead, *, full_id: bool = False) -> GroupSummaryPublicRecord:
    return {
        "group_id": group_public_id(summary.id, full=full_id),
        "name": summary.name,
        "source": str(_json_public_value(summary.source)),
        "description": summary.description,
        "color": summary.color,
        "rule_summary": summary.rule_summary,
        "member_count": summary.member_count,
        "first_occurred_at": summary.first_occurred_at.isoformat() if summary.first_occurred_at is not None else None,
        "last_occurred_at": summary.last_occurred_at.isoformat() if summary.last_occurred_at is not None else None,
    }


def _member_to_public_record(member: GroupMemberRead, *, full_id: bool = False) -> GroupMemberPublicRecord:
    record: GroupMemberPublicRecord = {
        "membership_id": member.id if full_id else member.id[:GROUP_PUBLIC_ID_LENGTH],
        "entry_id": entry_public_id(member.entry_id) if not full_id else member.entry_id,
        "name": member.entry_name,
        "occurred_at": member.occurred_at.isoformat(),
        "kind": str(_json_public_value(member.kind)),
        "amount_minor": member.amount_minor,
    }
    if member.override is not None:
        record["override"] = str(_json_public_value(member.override))
    return record


def group_detail_public_record(db: Session, group: Group, *, full_id: bool = False) -> GroupDetailPublicRecord:
    group_read = build_group_read(db, group)
    return {
        **group_summary_to_public_record(group_read, full_id=full_id),
        "members": [_member_to_public_record(member, full_id=full_id) for member in group_read.members],
    }


def find_groups_by_id(db: Session, *, group_id: str, owner_user_id: str) -> list[Group]:
    normalized = group_id.strip().lower()
    if not normalized:
        return []

    exact_matches = list(
        db.scalars(
            select(Group)
            .where(
                group_owner_condition(owner_user_id),
                func.lower(Group.id) == normalized,
            )
            .options(*group_load_options())
            .order_by(Group.created_at.asc())
        )
    )
    if exact_matches:
        return exact_matches

    return list(
        db.scalars(
            select(Group)
            .where(
                group_owner_condition(owner_user_id),
                func.lower(Group.id).like(f"{normalized}%"),
            )
            .options(*group_load_options())
            .order_by(Group.created_at.asc())
        )
    )


def group_id_ambiguity_details(db: Session, groups: list[Group], *, group_id: str) -> GroupIdAmbiguityDetails:
    return {
        "group_id": group_id,
        "candidate_count": len(groups),
        "candidate_group_ids": [group.id for group in groups],
        "candidates": [
            group_summary_to_public_record(build_group_summary(db, group), full_id=True)
            for group in groups
        ],
    }


def group_public_summary(db: Session, group: Group) -> str:
    summary = build_group_summary(db, group)
    return (
        f"{group_public_id(group.id)} {summary.name} {summary.source.value} "
        f"members={summary.member_count}"
    )
