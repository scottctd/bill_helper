# CALLING SPEC:
# - Purpose: auto-approve pending `AgentChangeItem` rows for a completed run when policy is YOLO.
# - Inputs: SQLAlchemy session, run id, thread id, approval policy enum, and resolved actor name.
# - Outputs: none; persists review actions and applied rows via shared batch review orchestrator.
# - Side effects: database commits inside batch review workflow; structured logging on partial failure.
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from backend.enums_agent import AgentApprovalPolicy
from backend.models_agent import AgentThread
from backend.models_finance import User
from backend.services.agent.reviews.batch_workflow import batch_review_change_items

logger = logging.getLogger(__name__)

YOLO_APPROVE_NOTE = "yolo auto-approve"


def maybe_auto_approve_after_completed_run(
    db: Session,
    *,
    run_id: str,
    thread_id: str,
    approval_policy: AgentApprovalPolicy,
) -> None:
    if approval_policy != AgentApprovalPolicy.YOLO:
        return
    thread = db.get(AgentThread, thread_id)
    if thread is None:
        logger.warning(
            "yolo auto-approve skipped scope=agent_yolo run_id=%s thread_id=%s reason=thread_missing",
            run_id,
            thread_id,
        )
        return
    owner = db.get(User, thread.owner_user_id)
    if owner is None:
        logger.warning(
            "yolo auto-approve skipped scope=agent_yolo run_id=%s thread_id=%s reason=owner_missing",
            run_id,
            thread_id,
        )
        return

    result = batch_review_change_items(
        db,
        run_id=run_id,
        actor=owner.name,
        action="approve",
        note=YOLO_APPROVE_NOTE,
    )
    if result.summary.failed > 0:
        logger.warning(
            "yolo auto-approve incomplete scope=agent_yolo run_id=%s failed_item_ids=%s",
            run_id,
            result.summary.failed_item_ids,
        )
