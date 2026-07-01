# CALLING SPEC:
# - Purpose: in-process worker pool that drains import task queues per job.
# - Inputs: import job ids after task rows are created; agent run terminal notifications.
# - Outputs: started agent runs for queued import tasks up to job concurrency.
# - Side effects: background threads, agent message/run creation, task/job status updates.
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.database import get_session_maker, open_session
from backend.enums_agent import AgentRunStatus
from backend.enums_import import ImportJobStatus, ImportTaskStatus
from backend.models_agent import AgentRun
from backend.models_import import ImportJob, ImportTask
from backend.models_shared import utc_now
from backend.services.agent.execution import create_user_message_and_start_run, run_agent_in_background
from backend.services.agent.runtime import interrupt_agent_run
from backend.services.crud_policy import PolicyViolation

_logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]


@dataclass
class _JobCoordinator:
    job_id: str
    wake_event: threading.Event = field(default_factory=threading.Event)
    cancel_event: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


_registry_lock = threading.Lock()
_coordinators: dict[str, _JobCoordinator] = {}


def reset_import_scheduler_for_tests() -> None:
    with _registry_lock:
        coordinators = list(_coordinators.values())
        _coordinators.clear()
    for coordinator in coordinators:
        coordinator.cancel_event.set()
        coordinator.wake_event.set()
        if coordinator.thread is not None and coordinator.thread.is_alive():
            coordinator.thread.join(timeout=2.0)


def start_import_job(job_id: str, *, session_factory: SessionFactory | None = None) -> None:
    factory = session_factory or get_session_maker()
    with _registry_lock:
        existing = _coordinators.get(job_id)
        if existing is not None and existing.thread is not None and existing.thread.is_alive():
            existing.wake_event.set()
            return
        coordinator = _JobCoordinator(job_id=job_id)
        coordinator.thread = threading.Thread(
            target=_coordinator_loop,
            kwargs={"job_id": job_id, "session_factory": factory, "coordinator": coordinator},
            daemon=True,
            name=f"import-job-{job_id[:8]}",
        )
        _coordinators[job_id] = coordinator
        coordinator.thread.start()


def notify_agent_run_terminal(run_id: str, *, session_factory: SessionFactory | None = None) -> None:
    factory = session_factory or get_session_maker()
    db = factory()
    try:
        task = db.scalar(select(ImportTask).where(ImportTask.active_run_id == run_id))
        if task is None:
            return
        run = db.get(AgentRun, run_id)
        if run is None:
            return
        _finalize_task_for_run(db, task=task, run=run)
        db.commit()
        _wake_job(task.job_id)
    finally:
        db.close()


def _wake_job(job_id: str) -> None:
    with _registry_lock:
        coordinator = _coordinators.get(job_id)
    if coordinator is not None:
        coordinator.wake_event.set()


def _load_job(db: Session, job_id: str) -> ImportJob | None:
    return db.scalar(
        select(ImportJob)
        .where(ImportJob.id == job_id)
        .options(selectinload(ImportJob.tasks))
    )


def _running_task_count(tasks: list[ImportTask]) -> int:
    return sum(1 for task in tasks if task.status == ImportTaskStatus.RUNNING)


def _reconcile_job_counters(db: Session, job: ImportJob) -> None:
    completed = sum(1 for task in job.tasks if task.status == ImportTaskStatus.COMPLETED)
    failed = sum(
        1
        for task in job.tasks
        if task.status in {ImportTaskStatus.FAILED, ImportTaskStatus.CANCELLED}
    )
    job.completed_tasks = completed
    job.failed_tasks = failed
    job.updated_at = utc_now()


def _maybe_finalize_job(db: Session, job: ImportJob) -> None:
    _reconcile_job_counters(db, job)
    terminal_statuses = {
        ImportTaskStatus.COMPLETED,
        ImportTaskStatus.FAILED,
        ImportTaskStatus.CANCELLED,
    }
    if not all(task.status in terminal_statuses for task in job.tasks):
        return
    if job.status == ImportJobStatus.CANCELLED:
        job.completed_at = job.completed_at or utc_now()
        db.add(job)
        return
    if any(task.status == ImportTaskStatus.FAILED for task in job.tasks):
        job.status = ImportJobStatus.FAILED
    else:
        job.status = ImportJobStatus.COMPLETED
    job.completed_at = utc_now()
    job.updated_at = utc_now()
    db.add(job)


