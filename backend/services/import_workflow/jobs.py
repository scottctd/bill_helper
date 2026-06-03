# CALLING SPEC:
# - Purpose: import job/task persistence and state transitions.
# - Inputs: authenticated owner context and validated create/cancel/retry requests.
# - Outputs: created/updated `ImportJob` and `ImportTask` rows.
# - Side effects: DB writes; delegates run dispatch to the import scheduler.
from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from backend.enums_agent import AgentApprovalPolicy
from backend.enums_import import ImportJobStatus, ImportTaskStatus
from backend.models_agent import AgentThread
from backend.models_files import UserFile
from backend.models_import import ImportJob, ImportTask
from backend.models_shared import utc_now
from backend.services.agent.attachments import load_draft_attachment_user_file
from backend.services.crud_policy import PolicyViolation
from backend.services.runtime_settings import resolve_runtime_settings
from backend.validation.runtime_settings import normalize_text_or_none


def derive_thread_title_from_filename(filename: str) -> str:
    stem = Path(filename).stem.strip()
    return stem[:255] if stem else "Import"


def derive_job_title_from_labels(labels: list[str]) -> str:
    if not labels:
        return "Import job"
    if len(labels) == 1:
        return f"Import {labels[0]}"
    return f"Import {labels[0]} +{len(labels) - 1}"


def _resolve_model_name(db: Session, model_name: str | None) -> str:
    settings = resolve_runtime_settings(db)
    selected = normalize_text_or_none(model_name) or settings.agent_model
    if selected.casefold() not in {item.casefold() for item in settings.available_agent_models}:
        raise PolicyViolation.bad_request("Selected model is not enabled in runtime settings.")
    return selected


def _resolve_concurrency(db: Session, concurrency: int | None) -> int:
    settings = resolve_runtime_settings(db)
    resolved = concurrency if concurrency is not None else settings.agent_bulk_max_concurrent_threads
    if resolved < 1 or resolved > 16:
        raise PolicyViolation.bad_request("concurrency must be between 1 and 16.")
    return resolved


def _load_source_files(
    db: Session,
    *,
    owner_user_id: str,
    source_attachment_ids: list[str],
) -> list[UserFile]:
    unique_ids = list(dict.fromkeys(source_attachment_ids))
    files: list[UserFile] = []
    for attachment_id in unique_ids:
        files.append(
            load_draft_attachment_user_file(
                db,
                attachment_id=attachment_id,
                owner_user_id=owner_user_id,
            )
        )
    return files


def create_import_job(
    db: Session,
    *,
    owner_user_id: str,
    title: str | None,
    model_name: str | None,
    concurrency: int | None,
    approval_policy: AgentApprovalPolicy,
    instructions: str,
    source_attachment_ids: list[str],
) -> ImportJob:
    if not source_attachment_ids:
        raise PolicyViolation.bad_request("At least one source attachment is required.")

    source_files = _load_source_files(
        db,
        owner_user_id=owner_user_id,
        source_attachment_ids=source_attachment_ids,
    )
    resolved_model = _resolve_model_name(db, model_name)
    resolved_concurrency = _resolve_concurrency(db, concurrency)
    labels = [
        user_file.display_name or user_file.original_filename or user_file.id
        for user_file in source_files
    ]
    job = ImportJob(
        owner_user_id=owner_user_id,
        title=normalize_text_or_none(title) or derive_job_title_from_labels(labels),
        status=ImportJobStatus.QUEUED,
        model_name=resolved_model,
        concurrency=resolved_concurrency,
        approval_policy=approval_policy,
        instructions=instructions.strip(),
        total_tasks=len(source_files),
    )
    db.add(job)
    db.flush()

    for index, user_file in enumerate(source_files):
        label = user_file.display_name or user_file.original_filename or user_file.id
        thread = AgentThread(
            owner_user_id=owner_user_id,
            title=derive_thread_title_from_filename(label),
        )
        db.add(thread)
        db.flush()
        task = ImportTask(
            job_id=job.id,
            thread_id=thread.id,
            source_user_file_id=user_file.id,
            source_sha256=user_file.sha256,
            source_label=label,
            status=ImportTaskStatus.QUEUED,
            sequence_index=index,
        )
        db.add(task)

    job.status = ImportJobStatus.RUNNING
    job.updated_at = utc_now()
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def cancel_import_job(db: Session, *, job: ImportJob) -> ImportJob:
    if job.status in {ImportJobStatus.COMPLETED, ImportJobStatus.CANCELLED}:
        raise PolicyViolation.bad_request("Import job is already finished.")

    now = utc_now()
    for task in job.tasks:
        if task.status == ImportTaskStatus.QUEUED:
            task.status = ImportTaskStatus.CANCELLED
            task.completed_at = now
            task.updated_at = now
            db.add(task)
        elif task.status == ImportTaskStatus.RUNNING:
            task.status = ImportTaskStatus.CANCELLED
            task.error_text = "Cancelled by user."
            task.completed_at = now
            task.updated_at = now
            db.add(task)

    job.status = ImportJobStatus.CANCELLED
    job.completed_at = now
    job.updated_at = now
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def retry_failed_import_tasks(db: Session, *, job: ImportJob) -> ImportJob:
    if job.status == ImportJobStatus.CANCELLED:
        raise PolicyViolation.bad_request("Cancelled import jobs cannot be retried.")

    retried = False
    for task in job.tasks:
        if task.status != ImportTaskStatus.FAILED:
            continue
        task.status = ImportTaskStatus.QUEUED
        task.error_text = None
        task.active_run_id = None
        task.completed_at = None
        task.updated_at = utc_now()
        db.add(task)
        retried = True

    if not retried:
        raise PolicyViolation.bad_request("No failed tasks to retry.")

    job.status = ImportJobStatus.RUNNING
    job.completed_at = None
    job.updated_at = utc_now()
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
