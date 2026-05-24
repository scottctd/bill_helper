# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `agent_reviews` routes.
# - Inputs: callers that import `backend/routers/agent_reviews.py` and pass module-defined arguments or framework events.
# - Outputs: router callables and request/response adapters for `agent_reviews`.
# - Side effects: FastAPI routing and HTTP error translation.
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_agent import (
    AgentBatchChangeItemReviewRequest,
    AgentBatchChangeItemReviewResponse,
    AgentBatchChangeItemReviewSummary,
    AgentChangeItemApproveRequest,
    AgentChangeItemRead,
    AgentChangeItemRejectRequest,
    AgentChangeItemReopenRequest,
)
from backend.services.access_scope import (
    load_agent_run_for_principal,
    load_agent_thread_for_principal,
    load_change_item_for_principal,
)
from backend.services.crud_policy import PolicyViolation
from backend.services.agent.reviews.batch_workflow import BatchChangeItemInput, BatchReviewAction, batch_review_change_items
from backend.services.agent.reviews.workflow import (
    approve_change_item,
    reject_change_item,
    reopen_change_item,
)
from backend.services.agent.serializers import change_item_to_schema

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)


@router.post("/change-items/{item_id}/approve", response_model=AgentChangeItemRead)
def approve_item(
    item_id: str,
    payload: AgentChangeItemApproveRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentChangeItemRead:
    load_change_item_for_principal(db, item_id=item_id, principal=principal)
    item = approve_change_item(
        db,
        item_id=item_id,
        actor=principal.user_name,
        note=payload.note,
        payload_override=payload.payload_override,
    )
    if item is None:
        raise PolicyViolation.not_found("Change item not found")
    return change_item_to_schema(item)


def _batch_review_response(
    db: Session,
    *,
    actor: str,
    action: BatchReviewAction,
    payload: AgentBatchChangeItemReviewRequest,
    thread_id: str | None = None,
    run_id: str | None = None,
) -> AgentBatchChangeItemReviewResponse:
    item_inputs = None
    if payload.items is not None:
        item_inputs = [
            BatchChangeItemInput(item_id=item.item_id, payload_override=item.payload_override)
            for item in payload.items
        ]
    result = batch_review_change_items(
        db,
        actor=actor,
        action=action,
        note=payload.note,
        thread_id=thread_id,
        run_id=run_id,
        items=item_inputs,
    )
    return AgentBatchChangeItemReviewResponse(
        items=[change_item_to_schema(item) for item in result.items],
        summary=AgentBatchChangeItemReviewSummary(
            succeeded=result.summary.succeeded,
            failed=result.summary.failed,
            failed_item_ids=result.summary.failed_item_ids,
        ),
    )


@router.post(
    "/threads/{thread_id}/change-items/batch-approve",
    response_model=AgentBatchChangeItemReviewResponse,
)
def batch_approve_items_for_thread(
    thread_id: str,
    payload: AgentBatchChangeItemReviewRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentBatchChangeItemReviewResponse:
    load_agent_thread_for_principal(db, thread_id=thread_id, principal=principal)
    return _batch_review_response(
        db,
        actor=principal.user_name,
        action="approve",
        payload=payload,
        thread_id=thread_id,
    )


@router.post(
    "/threads/{thread_id}/change-items/batch-reject",
    response_model=AgentBatchChangeItemReviewResponse,
)
def batch_reject_items_for_thread(
    thread_id: str,
    payload: AgentBatchChangeItemReviewRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentBatchChangeItemReviewResponse:
    load_agent_thread_for_principal(db, thread_id=thread_id, principal=principal)
    return _batch_review_response(
        db,
        actor=principal.user_name,
        action="reject",
        payload=payload,
        thread_id=thread_id,
    )


@router.post(
    "/runs/{run_id}/change-items/batch-approve",
    response_model=AgentBatchChangeItemReviewResponse,
)
def batch_approve_items_for_run(
    run_id: str,
    payload: AgentBatchChangeItemReviewRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentBatchChangeItemReviewResponse:
    load_agent_run_for_principal(db, run_id=run_id, principal=principal)
    return _batch_review_response(
        db,
        actor=principal.user_name,
        action="approve",
        payload=payload,
        run_id=run_id,
    )


@router.post(
    "/runs/{run_id}/change-items/batch-reject",
    response_model=AgentBatchChangeItemReviewResponse,
)
def batch_reject_items_for_run(
    run_id: str,
    payload: AgentBatchChangeItemReviewRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentBatchChangeItemReviewResponse:
    load_agent_run_for_principal(db, run_id=run_id, principal=principal)
    return _batch_review_response(
        db,
        actor=principal.user_name,
        action="reject",
        payload=payload,
        run_id=run_id,
    )


@router.post("/change-items/{item_id}/reject", response_model=AgentChangeItemRead)
def reject_item(
    item_id: str,
    payload: AgentChangeItemRejectRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentChangeItemRead:
    load_change_item_for_principal(db, item_id=item_id, principal=principal)
    item = reject_change_item(
        db,
        item_id=item_id,
        actor=principal.user_name,
        note=payload.note,
        payload_override=payload.payload_override,
    )
    if item is None:
        raise PolicyViolation.not_found("Change item not found")
    return change_item_to_schema(item)


@router.post("/change-items/{item_id}/reopen", response_model=AgentChangeItemRead)
def reopen_item(
    item_id: str,
    payload: AgentChangeItemReopenRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> AgentChangeItemRead:
    load_change_item_for_principal(db, item_id=item_id, principal=principal)
    item = reopen_change_item(
        db,
        item_id=item_id,
        actor=principal.user_name,
        note=payload.note,
        payload_override=payload.payload_override,
    )
    if item is None:
        raise PolicyViolation.not_found("Change item not found")
    return change_item_to_schema(item)
