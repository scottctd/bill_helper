# CALLING SPEC:
# - Purpose: implement focused service logic for `common`.
# - Inputs: callers that import `backend/services/agent/proposals/group_memberships/common.py` and pass module-defined arguments or framework events.
# - Outputs: service functions, contracts, or helpers exported by `common`.
# - Side effects: module-defined persistence, validation, or orchestration behavior.
from __future__ import annotations

from typing import Any

from backend.enums_agent import AgentChangeStatus
from backend.models_agent import AgentChangeItem
from backend.models_finance import Entry
from backend.services.agent.change_contracts.entries import EntryReferencePayload
from backend.services.agent.change_contracts.groups import (
    GroupMemberEntryTargetPayload,
    GroupMemberTargetPayload,
    GroupReferencePayload,
    normalize_group_member_payload,
    parse_group_member_target_payload,
)
from backend.services.agent.entry_references import (
    entry_id_ambiguity_details,
    entry_to_public_record,
    find_entries_by_public_id_prefix,
)
from backend.services.agent.proposals.entries import (
    entry_preview_from_proposal,
    match_existing_entry_or_error,
    resolve_entry_proposal_reference_or_error,
)
from backend.services.agent.proposals.groups import (
    canonical_group_ref_payload,
    group_preview_from_proposal,
    group_ref_signature,
    resolve_group_proposal_reference_or_error,
)
from backend.services.agent.tool_results import error_result
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult


def canonical_entry_ref_payload(
    context: ToolContext,
    *,
    entry_ref: EntryReferencePayload,
    expected_statuses: set[AgentChangeStatus] | None = None,
) -> tuple[dict[str, Any], Entry | None, AgentChangeItem | None] | ToolExecutionResult:
    if entry_ref.entry_id is not None:
        entry = match_existing_entry_or_error(context, entry_id=entry_ref.entry_id)
        if isinstance(entry, ToolExecutionResult):
            return entry
        return {"entry_id": entry.id}, entry, None

    assert entry_ref.create_entry_proposal_id is not None
    proposal = resolve_entry_proposal_reference_or_error(
        context,
        proposal_id=entry_ref.create_entry_proposal_id,
        expected_statuses=expected_statuses,
    )
    if isinstance(proposal, ToolExecutionResult):
        return proposal
    return {"create_entry_proposal_id": proposal.id}, None, proposal


def canonical_group_member_target_payload(
    context: ToolContext,
    *,
    target: GroupMemberTargetPayload,
    expected_statuses: set[AgentChangeStatus] | None = None,
) -> tuple[dict[str, Any], Entry | None, AgentChangeItem | None] | ToolExecutionResult:
    resolved_entry_ref = canonical_entry_ref_payload(
        context,
        entry_ref=target.entry_ref,
        expected_statuses=expected_statuses,
    )
    if isinstance(resolved_entry_ref, ToolExecutionResult):
        return resolved_entry_ref
    canonical_target: dict[str, Any] = {
        "target_type": "entry",
        "entry_ref": resolved_entry_ref[0],
    }
    if target.override is not None:
        canonical_target["override"] = target.override.value
    return canonical_target, resolved_entry_ref[1], resolved_entry_ref[2]


def resolved_group_member_target_preview(
    context: ToolContext,
    *,
    target: GroupMemberTargetPayload,
) -> tuple[dict[str, Any], str | None] | ToolExecutionResult:
    if target.entry_ref.entry_id is not None:
        matches = find_entries_by_public_id_prefix(context.db, target.entry_ref.entry_id)
        if not matches:
            return error_result("no entry matched entry_id", details={"entry_id": target.entry_ref.entry_id})
        if len(matches) > 1:
            return error_result(
                "ambiguous entry_id matched multiple entries; retry with one of the candidate ids",
                details=entry_id_ambiguity_details(
                    matches,
                    entry_id=target.entry_ref.entry_id,
                    db=context.db,
                ),
            )
        entry = matches[0]
        preview = entry_to_public_record(entry, db=context.db)
        preview["source"] = "entry"
        return preview, entry.id

    proposal = resolve_entry_proposal_reference_or_error(
        context,
        proposal_id=target.entry_ref.create_entry_proposal_id or "",
        expected_statuses={
            AgentChangeStatus.PENDING_REVIEW,
            AgentChangeStatus.APPROVED,
            AgentChangeStatus.APPLIED,
        },
    )
    if isinstance(proposal, ToolExecutionResult):
        return proposal
    preview = entry_preview_from_proposal(proposal)
    return preview, None


def group_member_signature(payload: dict[str, Any]) -> tuple[tuple[str, str], str, tuple[str, str]]:
    normalized_payload = normalize_group_member_payload(payload)
    group_ref = GroupReferencePayload.model_validate(normalized_payload.get("group_ref"))
    target = parse_group_member_target_payload(normalized_payload.get("target"))
    target_kind, target_signature = _group_member_target_signature(target)
    return (group_ref_signature(group_ref), target_kind, target_signature)


def payload_group_member_target_type(payload: dict[str, Any]) -> str | None:
    normalized_payload = normalize_group_member_payload(payload)
    target = normalized_payload.get("target")
    if not isinstance(target, dict):
        return None
    target_type = target.get("target_type")
    return target_type if isinstance(target_type, str) else None


def _entry_ref_signature(entry_ref: EntryReferencePayload) -> tuple[str, str]:
    if entry_ref.entry_id is not None:
        return ("entry", entry_ref.entry_id)
    assert entry_ref.create_entry_proposal_id is not None
    return ("proposal", entry_ref.create_entry_proposal_id)


def _group_member_target_signature(target: GroupMemberTargetPayload) -> tuple[str, tuple[str, str]]:
    return ("entry", _entry_ref_signature(target.entry_ref))
