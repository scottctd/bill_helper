# CALLING SPEC:
# - Purpose: aggregate import-job proposals with naive dedup and crash-safe batch approval.
# - Inputs: import job scope and canonical change-item ids from review actions.
# - Outputs: deduped proposal rows and per-item batch apply results.
# - Side effects: DB updates to change items; per-item commits on batch approve.
from __future__ import annotations

import logging
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentChangeStatus
from backend.models_agent import AgentChangeItem, AgentRun
from backend.models_import import ImportJob, ImportTask
from backend.schemas_import import ImportJobAggregatedProposalRead, ImportJobBatchApplyItemResult, ImportJobBatchApplyResponse
from backend.services.agent.reviews.workflow import approve_change_item, reject_change_item
from backend.services.crud_policy import PolicyViolation
from backend.services.import_workflow.dedup import proposal_dedup_signature

_logger = logging.getLogger(__name__)


def _pending_items_for_job(db: Session, job: ImportJob) -> list[AgentChangeItem]:
    thread_ids = [task.thread_id for task in job.tasks]
    if not thread_ids:
        return []
    return list(
        db.scalars(
            select(AgentChangeItem)
            .join(AgentRun, AgentRun.id == AgentChangeItem.run_id)
            .where(
                AgentRun.thread_id.in_(thread_ids),
                AgentChangeItem.status == AgentChangeStatus.PENDING_REVIEW,
            )
            .order_by(AgentChangeItem.created_at.asc())
        )
    )


def _task_by_thread_id(job: ImportJob) -> dict[str, ImportTask]:
    return {task.thread_id: task for task in job.tasks}


def aggregate_job_proposals(db: Session, *, job: ImportJob) -> list[ImportJobAggregatedProposalRead]:
    items = _pending_items_for_job(db, job)
    runs_by_id = {
        run.id: run
        for run in db.scalars(
            select(AgentRun).where(AgentRun.thread_id.in_([task.thread_id for task in job.tasks]))
        )
    }
    task_by_thread = _task_by_thread_id(job)
    groups: dict[tuple, list[AgentChangeItem]] = defaultdict(list)
    for item in items:
        groups[proposal_dedup_signature(item)].append(item)

    aggregated: list[ImportJobAggregatedProposalRead] = []
    for grouped_items in groups.values():
        canonical = grouped_items[0]
        seen_task_ids: set[str] = set()
        source_tasks: list[ImportTask] = []
        for duplicate in grouped_items:
            run = runs_by_id.get(duplicate.run_id)
            if run is None:
                continue
            task = task_by_thread.get(run.thread_id)
            if task is not None and task.id not in seen_task_ids:
                seen_task_ids.add(task.id)
                source_tasks.append(task)
        aggregated.append(
            ImportJobAggregatedProposalRead(
                canonical_change_item_id=canonical.id,
                change_type=canonical.change_type.value,
                status=canonical.status.value,
                payload_json=canonical.payload_json,
                duplicate_count=len(grouped_items),
                source_task_ids=[task.id for task in source_tasks],
                source_task_labels=[task.source_label for task in source_tasks],
            )
        )
    return aggregated


def _reject_duplicate_siblings(
    db: Session,
    *,
    actor: str,
    canonical: AgentChangeItem,
    grouped_items: list[AgentChangeItem],
) -> None:
    for sibling in grouped_items:
        if sibling.id == canonical.id:
            continue
        if sibling.status != AgentChangeStatus.PENDING_REVIEW:
            continue
        reject_change_item(
            db,
            item_id=sibling.id,
            actor=actor,
            note="Merged duplicate during import job review.",
            commit=True,
        )


def batch_approve_job_proposals(
    db: Session,
    *,
    job: ImportJob,
    actor: str,
    change_item_ids: list[str] | None = None,
) -> ImportJobBatchApplyResponse:
    items = _pending_items_for_job(db, job)
    groups: dict[tuple, list[AgentChangeItem]] = defaultdict(list)
    for item in items:
        groups[proposal_dedup_signature(item)].append(item)

    target_ids = set(change_item_ids) if change_item_ids is not None else None
    results: list[ImportJobBatchApplyItemResult] = []
    applied_count = 0
    failed_count = 0

    for grouped_items in groups.values():
        canonical = grouped_items[0]
        if target_ids is not None and canonical.id not in target_ids:
            continue
        try:
            approved = approve_change_item(
                db,
                item_id=canonical.id,
                actor=actor,
                commit=True,
            )
            if approved is None:
                raise PolicyViolation.not_found("Change item not found.")
            _reject_duplicate_siblings(db, actor=actor, canonical=canonical, grouped_items=grouped_items)
            applied_count += 1
            results.append(
                ImportJobBatchApplyItemResult(change_item_id=canonical.id, status="applied")
            )
        except PolicyViolation as exc:
            db.rollback()
            failed_count += 1
            _logger.info(
                "import batch approve failed scope=import_job job_id=%s item_id=%s detail=%s",
                job.id,
                canonical.id,
                exc.detail,
            )
            results.append(
                ImportJobBatchApplyItemResult(
                    change_item_id=canonical.id,
                    status="failed",
                    error=exc.detail,
                )
            )
        except Exception as exc:
            db.rollback()
            failed_count += 1
            _logger.warning(
                "import batch approve item_error scope=import_job job_id=%s item_id=%s",
                job.id,
                canonical.id,
                exc_info=exc,
            )
            results.append(
                ImportJobBatchApplyItemResult(
                    change_item_id=canonical.id,
                    status="failed",
                    error=str(exc),
                )
            )

    return ImportJobBatchApplyResponse(
        applied_count=applied_count,
        failed_count=failed_count,
        results=results,
    )


def batch_reject_job_proposals(
    db: Session,
    *,
    job: ImportJob,
    actor: str,
    change_item_ids: list[str] | None = None,
) -> ImportJobBatchApplyResponse:
    items = _pending_items_for_job(db, job)
    target_ids = set(change_item_ids) if change_item_ids is not None else None
    results: list[ImportJobBatchApplyItemResult] = []
    applied_count = 0
    failed_count = 0

    for item in items:
        if target_ids is not None and item.id not in target_ids:
            continue
        try:
            rejected = reject_change_item(
                db,
                item_id=item.id,
                actor=actor,
                note="Rejected from import job review.",
                commit=True,
            )
            if rejected is None:
                raise PolicyViolation.not_found("Change item not found.")
            applied_count += 1
            results.append(ImportJobBatchApplyItemResult(change_item_id=item.id, status="applied"))
        except PolicyViolation as exc:
            db.rollback()
            failed_count += 1
            results.append(
                ImportJobBatchApplyItemResult(
                    change_item_id=item.id,
                    status="failed",
                    error=exc.detail,
                )
            )
        except Exception as exc:
            db.rollback()
            failed_count += 1
            _logger.warning(
                "import batch reject item_error scope=import_job job_id=%s item_id=%s",
                job.id,
                item.id,
                exc_info=exc,
            )
            results.append(
                ImportJobBatchApplyItemResult(
                    change_item_id=item.id,
                    status="failed",
                    error=str(exc),
                )
            )

    return ImportJobBatchApplyResponse(
        applied_count=applied_count,
        failed_count=failed_count,
        results=results,
    )
