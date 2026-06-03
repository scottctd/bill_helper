# CALLING SPEC:
# - Purpose: classify uploaded source files for re-import chooser defaults.
# - Inputs: owner user id and draft attachment (`user_file`) ids from preflight requests.
# - Outputs: per-file preflight rows with prior import history and suggested actions.
# - Side effects: read-only DB queries.
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.enums_agent import AgentChangeStatus
from backend.enums_import import ImportPreflightSuggestedAction, ImportTaskStatus
from backend.models_agent import AgentChangeItem, AgentRun
from backend.models_import import ImportJob, ImportTask
from backend.schemas_import import ImportPreflightFileRead, ImportPreflightResponse, ImportPriorImportRead
from backend.services.agent.attachments import load_draft_attachment_user_file
from backend.services.crud_policy import PolicyViolation


def _applied_count_for_thread(db: Session, *, thread_id: str) -> int:
    return int(
        db.scalar(
            select(func.count(AgentChangeItem.id))
            .join(AgentRun, AgentRun.id == AgentChangeItem.run_id)
            .where(
                AgentRun.thread_id == thread_id,
                AgentChangeItem.status == AgentChangeStatus.APPLIED,
            )
        )
        or 0
    )


def _suggested_action_for_prior_tasks(prior_tasks: list[ImportTask], db: Session) -> ImportPreflightSuggestedAction:
    if not prior_tasks:
        return ImportPreflightSuggestedAction.IMPORT
    newest = max(prior_tasks, key=lambda task: task.created_at)
    if newest.status == ImportTaskStatus.COMPLETED:
        applied_count = _applied_count_for_thread(db, thread_id=newest.thread_id)
        if applied_count > 0:
            return ImportPreflightSuggestedAction.SKIP
    return ImportPreflightSuggestedAction.IMPORT


def run_import_preflight(
    db: Session,
    *,
    owner_user_id: str,
    source_attachment_ids: list[str],
) -> ImportPreflightResponse:
    unique_ids = list(dict.fromkeys(source_attachment_ids))
    files: list[ImportPreflightFileRead] = []
    for attachment_id in unique_ids:
        try:
            user_file = load_draft_attachment_user_file(
                db,
                attachment_id=attachment_id,
                owner_user_id=owner_user_id,
            )
        except PolicyViolation as exc:
            raise PolicyViolation(
                detail=f"Attachment {attachment_id}: {exc.detail}",
                status_code=exc.status_code,
            ) from exc

        prior_rows = (
            list(
                db.scalars(
                    select(ImportTask)
                    .join(ImportJob, ImportJob.id == ImportTask.job_id)
                    .where(
                        ImportJob.owner_user_id == owner_user_id,
                        ImportTask.source_sha256 == user_file.sha256,
                    )
                    .order_by(ImportTask.created_at.desc())
                )
            )
            if user_file.sha256
            else []
        )

        prior_imports = [
            ImportPriorImportRead(
                job_id=task.job_id,
                job_title=db.scalar(select(ImportJob.title).where(ImportJob.id == task.job_id)),
                task_id=task.id,
                thread_id=task.thread_id,
                imported_at=task.created_at,
                task_status=task.status,
                applied_count=_applied_count_for_thread(db, thread_id=task.thread_id),
            )
            for task in prior_rows
        ]
        suggested = _suggested_action_for_prior_tasks(prior_rows, db)
        files.append(
            ImportPreflightFileRead(
                attachment_id=attachment_id,
                user_file_id=user_file.id,
                sha256=user_file.sha256,
                filename=user_file.display_name or user_file.original_filename or attachment_id,
                size_bytes=user_file.size_bytes,
                previously_imported=bool(prior_rows),
                suggested_action=suggested,
                prior_imports=prior_imports,
            )
        )
    return ImportPreflightResponse(files=files)
