# CALLING SPEC:
# - Purpose: Build and validate agent proposal payloads for `groups`.
# - Inputs: Callers import `backend/services/agent/proposals/groups` and invoke `resolve_group_proposal_reference_or_error`, `group_preview_from_existing`, `group_preview_from_proposal`, `match_existing_group_or_error`.
# - Outputs: Exports `resolve_group_proposal_reference_or_error`, `group_preview_from_existing`, `group_preview_from_proposal`, `match_existing_group_or_error`.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

from typing import Any

from backend.enums_agent import AgentChangeStatus, AgentChangeType
from backend.enums_finance import GroupSource
from backend.models_agent import AgentChangeItem
from backend.models_finance import Group
from backend.services.agent.change_contracts.groups import (
    CreateGroupPayload as ProposeCreateGroupArgs,
    DeleteGroupPayload as ProposeDeleteGroupArgs,
    GroupReferencePayload,
    UpdateGroupPayload as ProposeUpdateGroupArgs,
)
from backend.services.agent.group_references import (
    find_groups_by_id,
    group_detail_public_record,
    group_id_ambiguity_details,
    group_public_id,
)
from backend.services.agent.proposals.common import (
    create_change_item,
    pending_proposals_for_thread,
    proposal_result,
    proposal_short_id,
    require_tool_principal,
    resolve_proposal_by_id,
)
from backend.services.agent.tool_results import error_result
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult
from backend.services.groups import build_group_summary


def resolve_group_proposal_reference_or_error(
    context: ToolContext,
    *,
    proposal_id: str,
    expected_statuses: set[AgentChangeStatus] | None = None,
) -> AgentChangeItem | ToolExecutionResult:
    item = resolve_proposal_by_id(context, proposal_id)
    if item is None:
        return error_result("proposal not found", details={"proposal_id": proposal_id})
    if item.change_type != AgentChangeType.CREATE_GROUP:
        return error_result(
            "proposal_id does not reference a create_group proposal",
            details={"proposal_id": proposal_id, "change_type": item.change_type.value},
        )
    if expected_statuses is not None and item.status not in expected_statuses:
        return error_result(
            "group proposal is not in a usable status",
            details={"proposal_id": item.id, "status": item.status.value},
        )
    return item


def _find_groups_for_reference(context: ToolContext, *, group_id: str) -> list[Group]:
    try:
        principal = require_tool_principal(context)
    except ValueError:
        return []
    return find_groups_by_id(
        context.db,
        group_id=group_id,
        owner_user_id=principal.user_id,
    )


def group_preview_from_existing(context: ToolContext, group: Group) -> dict[str, Any]:
    summary = build_group_summary(context.db, group)
    return {
        "source": "group",
        "group_id": group.id,
        "group_short_id": group_public_id(group.id),
        "name": summary.name,
        "group_source": summary.source.value,
        "member_count": summary.member_count,
    }


def group_preview_from_proposal(item: AgentChangeItem) -> dict[str, Any]:
    payload = item.payload_json
    return {
        "source": "proposal",
        "proposal_id": item.id,
        "proposal_short_id": proposal_short_id(item.id),
        "proposal_status": item.status.value,
        "name": payload.get("name"),
        "group_source": payload.get("source"),
    }


def match_existing_group_or_error(
    context: ToolContext,
    *,
    group_id: str,
) -> Group | ToolExecutionResult:
    matches = _find_groups_for_reference(context, group_id=group_id)
    if not matches:
        return error_result("no group matched group_id", details={"group_id": group_id})
    if len(matches) > 1:
        return error_result(
            "ambiguous group_id matched multiple groups; retry with one of the candidate ids",
            details=group_id_ambiguity_details(context.db, matches, group_id=group_id),
        )
    return matches[0]


def canonical_group_ref_payload(
    context: ToolContext,
    *,
    group_ref: GroupReferencePayload,
    expected_statuses: set[AgentChangeStatus] | None = None,
) -> tuple[dict[str, Any], Group | None, AgentChangeItem | None] | ToolExecutionResult:
    if group_ref.group_id is not None:
        group = match_existing_group_or_error(context, group_id=group_ref.group_id)
        if isinstance(group, ToolExecutionResult):
            return group
        return {"group_id": group.id}, group, None

    assert group_ref.create_group_proposal_id is not None
    proposal = resolve_group_proposal_reference_or_error(
        context,
        proposal_id=group_ref.create_group_proposal_id,
        expected_statuses=expected_statuses,
    )
    if isinstance(proposal, ToolExecutionResult):
        return proposal
    return {"create_group_proposal_id": proposal.id}, None, proposal


