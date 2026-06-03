# CALLING SPEC:
# - Purpose: serialize import jobs and tasks for HTTP responses.
# - Inputs: ORM rows from import workflow services.
# - Outputs: Pydantic-ready dicts and schema instances.
# - Side effects: read-only DB queries for run usage summaries.
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.enums_agent import AgentRunStatus
from backend.models_agent import AgentRun
from backend.models_import import ImportJob, ImportTask
from backend.schemas_import import (
    ImportJobDetailRead,
    ImportJobSummaryRead,
    ImportTaskRead,
    ImportTaskRunSummaryRead,
)
from backend.services.agent.pricing import calculate_usage_costs


def _latest_run_for_thread(db: Session, *, thread_id: str) -> AgentRun | None:
    return db.scalar(
        select(AgentRun)
        .where(AgentRun.thread_id == thread_id)
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )


def _run_summary(db: Session, run: AgentRun | None) -> ImportTaskRunSummaryRead | None:
    if run is None:
        return None
    costs = calculate_usage_costs(
        model_name=run.model_name,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        cache_read_tokens=run.cache_read_tokens,
        cache_write_tokens=run.cache_write_tokens,
    )
    return ImportTaskRunSummaryRead(
        run_id=run.id,
        run_status=run.status,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        total_cost_usd=costs.total_cost_usd,
    )


def task_to_schema(db: Session, task: ImportTask) -> ImportTaskRead:
    latest_run = _latest_run_for_thread(db, thread_id=task.thread_id)
    return ImportTaskRead(
        id=task.id,
        job_id=task.job_id,
        thread_id=task.thread_id,
        source_user_file_id=task.source_user_file_id,
        source_sha256=task.source_sha256,
        source_label=task.source_label,
        status=task.status,
        active_run_id=task.active_run_id,
        error_text=task.error_text,
        sequence_index=task.sequence_index,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
        latest_run=_run_summary(db, latest_run),
    )


def _aggregate_job_cost(db: Session, job: ImportJob) -> float | None:
    thread_ids = [task.thread_id for task in job.tasks]
    if not thread_ids:
        return None
    runs = list(
        db.scalars(
            select(AgentRun).where(AgentRun.thread_id.in_(thread_ids))
        )
    )
    if not runs:
        return None
    total = 0.0
    for run in runs:
        costs = calculate_usage_costs(
            model_name=run.model_name,
            input_tokens=run.input_tokens,
            output_tokens=run.output_tokens,
            cache_read_tokens=run.cache_read_tokens,
            cache_write_tokens=run.cache_write_tokens,
        )
        if costs.total_cost_usd is not None:
            total += costs.total_cost_usd
    return total


def job_summary_to_schema(db: Session, job: ImportJob) -> ImportJobSummaryRead:
    return ImportJobSummaryRead(
        id=job.id,
        title=job.title,
        status=job.status,
        model_name=job.model_name,
        concurrency=job.concurrency,
        approval_policy=job.approval_policy,
        total_tasks=job.total_tasks,
        completed_tasks=job.completed_tasks,
        failed_tasks=job.failed_tasks,
        created_at=job.created_at,
        updated_at=job.updated_at,
        completed_at=job.completed_at,
        aggregate_total_cost_usd=_aggregate_job_cost(db, job),
    )


def job_detail_to_schema(db: Session, job: ImportJob) -> ImportJobDetailRead:
    summary = job_summary_to_schema(db, job)
    return ImportJobDetailRead(
        **summary.model_dump(),
        instructions=job.instructions,
        tasks=[task_to_schema(db, task) for task in sorted(job.tasks, key=lambda item: item.sequence_index)],
    )


def load_job_for_owner(
    db: Session,
    *,
    job_id: str,
    owner_user_id: str,
) -> ImportJob:
    job = db.scalar(
        select(ImportJob)
        .where(ImportJob.id == job_id, ImportJob.owner_user_id == owner_user_id)
        .options(selectinload(ImportJob.tasks))
    )
    if job is None:
        raise LookupError("Import job not found.")
    return job
