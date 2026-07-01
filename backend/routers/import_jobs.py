# CALLING SPEC:
# - Purpose: translate HTTP requests for import workflow routes.
# - Inputs: authenticated principal and validated import schemas.
# - Outputs: import job/task/preflight/proposal responses.
# - Side effects: delegates orchestration to import workflow services; domain errors propagate as PolicyViolation.
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_import import (
    ImportJobAggregatedProposalRead,
    ImportJobBatchActionBody,
    ImportJobBatchApplyResponse,
    ImportJobCreate,
    ImportJobDetailRead,
    ImportJobSummaryRead,
    ImportPreflightRequest,
    ImportPreflightResponse,
)
from backend.services.import_workflow.jobs import (
    cancel_import_job,
    create_import_job,
    list_import_jobs_for_principal,
    retry_failed_import_tasks,
)
from backend.services.import_workflow.preflight import run_import_preflight
from backend.services.import_workflow.proposals import (
    aggregate_job_proposals,
    batch_approve_job_proposals,
    batch_reject_job_proposals,
)
from backend.services.import_workflow.scheduler import cancel_import_job_scheduler, start_import_job
from backend.services.import_workflow.serializers import job_detail_to_schema, job_summary_to_schema, load_job_for_owner

router = APIRouter(
    prefix="/import",
    tags=["import"],
)


@router.post("/preflight", response_model=ImportPreflightResponse)
def preflight_import_sources(
    payload: ImportPreflightRequest,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportPreflightResponse:
    return run_import_preflight(
        db,
        owner_user_id=principal.user_id,
        source_attachment_ids=payload.source_attachment_ids,
    )


@router.post("/jobs", response_model=ImportJobDetailRead, status_code=status.HTTP_201_CREATED)
def create_job(
    payload: ImportJobCreate,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobDetailRead:
    job = create_import_job(
        db,
        owner_user_id=principal.user_id,
        title=payload.title,
        model_name=payload.model_name,
        concurrency=payload.concurrency,
        approval_policy=payload.approval_policy,
        instructions=payload.instructions,
        source_attachment_ids=payload.source_attachment_ids,
    )
    start_import_job(job.id)
    job = load_job_for_owner(db, job_id=job.id, owner_user_id=principal.user_id)
    return job_detail_to_schema(db, job)


@router.get("/jobs", response_model=list[ImportJobSummaryRead])
def list_jobs(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[ImportJobSummaryRead]:
    jobs = list_import_jobs_for_principal(db, principal=principal)
    return [job_summary_to_schema(db, job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=ImportJobDetailRead)
def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobDetailRead:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return job_detail_to_schema(db, job)


@router.post("/jobs/{job_id}/cancel", response_model=ImportJobDetailRead)
def cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobDetailRead:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    job = cancel_import_job(db, job=job)
    cancel_import_job_scheduler(job_id)
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return job_detail_to_schema(db, job)


@router.post("/jobs/{job_id}/retry-failed", response_model=ImportJobDetailRead)
def retry_failed_tasks(
    job_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobDetailRead:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    job = retry_failed_import_tasks(db, job=job)
    start_import_job(job_id)
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return job_detail_to_schema(db, job)


@router.get("/jobs/{job_id}/proposals", response_model=list[ImportJobAggregatedProposalRead])
def list_job_proposals(
    job_id: str,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[ImportJobAggregatedProposalRead]:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return aggregate_job_proposals(db, job=job)


@router.post("/jobs/{job_id}/proposals/batch-approve", response_model=ImportJobBatchApplyResponse)
def batch_approve_proposals(
    job_id: str,
    payload: ImportJobBatchActionBody | None = None,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobBatchApplyResponse:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return batch_approve_job_proposals(
        db,
        job=job,
        actor=principal.user_name,
        change_item_ids=None if payload is None else payload.change_item_ids,
    )


@router.post("/jobs/{job_id}/proposals/batch-reject", response_model=ImportJobBatchApplyResponse)
def batch_reject_proposals(
    job_id: str,
    payload: ImportJobBatchActionBody | None = None,
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> ImportJobBatchApplyResponse:
    job = load_job_for_owner(db, job_id=job_id, owner_user_id=principal.user_id)
    return batch_reject_job_proposals(
        db,
        job=job,
        actor=principal.user_name,
        change_item_ids=None if payload is None else payload.change_item_ids,
    )
