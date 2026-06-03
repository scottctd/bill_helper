# CALLING SPEC:
# - Purpose: provide import workflow status enums.
# - Inputs: callers that import `backend/enums_import.py`.
# - Outputs: StrEnum values for import jobs and tasks.
# - Side effects: module-local behavior only.
from __future__ import annotations

from enum import StrEnum


class ImportJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ImportTaskStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ImportPreflightSuggestedAction(StrEnum):
    IMPORT = "import"
    SKIP = "skip"
