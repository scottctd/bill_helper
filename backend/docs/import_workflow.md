# Import Workflow

Backend-orchestrated multi-agent import jobs replace the removed Agent composer Bulk mode.

## Ownership

| Layer | Module | Responsibility |
|-------|--------|----------------|
| Router | `backend/routers/import_jobs.py` | HTTP translation for preflight, jobs, proposals |
| Models | `backend/models_import.py`, `backend/enums_import.py` | `ImportJob`, `ImportTask`, status enums |
| Schemas | `backend/schemas_import.py` | Request/response contracts |
| Jobs | `backend/services/import_workflow/jobs.py` | Create, cancel, retry |
| Preflight | `backend/services/import_workflow/preflight.py` | sha256 re-import detection |
| Scheduler | `backend/services/import_workflow/scheduler.py` | In-process worker pool, run completion hook |
| Serializers | `backend/services/import_workflow/serializers.py` | ORM → API schemas, aggregate cost |
| Proposals | `backend/services/import_workflow/proposals.py`, `dedup.py` | Aggregate + fault-isolated batch apply |

## Lifecycle

1. Frontend uploads draft attachments and calls `POST /import/preflight`.
2. `POST /import/jobs` persists one `ImportTask` per attachment, each with its own `AgentThread`.
3. `start_import_job(job_id)` spawns a daemon coordinator thread.
4. The scheduler dispatches up to `job.concurrency` tasks via `create_user_message_and_start_run` + `run_agent_in_background`.
5. `notify_agent_run_terminal(run_id)` in `backend/services/agent/runtime_support/lifecycle.py` updates task/job counters and wakes the coordinator.
6. Proposals are reviewed at job scope through aggregated list + batch approve/reject.

## Concurrency default

When a create request omits `concurrency`, the scheduler uses the resolved runtime setting `agent_bulk_max_concurrent_threads` (settings UI: import concurrent workers).

## Thread visibility

`backend/routers/agent_threads.py` excludes threads referenced in `import_tasks` from the Agent thread list. Import task dialogs reconnect SSE through the standard agent stream endpoint.

## Persistence

Migration `0043_add_import_workflow.py` adds `import_jobs` and `import_tasks`.

Key fields:

- `import_tasks.source_user_file_id`, `source_sha256`, `source_label` — durable source tracking for re-import detection
- `import_tasks.active_run_id` — scheduler bookkeeping for the in-flight run

## Constraints (v1)

- In-process scheduler only; no distributed queue
- Server restart requires manual `retry-failed` for incomplete jobs
- Proposal dedup is naive signature grouping, not fuzzy matching
- Batch apply tolerates duplicate or partial DB outcomes; failures are per-item isolated

## Tests

- `backend/tests/test_import_workflow.py` — preflight, scheduler dispatch, proposal aggregation, batch apply isolation

## Related docs

- `docs/api/import_workflow.md`
- `docs/data_model.md`
- `tasks/2026_05_31-import_multi_agent_workflow.md`
