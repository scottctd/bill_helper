# CALLING SPEC:
# - Purpose: Build and validate agent proposal payloads for `validation`.
# - Inputs: Callers import `backend/services/agent/proposals/group_memberships/validation` and invoke `validate_group_member_add_rules`, `validate_group_member_remove_rules`.
# - Outputs: Exports `validate_group_member_add_rules`, `validate_group_member_remove_rules`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from typing import Any

from backend.enums_finance import GroupSource
from backend.services.agent.change_contracts.groups import (
    GroupMemberTargetPayload,
    GroupReferencePayload,
)
from backend.services.agent.proposals.group_memberships.common import (
    canonical_group_member_target_payload,
    resolved_group_member_target_preview,
)
from backend.services.agent.proposals.groups import (
    group_preview_from_existing,
    match_existing_group_or_error,
    resolved_group_source_from_ref,
)
from backend.services.agent.tool_results import error_result
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult


def validate_group_member_add_rules(
    context: ToolContext,
    *,
    group_ref: GroupReferencePayload,
    target: GroupMemberTargetPayload,
) -> tuple[dict[str, Any], dict[str, Any]] | ToolExecutionResult:
    group_resolution = resolved_group_source_from_ref(context, group_ref)
    if isinstance(group_resolution, ToolExecutionResult):
        return group_resolution
    parent_group_source, group_preview, existing_group, _group_proposal = group_resolution

    member_resolution = resolved_group_member_target_preview(context, target=target)
    if isinstance(member_resolution, ToolExecutionResult):
        return member_resolution
    member_preview, target_entry_id = member_resolution

    if parent_group_source == GroupSource.MANUAL:
        if target.override is not None:
            return error_result("manual groups do not accept override values")
    elif target.override is None:
        return error_result("rule group membership changes require an override")

    if existing_group is not None and target_entry_id is not None:
        if any(member.entry_id == target_entry_id for member in existing_group.members):
            return error_result("entry is already a member of this group")

    return group_preview, member_preview


def validate_group_member_remove_rules(
    context: ToolContext,
    *,
    group_ref: GroupReferencePayload,
    target: GroupMemberTargetPayload,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]] | ToolExecutionResult:
    group = match_existing_group_or_error(context, group_id=group_ref.group_id or "")
    if isinstance(group, ToolExecutionResult):
        return group

    member_resolution = resolved_group_member_target_preview(context, target=target)
    if isinstance(member_resolution, ToolExecutionResult):
        return member_resolution
    member_preview, target_entry_id = member_resolution

    canonical_group_ref: dict[str, Any] = {"group_id": group.id}
    entry = canonical_group_member_target_payload(context, target=target)
    if isinstance(entry, ToolExecutionResult):
        return entry
    canonical_target = entry[0]
    resolved_entry_id = canonical_target["entry_ref"].get("entry_id")

    membership_exists = any(
        membership.entry_id == resolved_entry_id for membership in group.members
    )
    if not membership_exists:
        return error_result(
            "group does not currently contain that member",
            details={"group_id": group.id, "member": member_preview},
        )

    return canonical_group_ref, canonical_target, group_preview_from_existing(context, group), member_preview
