"""Thread-scoped proposal HTTP helpers.

CALLING SPEC:
    build_thread_tool_context(db, principal=principal, thread_id=thread_id, run_id=run_id) -> ToolContext
    list_thread_proposals(context, proposal_type=None, proposal_status=None, change_action=None, proposal_id=None, limit=10) -> dict
    get_thread_proposal(context, proposal_id=proposal_id) -> dict
    create_thread_proposal(context, change_type=change_type, payload_json=payload_json) -> dict
    create_thread_entry_proposals_batch(context, entries=entries) -> dict

Inputs:
    - principal-scoped SQLAlchemy session, thread id, run id, and validated request data
Outputs:
    - JSON-serializable proposal record/list payloads for HTTP routes
Side effects:
    - validates run/thread ownership, creates pending proposal rows, and flushes DB state
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.auth.contracts import RequestPrincipal
from backend.enums_agent import AgentChangeStatus, AgentChangeType
from backend.models_agent import AgentChangeItem
from backend.services.access_scope import load_agent_run_for_principal
from backend.services.agent.work_sessions import ensure_external_agent_run
from backend.services.agent.change_contracts.entries import (
    CreateEntryPayload,
)
from backend.services.agent.change_contracts.patches import validate_patch_map_paths
from backend.services.agent.change_registry import change_type_spec, proposal_summary_for_payload
from backend.services.agent.proposal_metadata import proposal_metadata_for_change_type
from backend.services.agent.proposal_patching import apply_patch_map_to_payload
from backend.services.agent.error_policy import report_recoverable_error
from backend.services.agent.proposals.common import (
    proposal_short_id,
    proposals_for_thread,
    resolve_proposal_by_id,
)
from backend.services.agent.proposals.entries import (
    propose_create_entry,
    validate_create_entry_entity_references,
)
from backend.services.agent.tool_types import ToolContext, ToolExecutionStatus
from backend.services.crud_policy import PolicyViolation


def build_thread_tool_context(
    db: Session,
    *,
    principal: RequestPrincipal,
    thread_id: str,
    run_id: str | None,
) -> ToolContext:
    normalized_run_id = (run_id or "").strip()
    if normalized_run_id:
        run = load_agent_run_for_principal(db, run_id=normalized_run_id, principal=principal)
    else:
        run = ensure_external_agent_run(db, principal=principal, session_id=thread_id)
    if run.thread_id != thread_id:
        raise PolicyViolation.bad_request("Run does not belong to the requested thread.")
    return ToolContext(
        db=db,
        run_id=run.id,
        principal_name=principal.user_name,
        principal_user_id=principal.user_id,
        principal_is_admin=principal.is_admin,
    )


def list_thread_proposals(
    context: ToolContext,
    *,
    proposal_type: str | None = None,
    proposal_status: AgentChangeStatus | None = None,
    change_action: str | None = None,
    proposal_id: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    filtered_items = proposals_for_thread(
        context,
        include_review_actions=True,
        newest_first=True,
    )
    if proposal_type is not None:
        filtered_items = [
            item for item in filtered_items if proposal_metadata_for_change_type(item.change_type).proposal_type == proposal_type
        ]
    if change_action is not None:
        filtered_items = [
            item for item in filtered_items if proposal_metadata_for_change_type(item.change_type).change_action == change_action
        ]
    if proposal_status is not None:
        filtered_items = [item for item in filtered_items if item.status == proposal_status]
    if proposal_id is not None:
        resolved = resolve_proposal_by_id(context, proposal_id, items=filtered_items)
        filtered_items = [] if resolved is None else [resolved]

    records = [_public_proposal_record(item) for item in filtered_items[:limit]]
    return {
        "returned_count": len(records),
        "total_available": len(filtered_items),
        "proposals": records,
    }


def get_thread_proposal(context: ToolContext, *, proposal_id: str) -> dict[str, Any]:
    item = _load_proposal_item(context, proposal_id=proposal_id)
    return _public_proposal_record(item)


def create_thread_proposal(
    context: ToolContext,
    *,
    change_type: AgentChangeType,
    payload_json: dict[str, Any],
) -> dict[str, Any]:
    try:
        spec = change_type_spec(change_type)
    except ValueError as exc:
        raise PolicyViolation.bad_request(
            f"Unsupported proposal change type: {change_type.value}.",
        ) from exc
    parsed = _validate_arguments(spec.propose_args_model, payload_json)
    result = spec.propose_handler(context, parsed)
    if result.status != ToolExecutionStatus.OK:
        raise PolicyViolation.bad_request(
            result.output_json.get("summary", "Proposal creation failed."),
        )
    proposal_id = str(result.output_json["proposal_id"])
    return get_thread_proposal(context, proposal_id=proposal_id)


def create_thread_entry_proposals_batch(
    context: ToolContext,
    *,
    entries: list[CreateEntryPayload],
) -> dict[str, Any]:
    for index, entry in enumerate(entries):
        try:
            validate_create_entry_entity_references(
                context,
                from_entity=entry.from_entity,
                to_entity=entry.to_entity,
            )
        except ValueError as exc:
            raise PolicyViolation.bad_request(f"entries[{index}]: {exc}") from exc

    created_items: list[AgentChangeItem] = []
    for index, entry in enumerate(entries):
        result = propose_create_entry(context, entry)
        if result.status != ToolExecutionStatus.OK:
            raise PolicyViolation.bad_request(
                f"entries[{index}]: {result.output_json.get('summary', 'Proposal creation failed.')}",
            )
        proposal_id = str(result.output_json["proposal_id"])
        created_items.append(_load_proposal_item(context, proposal_id=proposal_id))

    records = [_public_proposal_record(item) for item in created_items]
    return {
        "returned_count": len(records),
        "total_available": len(records),
        "proposals": records,
    }


def update_thread_proposal(
    context: ToolContext,
    *,
    proposal_id: str,
    patch_map: dict[str, Any],
) -> dict[str, Any]:
    item = _load_mutable_proposal_item(context, proposal_id=proposal_id)
    try:
        validate_patch_map_paths(item.change_type, patch_map)
        updated_payload = apply_patch_map_to_payload(dict(item.payload_json), patch_map)
    except ValueError as exc:
        raise PolicyViolation.bad_request(f"Invalid proposal patch: {exc}") from exc
    item.payload_json = _validate_payload_model(
        change_type_spec(item.change_type).effective_stored_payload_model,
        updated_payload,
    )
    context.db.add(item)
    context.db.flush()
    return get_thread_proposal(context, proposal_id=item.id)


def delete_thread_proposal(
    context: ToolContext,
    *,
    proposal_id: str,
) -> None:
    item = _load_mutable_proposal_item(context, proposal_id=proposal_id)
    context.db.delete(item)
    context.db.flush()


def _load_proposal_item(context: ToolContext, *, proposal_id: str) -> AgentChangeItem:
    item = resolve_proposal_by_id(context, proposal_id)
    if item is None:
        raise PolicyViolation.not_found("Proposal not found.")
    statement = (
        select(AgentChangeItem)
        .options(selectinload(AgentChangeItem.review_actions))
        .where(AgentChangeItem.id == item.id)
    )
    loaded_item = context.db.scalar(statement)
    if loaded_item is None:
        raise PolicyViolation.not_found("Proposal not found.")
    return loaded_item


def _load_mutable_proposal_item(context: ToolContext, *, proposal_id: str) -> AgentChangeItem:
    item = _load_proposal_item(context, proposal_id=proposal_id)
    if item.status != AgentChangeStatus.PENDING_REVIEW:
        raise PolicyViolation.bad_request(
            "Only pending proposals can be updated or removed.",
        )
    return item


def _public_proposal_record(item: AgentChangeItem) -> dict[str, Any]:
    metadata = proposal_metadata_for_change_type(item.change_type)
    return {
        "proposal_id": item.id,
        "proposal_short_id": proposal_short_id(item.id),
        "proposal_type": metadata.proposal_type,
        "change_action": metadata.change_action,
        "change_type": item.change_type.value,
        "status": item.status.value,
        "proposal_summary": proposal_summary_for_payload(item.change_type, item.payload_json),
        "payload": dict(item.payload_json),
        "review_note": item.review_note,
        "applied_resource_type": item.applied_resource_type,
        "applied_resource_id": item.applied_resource_id,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
        "run_id": item.run_id,
        "review_actions": [
            {
                "id": action.id,
                "change_item_id": action.change_item_id,
                "action": action.action.value,
                "actor": action.actor,
                "note": action.note,
                "created_at": action.created_at.isoformat(),
            }
            for action in item.review_actions
        ],
    }


def _validate_arguments(args_model, payload_json: dict[str, Any]):
    try:
        return args_model.model_validate(payload_json)
    except Exception as exc:
        report_recoverable_error(
            scope="proposal_http.validate_arguments",
            error=exc,
            context={"model": getattr(args_model, "__name__", str(args_model))},
        )
        raise PolicyViolation.bad_request(f"Invalid proposal payload: {exc}") from exc


def _validate_payload_model(args_model, payload_json: dict[str, Any]) -> dict[str, Any]:
    return _validate_arguments(args_model, payload_json).model_dump(mode="json")
