# CALLING SPEC:
# - Purpose: HTTP request/response schemas for the import workflow API.
# - Inputs: router handlers and frontend API clients.
# - Outputs: Pydantic models for import jobs, tasks, and preflight.
# - Side effects: validation only.
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.enums_agent import AgentApprovalPolicy, AgentRunStatus
from backend.enums_import import ImportJobStatus, ImportPreflightSuggestedAction, ImportTaskStatus


class ImportSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ImportOrmReadSchema(ImportSchema):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class ImportPreflightRequest(ImportSchema):
    source_attachment_ids: list[str] = Field(min_length=1)


class ImportPriorImportRead(ImportSchema):
    job_id: str
    job_title: str | None
    task_id: str
    thread_id: str
    imported_at: datetime
    task_status: ImportTaskStatus
    applied_count: int


class ImportPreflightFileRead(ImportSchema):
    attachment_id: str
    user_file_id: str
    sha256: str | None
    filename: str
    size_bytes: int
    previously_imported: bool
    suggested_action: ImportPreflightSuggestedAction
    prior_imports: list[ImportPriorImportRead]


class ImportPreflightResponse(ImportSchema):
    files: list[ImportPreflightFileRead]


class ImportJobCreate(ImportSchema):
    title: str | None = Field(default=None, max_length=255)
    model_name: str | None = None
    concurrency: int | None = Field(default=None, ge=1, le=16)
    approval_policy: AgentApprovalPolicy = AgentApprovalPolicy.DEFAULT
    instructions: str = ""
    source_attachment_ids: list[str] = Field(min_length=1)


class ImportTaskRunSummaryRead(ImportSchema):
    run_id: str | None = None
    run_status: AgentRunStatus | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_cost_usd: float | None = None


class ImportTaskRead(ImportOrmReadSchema):
    id: str
    job_id: str
    thread_id: str
    source_user_file_id: str | None
    source_sha256: str | None
    source_label: str
    status: ImportTaskStatus
    active_run_id: str | None
    error_text: str | None
    sequence_index: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    latest_run: ImportTaskRunSummaryRead | None = None


class ImportJobSummaryRead(ImportOrmReadSchema):
    id: str
    title: str | None
    status: ImportJobStatus
    model_name: str
    concurrency: int
    approval_policy: AgentApprovalPolicy
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    aggregate_total_cost_usd: float | None = None


class ImportJobDetailRead(ImportJobSummaryRead):
    instructions: str
    tasks: list[ImportTaskRead]


class ImportJobBatchApplyItemResult(ImportSchema):
    change_item_id: str
    status: Literal["applied", "failed"]
    error: str | None = None


class ImportJobBatchActionBody(ImportSchema):
    change_item_ids: list[str] | None = None


class ImportJobBatchApplyResponse(ImportSchema):
    applied_count: int
    failed_count: int
    results: list[ImportJobBatchApplyItemResult]


class ImportJobAggregatedProposalRead(ImportSchema):
    canonical_change_item_id: str
    change_type: str
    status: str
    rationale_text: str
    payload_json: dict
    duplicate_count: int
    source_task_ids: list[str]
    source_task_labels: list[str]