def resolved_group_source_from_ref(
    context: ToolContext,
    group_ref: GroupReferencePayload,
) -> tuple[GroupSource | None, dict[str, Any], Group | None, AgentChangeItem | None] | ToolExecutionResult:
    if group_ref.group_id is not None:
        group = match_existing_group_or_error(context, group_id=group_ref.group_id)
        if isinstance(group, ToolExecutionResult):
            return group
        return group.source, group_preview_from_existing(context, group), group, None

    assert group_ref.create_group_proposal_id is not None
    proposal = resolve_group_proposal_reference_or_error(
        context,
        proposal_id=group_ref.create_group_proposal_id,
        expected_statuses={
            AgentChangeStatus.PENDING_REVIEW,
            AgentChangeStatus.APPROVED,
            AgentChangeStatus.APPLIED,
        },
    )
    if isinstance(proposal, ToolExecutionResult):
        return proposal
    payload = proposal.payload_json
    raw_source = payload.get("source")
    group_source = GroupSource(str(raw_source)) if isinstance(raw_source, str) else None
    return group_source, group_preview_from_proposal(proposal), None, proposal


def group_ref_signature(group_ref: GroupReferencePayload) -> tuple[str, str]:
    if group_ref.group_id is not None:
        return ("group", group_ref.group_id)
    assert group_ref.create_group_proposal_id is not None
    return ("proposal", group_ref.create_group_proposal_id)


def pending_group_change_conflict(
    context: ToolContext,
    *,
    change_type: AgentChangeType,
    group_id: str,
    exclude_item_id: str | None = None,
) -> ToolExecutionResult | None:
    for item in pending_proposals_for_thread(context):
        if exclude_item_id is not None and item.id == exclude_item_id:
            continue
        if item.change_type not in {AgentChangeType.UPDATE_GROUP, AgentChangeType.DELETE_GROUP}:
            continue
        item_group_ref = item.payload_json.get("group_ref")
        item_group_id = None
        if isinstance(item_group_ref, dict):
            item_group_id = item_group_ref.get("group_id")
        elif isinstance(item.payload_json.get("group_id"), str):
            item_group_id = item.payload_json.get("group_id")
        if item_group_id != group_id:
            continue
        if item.change_type == change_type:
            return error_result(
                "a matching pending group proposal already exists in this thread",
                details={"proposal_id": item.id, "proposal_short_id": proposal_short_id(item.id)},
            )
        return error_result(
            "a conflicting pending group proposal already exists; update or remove it first",
            details={
                "proposal_id": item.id,
                "proposal_short_id": proposal_short_id(item.id),
                "change_type": item.change_type.value,
            },
        )
    return None


def pending_create_group_conflict(
    context: ToolContext,
    *,
    name: str,
    source: str,
    exclude_item_id: str | None = None,
) -> ToolExecutionResult | None:
    for item in pending_proposals_for_thread(context):
        if exclude_item_id is not None and item.id == exclude_item_id:
            continue
        if item.change_type != AgentChangeType.CREATE_GROUP:
            continue
        if item.payload_json.get("name") != name or item.payload_json.get("source") != source:
            continue
        return error_result(
            "a matching pending group creation proposal already exists in this thread",
            details={"proposal_id": item.id, "proposal_short_id": proposal_short_id(item.id)},
        )
    return None


def propose_create_group(context: ToolContext, args: ProposeCreateGroupArgs) -> ToolExecutionResult:
    conflict = pending_create_group_conflict(
        context,
        name=args.name,
        source=args.source.value,
    )
    if conflict is not None:
        return conflict

    payload = args.model_dump(mode="json", exclude_unset=True)
    item = create_change_item(
        context,
        change_type=AgentChangeType.CREATE_GROUP,
        payload=payload,
    )
    return proposal_result("proposed group creation", preview=payload, item=item)


def propose_update_group(context: ToolContext, args: ProposeUpdateGroupArgs) -> ToolExecutionResult:
    group = match_existing_group_or_error(context, group_id=args.group_id)
    if isinstance(group, ToolExecutionResult):
        return group

    conflict = pending_group_change_conflict(
        context,
        change_type=AgentChangeType.UPDATE_GROUP,
        group_id=group.id,
    )
    if conflict is not None:
        return conflict

    patch = args.patch.model_dump(exclude_unset=True, mode="json")
    payload = {
        "group_id": group.id,
        "patch": patch,
        "current": group_preview_from_existing(context, group),
        "target": group_detail_public_record(context.db, group),
    }
    item = create_change_item(
        context,
        change_type=AgentChangeType.UPDATE_GROUP,
        payload=payload,
    )
    preview = {"group_id": group_public_id(group.id), "patch": patch}
    return proposal_result("proposed group update", preview=preview, item=item)


def propose_delete_group(context: ToolContext, args: ProposeDeleteGroupArgs) -> ToolExecutionResult:
    group = match_existing_group_or_error(context, group_id=args.group_id)
    if isinstance(group, ToolExecutionResult):
        return group

    conflict = pending_group_change_conflict(
        context,
        change_type=AgentChangeType.DELETE_GROUP,
        group_id=group.id,
    )
    if conflict is not None:
        return conflict

    summary = build_group_summary(context.db, group)
    payload = {
        "group_id": group.id,
        "target": group_detail_public_record(context.db, group),
    }
    item = create_change_item(
        context,
        change_type=AgentChangeType.DELETE_GROUP,
        payload=payload,
    )
    preview = {
        "group_id": group_public_id(group.id),
        "name": summary.name,
        "member_count": summary.member_count,
    }
    return proposal_result("proposed group deletion", preview=preview, item=item)
