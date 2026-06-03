# Import Workflow API

Base path: `/api/v1/import`

All routes require `Authorization: Bearer <token>`. Jobs and tasks are scoped to the authenticated principal.

## Overview

The import workflow runs multi-file agent imports as durable backend jobs. Each source attachment becomes one `ImportTask` backed by a dedicated `AgentThread`. The backend scheduler dispatches up to `concurrency` tasks at a time using the existing agent run pipeline.

Import threads are hidden from the normal Agent thread list but remain reachable through task drill-down and the standard agent thread/run APIs.

## Preflight

### `POST /import/preflight`

Detect prior imports by file content hash (`sha256`) and suggest per-file actions.

Request body:

```json
{
  "source_attachment_ids": ["<draft-attachment-id>"]
}
```

Response highlights:

- `files[]` with `sha256`, `previously_imported`, `suggested_action` (`import` | `skip`), and `prior_imports[]`
- `prior_imports[]` lists historical jobs/tasks that imported the same bytes

## Jobs

### `POST /import/jobs`

Create and start an import job. Returns `201` with job detail including tasks.

Request body:

```json
{
  "title": "March statements",
  "model_name": "openrouter/...",
  "concurrency": 4,
  "approval_policy": "default",
  "instructions": "Extract expenses from each statement.",
  "source_attachment_ids": ["<draft-attachment-id>"]
}
```

- `concurrency` defaults to the resolved runtime setting `agent_bulk_max_concurrent_threads` (UI label: import concurrent workers).
- `approval_policy`: `default` (review proposals) or `yolo` (auto-apply after successful run).

### `GET /import/jobs`

List the current user's import jobs (newest first) with aggregate progress and cost.

### `GET /import/jobs/{job_id}`

Fetch one job with full task list, per-task run summaries, and aggregate cost totals.

### `POST /import/jobs/{job_id}/cancel`

Cancel a queued or running job. Running agent runs are interrupted through the normal run lifecycle.

### `POST /import/jobs/{job_id}/retry-failed`

Re-queue failed tasks in the same job and restart the in-process scheduler.

## Aggregated proposals

### `GET /import/jobs/{job_id}/proposals`

Return job-level proposal rows aggregated across all task threads. Near-identical proposals collapse by naive signature grouping; `duplicate_count` reports how many task runs raised the same signature.

### `POST /import/jobs/{job_id}/proposals/batch-approve`

Approve and apply selected proposals (or all pending when `change_item_ids` is omitted). Each item is isolated: one failure does not abort the rest.

Optional body:

```json
{
  "change_item_ids": ["<change-item-id>"]
}
```

### `POST /import/jobs/{job_id}/proposals/batch-reject`

Reject selected proposals with the same fault-isolated batch semantics as approve.

## Related behavior

- Task conversations stream through existing agent SSE endpoints (`GET /agent/runs/{run_id}/stream`).
- Agent thread list excludes threads referenced by `import_tasks`.
- Server restart does not auto-resume in-flight jobs; use retry-failed after restart.

## Related docs

- `docs/data_model.md` (`import_jobs`, `import_tasks`)
- `backend/docs/import_workflow.md`
- `frontend/docs/workspaces.md` (Import tab)