def _finalize_task_for_run(db: Session, *, task: ImportTask, run: AgentRun) -> None:
    now = utc_now()
    if run.status == AgentRunStatus.COMPLETED:
        task.status = ImportTaskStatus.COMPLETED
        task.error_text = None
    else:
        task.status = ImportTaskStatus.FAILED
        task.error_text = run.error_detail or f"Agent run ended with status {run.status.value}."
    task.active_run_id = None
    task.completed_at = now
    task.updated_at = now
    db.add(task)
    job = _load_job(db, task.job_id)
    if job is not None:
        _maybe_finalize_job(db, job)


def _start_task_run(db: Session, *, job: ImportJob, task: ImportTask) -> None:
    content = job.instructions.strip() or "Import the attached source file into Bill Helper."
    try:
        run = asyncio.run(
            create_user_message_and_start_run(
                thread_id=task.thread_id,
                content=content,
                files=[],
                attachment_ids=[task.source_user_file_id] if task.source_user_file_id else [],
                attachments_use_ocr=False,
                db=db,
                model_name=job.model_name,
                surface="app",
                approval_policy=job.approval_policy,
                principal_user_id=job.owner_user_id,
            )
        )
    except PolicyViolation as exc:
        task.status = ImportTaskStatus.FAILED
        task.error_text = exc.detail
        task.completed_at = utc_now()
        task.updated_at = utc_now()
        db.add(task)
        _maybe_finalize_job(db, job)
        return

    task.status = ImportTaskStatus.RUNNING
    task.active_run_id = run.id
    task.error_text = None
    task.updated_at = utc_now()
    db.add(task)
    db.commit()
    run_agent_in_background(run.id, session_factory=get_session_maker())


def _dispatch_tasks(db: Session, *, job: ImportJob) -> None:
    if job.status in {ImportJobStatus.CANCELLED, ImportJobStatus.COMPLETED, ImportJobStatus.FAILED}:
        return
    running_count = _running_task_count(job.tasks)
    available_slots = max(job.concurrency - running_count, 0)
    if available_slots <= 0:
        return

    queued_tasks = [
        task
        for task in sorted(job.tasks, key=lambda item: item.sequence_index)
        if task.status == ImportTaskStatus.QUEUED
    ][:available_slots]
    for task in queued_tasks:
        _start_task_run(db, job=job, task=task)


def _interrupt_running_tasks(db: Session, *, job: ImportJob) -> None:
    for task in job.tasks:
        if task.status != ImportTaskStatus.RUNNING or not task.active_run_id:
            continue
        interrupt_agent_run(db, task.active_run_id)


def _coordinator_loop(
    *,
    job_id: str,
    session_factory: SessionFactory,
    coordinator: _JobCoordinator,
) -> None:
    try:
        while not coordinator.cancel_event.is_set():
            db = session_factory()
            try:
                job = _load_job(db, job_id)
                if job is None:
                    return
                if job.status == ImportJobStatus.CANCELLED:
                    _interrupt_running_tasks(db, job=job)
                    db.commit()
                    return
                _dispatch_tasks(db, job=job)
                db.commit()
                db.refresh(job)
                terminal = {
                    ImportTaskStatus.COMPLETED,
                    ImportTaskStatus.FAILED,
                    ImportTaskStatus.CANCELLED,
                }
                if job.status in {
                    ImportJobStatus.COMPLETED,
                    ImportJobStatus.FAILED,
                    ImportJobStatus.CANCELLED,
                }:
                    return
                if all(task.status in terminal for task in job.tasks):
                    _maybe_finalize_job(db, job)
                    db.commit()
                    return
            finally:
                db.close()

            coordinator.wake_event.wait(timeout=1.0)
            coordinator.wake_event.clear()
    except Exception:
        _logger.exception("import coordinator failed job_id=%s", job_id)
        db = session_factory()
        try:
            job = _load_job(db, job_id)
            if job is not None:
                job.status = ImportJobStatus.FAILED
                job.updated_at = utc_now()
                db.add(job)
                db.commit()
        finally:
            db.close()
    finally:
        with _registry_lock:
            if _coordinators.get(job_id) is coordinator:
                _coordinators.pop(job_id, None)


def cancel_import_job_scheduler(job_id: str) -> None:
    with _registry_lock:
        coordinator = _coordinators.get(job_id)
    if coordinator is None:
        return
    coordinator.cancel_event.set()
    coordinator.wake_event.set()
