# CALLING SPEC:
# - Purpose: batch approve or reject pending agent change items with dependency-aware multi-pass ordering.
# - Inputs: SQLAlchemy session, actor, scope (`thread_id` or `run_id`), action, optional note, optional per-item overrides.
# - Outputs: updated change items plus succeeded/failed summary metadata.
# - Side effects: database commits per successful pass via `approve_change_item` / `reject_change_item`.
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentChangeStatus
from backend.models_agent import AgentChangeItem, AgentRun
from backend.services.agent.reviews.common import get_change_item_or_none
from backend.services.agent.reviews.ordering import sort_change_items_for_review
from backend.services.agent.reviews.workflow import approve_change_item, reject_change_item
from backend.services.crud_policy import PolicyViolation

logger = logging.getLogger(__name__)

_MAX_PASSES = 64
BatchReviewAction = Literal["approve", "reject"]


@dataclass(frozen=True, slots=True)
class BatchChangeItemInput:
    item_id: str
    payload_override: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class BatchReviewSummary:
    succeeded: int
    failed: int
    failed_item_ids: list[str]


@dataclass(frozen=True, slots=True)
class BatchReviewResult:
    items: list[AgentChangeItem]
    summary: BatchReviewSummary


def batch_review_change_items(
    db: Session,
    *,
    actor: str,
    action: BatchReviewAction,
    note: str | None = None,
    thread_id: str | None = None,
    run_id: str | None = None,
    items: list[BatchChangeItemInput] | None = None,
) -> BatchReviewResult:
    if (thread_id is None) == (run_id is None):
        raise ValueError("Exactly one of thread_id or run_id must be provided")

    overrides_by_id = {entry.item_id: entry.payload_override for entry in items or []}
    target_item_ids = {entry.item_id for entry in items} if items is not None else None

    updated_by_id: dict[str, AgentChangeItem] = {}
    succeeded = 0
    failed_item_ids: list[str] = []
    last_policy_detail: str | None = None

    for _ in range(_MAX_PASSES):
        pending = _load_pending_items(db, thread_id=thread_id, run_id=run_id, target_item_ids=target_item_ids)
        if not pending:
            break

        progressed = False
        pass_touched_items: list[AgentChangeItem] = []

        for item in pending:
            payload_override = overrides_by_id.get(item.id)
            try:
                updated = _review_single_item(
                    db,
                    item_id=item.id,
                    action=action,
                    actor=actor,
                    note=note,
                    payload_override=payload_override,
                )
            except PolicyViolation as exc:
                last_policy_detail = exc.detail
                logger.info(
                    "batch review deferred scope=agent_batch item_id=%s action=%s detail=%s",
                    item.id,
                    action,
                    exc.detail,
                )
                continue
            except Exception as exc:
                logger.warning(
                    "batch review item_error scope=agent_batch item_id=%s action=%s",
                    item.id,
                    action,
                    exc_info=exc,
                )
                failed_item_ids.append(item.id)
                refreshed = get_change_item_or_none(db, item.id)
                if refreshed is not None:
                    updated_by_id[refreshed.id] = refreshed
                    pass_touched_items.append(refreshed)
                progressed = True
                continue

            if updated is None:
                failed_item_ids.append(item.id)
                progressed = True
                continue

            updated_by_id[updated.id] = updated
            pass_touched_items.append(updated)
            succeeded += 1
            progressed = True

        if pass_touched_items:
            db.commit()
            for touched in pass_touched_items:
                db.refresh(touched)
                db.refresh(touched, attribute_names=["review_actions"])

        if not progressed:
            remaining = _load_pending_items(db, thread_id=thread_id, run_id=run_id, target_item_ids=target_item_ids)
            if remaining:
                logger.warning(
                    "batch review incomplete scope=agent_batch thread_id=%s run_id=%s action=%s remaining_pending=%s last_policy_detail=%s",
                    thread_id,
                    run_id,
                    action,
                    [item.id for item in remaining],
                    last_policy_detail,
                )
                for item in remaining:
                    if item.id not in failed_item_ids:
                        failed_item_ids.append(item.id)
            break

    failed_item_ids = list(dict.fromkeys(failed_item_ids))
    return BatchReviewResult(
        items=list(updated_by_id.values()),
        summary=BatchReviewSummary(
            succeeded=succeeded,
            failed=len(failed_item_ids),
            failed_item_ids=failed_item_ids,
        ),
    )


def _review_single_item(
    db: Session,
    *,
    item_id: str,
    action: BatchReviewAction,
    actor: str,
    note: str | None,
    payload_override: dict[str, object] | None,
) -> AgentChangeItem | None:
    if action == "approve":
        return approve_change_item(
            db,
            item_id=item_id,
            actor=actor,
            note=note,
            payload_override=payload_override,
            commit=False,
        )
    return reject_change_item(
        db,
        item_id=item_id,
        actor=actor,
        note=note,
        payload_override=payload_override,
        commit=False,
    )


def _load_pending_items(
    db: Session,
    *,
    thread_id: str | None,
    run_id: str | None,
    target_item_ids: set[str] | None,
) -> list[AgentChangeItem]:
    query = (
        select(AgentChangeItem)
        .join(AgentRun, AgentRun.id == AgentChangeItem.run_id)
        .where(AgentChangeItem.status == AgentChangeStatus.PENDING_REVIEW)
    )
    if thread_id is not None:
        query = query.where(AgentRun.thread_id == thread_id)
    if run_id is not None:
        query = query.where(AgentChangeItem.run_id == run_id)
    if target_item_ids is not None:
        query = query.where(AgentChangeItem.id.in_(target_item_ids))

    pending = list(db.scalars(query))
    return sort_change_items_for_review(pending)
