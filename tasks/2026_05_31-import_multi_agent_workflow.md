# Import Tab: Backend-Orchestrated Multi-Agent Import Workflow

## Status

- Proposed / for discussion
- Supersedes the current frontend-only "Bulk mode" in the Agent composer

## Priority

- High for the import use case (largest token/time sink today)
- Dedup of near-duplicates is explicitly a later phase

## Summary

Promote the agent's "bulk execution" capability out of the Agent composer and into a
dedicated **Import** tab backed by a **backend-orchestrated multi-agent workflow**.

A user starts an **import job** with `M` source items and a configurable worker-pool size
`N` (`M` may be `>> N`). The backend dispatches up to `N` agent conversations concurrently,
draining a queue of `M` tasks as runs complete. **Each import task is one agent conversation**
(an `AgentThread`), so every task gets the existing message/run/event/tool-call/proposal and
SSE-streaming machinery for free.

The Import frontend is clean but information-dense: per-job progress, aggregate cost, and a
per-task status grid. Clicking any task opens a **popup that replays that task's conversation
with live streaming**, reusing the Agent page's timeline. Proposals are **aggregated across all
tasks in the job** into a single review surface, with **naive identifier-based dedup** so an
identical proposal raised by multiple agents collapses to one row.

## Motivation

1. **Reliability.** Today bulk dispatch runs in the browser (`mapWithConcurrency` in
   `frontend/src/features/agent/panel/useAgentComposerActions.ts`). Closing the tab halts
   dispatch, there is no durable job record, no retry, and no resume. A real import of `M >> N`
   items needs a server-side queue and worker pool.
2. **Clarity.** Bulk threads currently pollute the normal Agent thread list with no grouping.
   An import is a distinct workflow with its own progress, cost, and review lifecycle.
3. **Cost visibility.** Imports are the most expensive agent activity. The job needs first-class
   aggregate cost/token reporting and per-task drill-down.
4. **Review at scale.** Reviewing `M` separate per-thread proposal modals is unworkable. We need
   one aggregated, deduplicated review surface per job.

## Non-Goals (this task)

- **Data consistency / a clean entity graph after bulk approval.** Duplicate, partial, or
  inconsistent DB rows are acceptable (user decision). A later manual agent session reconciles
  them. The only hard guarantee is that bulk approval is crash-safe and fault-isolated — see
  "Batch apply must be crash-safe".
- Fuzzy / near-duplicate detection across semantically similar (but not identical) proposals.
  See "Known caveat: near-duplicates" and "Future directions".
- A per-user code-execution sandbox / filesystem (Docker was removed; too heavy). See
  "Future directions: reusable import recipes".
- Distributed / multi-process job execution. In-process background scheduling is acceptable for
  this prototype (consistent with current daemon-thread run execution).
- Chunking a single large file into many tasks (row-range sharding). v1 task granularity is
  one source item per task. See "Future directions".

## Current State (what we are replacing)

| Concern | Today | After this task |
|---------|-------|-----------------|
| Bulk trigger | `Bulk` toggle in `AgentComposer.tsx` | Removed; lives in Import tab |
| Dispatch | Browser `mapWithConcurrency`, non-stream sends | Backend `ImportJobScheduler` worker pool |
| Grouping | None (N loose threads) | `ImportJob` owns `ImportTask`s (1 task = 1 thread) |
| Concurrency setting | `agent_bulk_max_concurrent_threads` (default 4) | Generalized to import concurrency + per-job override |
| Proposal review | Per-thread `AgentThreadReviewModal` | Job-level aggregated + deduped review |
| Durability | None | `ImportJob`/`ImportTask` persisted; resumable/retryable |

Per `AGENTS.md` ("prototype: prefer simplification and replacement over compatibility shims"),
the frontend bulk path is **removed**, not kept in parallel:

- Remove `isBulkMode` / bulk switch from `AgentComposer.tsx`.
- Remove `handleSubmitBulkMessages` and bulk-only helpers
  (`mapWithConcurrency`, `deriveThreadTitleFromFilename`, `summarizeFilenames`,
  `buildThreadSummary` if unused elsewhere) from the composer modules.
- Migrate the `agent_bulk_max_concurrent_threads` runtime setting to an import concurrency
  setting (`config.py`, `services/runtime_settings.py`, `models_settings.py`).

## Proposed Architecture

### Domain model (new)

Two new tables; per-task work reuses the existing agent tables.

**`import_jobs`**

- `id` (uuid)
- `owner_user_id` (FK users)
- `title` (str, optional; default derived from source set)
- `status` enum: `queued | running | paused | completed | failed | cancelled`
- `model_name` (str)
- `concurrency` (int, 1..N max)
- `approval_policy` enum: reuse `AgentApprovalPolicy` (default `default` = review-required)
- `instructions` (text) — the shared prompt/instructions applied to every task
- `total_tasks`, `completed_tasks`, `failed_tasks` (int counters; denormalized for cheap reads)
- `created_at`, `updated_at`, `completed_at`

**`import_tasks`**

- `id` (uuid)
- `job_id` (FK import_jobs, cascade)
- `thread_id` (FK agent_threads, cascade) — the conversation for this task
- `source_user_file_id` (FK user_files, nullable) — the saved copy of the source file
- `source_sha256` (str(64), indexed) — denormalized content hash for fast re-import detection
- `source_label` (str) — the original filename, for the grid
- `status` enum: `queued | running | completed | failed | cancelled`
- `error_text` (text, nullable)
- `sequence_index` (int) — stable ordering in the grid
- `created_at`, `updated_at`, `completed_at`

**Association on `agent_threads`** (so import threads don't clutter the Agent page):

- Add nullable `agent_threads.import_task_id` (or filter the Agent list by "thread has an
  `import_tasks` row"). Decision: prefer the `import_tasks.thread_id` join + an index, and
  filter `_thread_summary_rows` in `backend/routers/agent_threads.py` to exclude
  import-owned threads. Avoids a new column; keeps ownership in the import subsystem.

Migration: one Alembic revision adding `import_jobs` + `import_tasks` (+ indexes on
`import_tasks.job_id`, `import_tasks.thread_id`, `import_tasks.source_sha256`).

### Import source persistence + re-import detection

**Goal.** Every import source file is saved per task, and when a user later attaches the same
file again, they can choose — per file or in bulk — to **re-import** (e.g. to add items missed
the first time) or **skip** it.

**Storage is already solved by the existing infra — reuse, do not rebuild:**

- `UserFile.sha256` exists (`backend/models_files.py`).
- `store_user_file_bytes` (`backend/services/user_files.py`) is **content-addressed**: identical
  bytes return the existing `UserFile` row rather than writing a duplicate copy, and
  `find_user_file_by_sha256` looks rows up by hash.
- Draft attachments are persisted as `UserFile` rows **at upload time** (the "attachment id" the
  frontend holds is the `user_file.id`, sha256 already computed — see
  `routers/agent_attachments.py` → `ingest_draft_attachment_upload`).

So "save a copy for each import thread" needs no new file storage. Each `import_task` records
`source_user_file_id` + `source_sha256` (denormalized from the source `UserFile`).

**Re-import detection (content-hash identity).** Identity is the **sha256**, not the filename —
so a renamed-but-identical file is still detected, and a same-named-but-changed file is treated
as new. Given a set of attachment ids (= `user_file` ids, hashes known), find prior `import_tasks`
for the same owner whose `source_sha256` is in the set (join `import_tasks` → `import_jobs` on
`owner_user_id`). For each prior match, return: job id/title, `imported_at`, prior task status,
and `applied_count` (count of `AgentChangeItem` with status `APPLIED` on that task's thread).

**Suggested default action per file** (the UI pre-selects, user can override):

- Not previously imported → **Import**.
- Previously imported and that task **completed with `applied_count > 0`** → **Skip**.
- Previously attempted but **failed / nothing applied** → **Import** (re-attempt).

This is detection + a smart default only; the user always has the final say. It does not block
re-importing — re-import is a first-class supported action (duplicate DB rows are acceptable per
the robustness decision above).

### Backend orchestration (new)

A thin scheduler that drains the task queue, capped at the job's concurrency, reusing the
existing single-run execution path (`services/agent/execution.py` +
`services/agent/runtime.py:run_agent_in_background`).

- `backend/services/import_workflow/scheduler.py` — `ImportJobScheduler`
  - In-process registry of active jobs; per-job `asyncio`/thread semaphore of size `concurrency`.
  - On job start: create `M` `import_tasks` (each with its `AgentThread`), enqueue them.
  - Worker loop: while pending tasks and capacity, pop next task, create the user message +
    run (`create_user_message_and_start_run`), start it in the background, mark task `running`.
  - On run completion (hook into run lifecycle / poll run status), mark task
    `completed`/`failed`, update job counters, release capacity, pull next task.
  - Job completes when all tasks are terminal. Persist counters throughout.
- `backend/services/import_workflow/jobs.py` — pure-ish CRUD/state transitions on
  `ImportJob`/`ImportTask` (create job, list, get, cancel, retry-failed). Keep deterministic
  state logic here; keep the scheduler a slim orchestrator (per `AGENTS.md` decomposition rules).
- Durability note: on server restart, jobs in `running` with non-terminal tasks are left
  interrupted. v1: surface them as `failed`/`paused` and offer "retry failed tasks". Full
  auto-resume is a follow-up.

Each task's prompt = job `instructions` + the task's source attachment(s), sent exactly like a
normal agent message (so vision/PDF handling, `run_bh` tool, and proposals all work unchanged).

### Cost & live streaming (reuse)

- **Cost.** Reuse `services/agent/pricing.py` + `serializers.run_usage_snapshot_for_stream`.
  Job aggregate cost/tokens = sum over the job's runs. Expose on job detail and stream it live
  (each task run already emits usage snapshots via the stream hub).
- **Live per-task conversation.** Reuse the SSE reconnect endpoint
  `GET /api/v1/agent/runs/{run_id}/stream?after_sequence=N` and the frontend
  `AgentTimeline` + `useAgentStreamReconnect`. The task popup is essentially the Agent page's
  thread view scoped to one thread, read-only-ish (no composer needed for v1).

### API (new router: `backend/routers/import_jobs.py`)

Routers own HTTP translation only; logic in `services/import_workflow/*`.

- `POST /api/v1/import/preflight` — body `{ source_attachment_ids: string[] }` (the
  draft-attachment / `user_file` ids the frontend already uploaded). Returns per-file:
  `{ attachment_id, user_file_id, sha256, filename, size_bytes, previously_imported: bool,
  suggested_action: "import" | "skip", prior_imports: [{ job_id, job_title, task_id, imported_at,
  task_status, applied_count }] }`. Powers the re-import chooser; read-only.
- `POST /api/v1/import/jobs` — create + start a job. Body: `{ title?, model_name?, concurrency?,
  approval_policy?, instructions, source_attachment_ids: string[] }` — the frontend passes only
  the files the user chose to **import** (skipped files are simply omitted). Reuses the existing
  draft attachment upload flow (`POST /api/v1/agent/draft-attachments`) so the frontend uploads
  first, then references ids.
- `GET /api/v1/import/jobs` — list jobs for the user (status, counts, aggregate cost).
- `GET /api/v1/import/jobs/{job_id}` — job detail: config, per-task status grid (with each task's
  `thread_id` + latest `run_id` + run status + cost).
- `POST /api/v1/import/jobs/{job_id}/cancel` — cancel queued/running tasks.
- `POST /api/v1/import/jobs/{job_id}/retry-failed` — re-enqueue failed tasks.
- `GET /api/v1/import/jobs/{job_id}/proposals` — **aggregated + deduped** pending proposals across
  all tasks (see below).
- `POST /api/v1/import/jobs/{job_id}/proposals/batch-approve` /
  `.../batch-reject` — operate on the deduped/aggregated set.

Per-task live streaming reuses existing `GET /api/v1/agent/runs/{run_id}/stream`.

### Aggregated proposals + naive dedup

**Guiding principle (per user decision): data consistency is NOT a goal; robustness is.**
Duplicate, partial, or otherwise "ugly" data in the DB after a bulk approval is acceptable —
a later manual agent session can reconcile inconsistencies. The one hard requirement is that
**approving a bulk of aggregated proposals must never crash the server or abort the whole batch**;
it must apply best-effort and isolate per-item failures.

Proposals remain `AgentChangeItem` rows on each task's run. The job proposal endpoint:

1. **Collect** all `AgentChangeItem`s for runs whose `thread_id`s belong to the job.
2. **Compute a deterministic dedup signature** per `change_type` (best-effort grouping only):
   - `create_entry`: normalized `(entry_type, date, amount, currency, from_entity, to_entity, memo?)`.
   - `create_entity` / `create_account`: `normalize_entity_name(name)` (+ type) — reuse
     `backend/validation/finance_names.py` and the existing
     `normalized_pending_create_entity_root_names` logic.
   - `create_tag`: normalized tag name.
   - `create_group`: normalized name + group type.
   - updates/deletes: `(change_type, applied_resource_type, applied_resource_id, payload-hash)`.
3. **Group by `(change_type, signature)`**; keep one **canonical** item, attach
   `duplicate_count` + the source task list. Present the canonical row once in review. Sibling
   duplicates resolve to `REJECTED` (note: "merged duplicate") when the canonical is approved.

### Batch apply must be crash-safe (the actual hard requirement)

This replaces the previous "apply idempotently / cross-thread dependency" complexity. We do
**not** need perfect idempotency or to rewrite cross-thread references. We accept duplicate
entities/entries in the DB. What we must guarantee:

- **Per-item fault isolation.** The batch-approve handler applies each canonical item in its own
  unit of work. A failure (validation error, missing dependency, unique-constraint clash,
  unexpected exception) marks that item `APPLY_FAILED` with the error text and **continues** with
  the rest. One bad item never 500s the request or rolls back successfully-applied siblings.
- **No unhandled exceptions escape to a 500.** The endpoint returns a structured per-item result
  summary (`applied`, `failed` with reasons), not an all-or-nothing transaction.
- **Bounded work.** Apply in chunks so a huge batch can't exhaust a single transaction/timeout;
  stream/paginate progress if needed.
- **Reuse the existing apply dispatch** (`backend/services/agent/apply/dispatch.py`) per item,
  but wrap each call in isolation + contextual logging (per `AGENTS.md`: no silent broad
  `except`; log scope + context on the recoverable per-item fallback).

Cross-thread references that dangle after dedup (e.g. thread B's entry pointed at a catalog root
proposal that was collapsed) are allowed to fail that single entry's apply → `APPLY_FAILED`. That
is acceptable: the user can re-run a manual agent session to fix leftovers. Tests focus on
**fault isolation and crash-safety**, not on producing a clean graph.

### Known caveat: near-duplicates (out of scope)

When sources themselves contain duplicate/near-duplicate items, parallel agents will raise
proposals that are *similar but not byte-identical* (e.g. "Costco" vs "Costco Wholesale", or the
same charge with a 1-cent rounding difference). Naive exact-signature dedup will NOT catch these.
Documented as a known limitation; fuzzy matching is a future phase.

### Frontend: Import tab

New route + nav (`frontend/src/App.tsx`, `frontend/src/lib/appNavigation.ts`,
`frontend/src/components/Sidebar.tsx`, `RoutePageTitle.tsx`), page under
`frontend/src/pages/ImportPage.tsx`, feature modules under `frontend/src/features/import/`.

- **Create-job panel** (meticulously designed; this is the centerpiece of the UX):
  - **Attach step**: multi-select / drag-drop (files only for v1). Each file uploads via the
    existing draft-attachment flow with a per-file progress indicator; content-hash dedupe means
    re-dropping the same file is a no-op (surface a subtle "already added" hint).
  - **Re-import chooser**: once uploads finish, call `POST /import/preflight` and render a
    reviewable file list. Each row shows a file-type icon, filename, size, and a **status badge**:
    - `New` — calm/positive treatment.
    - `Imported {relativeTime}` — amber/neutral; expandable to show prior job title, date, task
      status, `applied_count`, and a **"View previous run"** action that opens that prior task's
      conversation popup (reuses the same `AgentTimeline` popup).
    - `Attempted {relativeTime}` — for prior failed/no-applied imports; nudges toward re-import.
  - Each row has a compact **Import / Skip** segmented control, pre-set to `suggested_action`,
    fully overridable. Rows animate (skip = de-emphasized/struck) so the active set is obvious.
  - **Bulk controls** in a sticky summary bar: live counts
    (`12 files · 8 new · 4 previously imported · importing 8`) plus actions
    **"Import all"**, **"Skip previously imported"**, and **"Reset to suggested"**.
  - **Config row**: model, concurrency `N`, approval policy, shared instructions. `yolo` is an
    explicit opt-in with a dedup-risk warning.
  - **Primary CTA** reflects the live selection: **"Start import (8 files)"**, disabled at 0
    selected. Only `Import`-marked files become tasks.
  - Polish bar (per `frontend-ui-builder`): skeleton while preflight runs, empty/error states,
    keyboard navigation, focus rings, and `prefers-reduced-motion` fallbacks for all animations.
- **Job list**: status, progress (`completed/failed` of `total`), aggregate cost, created time.
- **Job detail**:
  - Header: status, live progress bar, aggregate cost/tokens (live via stream/poll), controls
    (cancel, retry failed, open aggregated review).
  - **Task grid**: one row/cell per task — source label, status chip, per-task cost, spinner when
    running. Click → **task conversation popup**.
  - **Task conversation popup** (`Dialog`): reuses `AgentTimeline` + `useAgentStreamReconnect`
    to replay and live-stream that task's thread. Clean, scrollable, with the task's cost/usage
    bar (`AgentThreadUsageBar`).
  - **Aggregated review**: extend/parameterize `AgentThreadReviewModal` (or a new
    `ImportJobReviewModal` reusing the review editors) to operate on the job's deduped proposal
    set, showing `duplicate_count` and source tasks per row, with batch approve/reject.

Design intent: information-dense but calm — progress + cost up top, a scannable task grid, and
drill-down only on demand. Follow the `frontend-ui-builder` skill for the page/overlay work.

## Phasing

**Phase 1 — Backend job + scheduler + source persistence (no dedup):**
- `import_jobs` / `import_tasks` tables (incl. `source_user_file_id` / `source_sha256`) + migration.
- `ImportJobScheduler` + `jobs.py` state logic; reuse existing run execution.
- Re-import detection: `POST /import/preflight` + the sha256 history lookup (reuse
  `find_user_file_by_sha256`; query prior `import_tasks` by `source_sha256`).
- API: preflight/create/list/get/cancel/retry; filter import threads out of the Agent list.
- Tests: job lifecycle, concurrency cap, counters, cancel/retry, re-import detection by hash
  (renamed-identical = detected; changed-same-name = new).

**Phase 2 — Frontend Import tab:**
- Route/nav, create-job panel with the **re-import chooser** (status badges, per-row Import/Skip,
  bulk Import-all / Skip-previously-imported / Reset-to-suggested, live selection summary).
- Job list, job detail with task grid.
- Task conversation popup reusing `AgentTimeline` + stream reconnect (also reused by the chooser's
  "View previous run").
- Aggregate + live cost display.

**Phase 3 — Aggregated proposals + naive dedup + crash-safe apply:**
- Job proposal aggregation endpoint with `(change_type, signature)` grouping + duplicate
  auto-resolution.
- **Crash-safe, per-item-isolated batch apply** (the priority): each item in its own unit of
  work, failures marked `APPLY_FAILED` and skipped, structured result summary, no 500s.
- Job-level review modal.
- Tests: dedup grouping, and especially fault isolation / crash-safety (bad item, dangling
  cross-thread ref, unique-constraint clash → batch still completes).

**Phase 4 — Remove legacy bulk mode:**
- Strip `Bulk` toggle and bulk dispatch from the composer; migrate the concurrency setting;
  update agent docs.

## Resolved Decisions (v1)

1. **Task granularity.** `M` = number of uploaded source files; **one file = one task**.
   File-splitting (row-range sharding of a large CSV) is deferred to a later phase.
2. **Approval policy.** **Review-required by default** (`AgentApprovalPolicy.default`, proposals
   stay pending). `yolo` auto-apply is allowed as an explicit per-job opt-in, surfaced with a
   warning about dedup risk at scale.
3. **Dedup scope + robustness over consistency.** **Naive only**: review-time grouping of
   byte-identical proposals by `(change_type, signature)`. Data consistency is **not** a goal —
   duplicate/inconsistent DB rows are acceptable and a later manual agent session reconciles them.
   The hard guarantee is that bulk approval is **crash-safe and per-item fault-isolated** (one bad
   item never aborts the batch or 500s the server). Entry-level dedup and fuzzy near-duplicate
   detection are explicitly deferred.
4. **Restart behavior.** On server restart, mark interrupted jobs `paused`/`failed` and offer
   manual **"retry failed"**. Auto-resume on boot is deferred.
5. **Source input.** **Files only** for v1 (multi-select / drag). Pasted text blocks / text-item
   lists are deferred.
6. **Re-import identity + persistence.** Each task's source file is saved (reusing the existing
   content-addressed `user_files` storage; no new copy mechanism). Re-import detection keys on
   **sha256**, not filename. On re-attach, the user chooses **re-import** or **skip** per file,
   with bulk **Import-all** / **Skip-previously-imported** controls and smart suggested defaults.
   Re-import is always allowed (never blocked).

## Future Directions (keep in mind; not this task)

### Reusable import recipes (lightweight alternative to a sandbox)

The goal you described — let the agent build a reusable, user-specific importer for a known CSV
type so it doesn't re-reason every time — does not require Docker or arbitrary code execution.
Recommended lightweight path:

- Store a **declarative import recipe** per source type: column→field mapping, value transforms
  (date/amount parsing, sign conventions), and a dedup-key definition. A deterministic backend
  importer applies the recipe; the agent only authors/edits the recipe and spot-checks results.
- This captures most token/time savings (the agent stops re-deriving the mapping) while keeping
  execution deterministic and safe — no per-user filesystem needed.
- If real code execution is later required, prefer a constrained, ephemeral evaluator
  (restricted Python / subprocess with no network and a tight allowlist) over reviving the
  per-user Docker workspace. Treat that as a separate ADR.

### Near-duplicate detection

Fuzzy matching across tasks (normalized-string similarity for entities/tags, tolerance-based
matching for entries) as a dedicated dedup phase, surfaced as "possible duplicate" review hints
rather than automatic collapsing.

### Auto-resume on restart

Persist enough scheduler state to re-enqueue non-terminal tasks on boot.

## Affected Files (anticipated)

Backend:
- `backend/models_*` (+ new `backend/models_import.py`), Alembic migration
- `backend/enums_*` (+ import status enums)
- `backend/services/import_workflow/{scheduler,jobs}.py` (+ a `preflight.py` for re-import
  detection, or fold into `jobs.py` if small)
- `backend/services/user_files.py` (reuse `find_user_file_by_sha256`; no changes expected)
- `backend/routers/import_jobs.py` (+ register in `backend/routers/agent.py`/app)
- `backend/routers/agent_threads.py` (exclude import threads from `_thread_summary_rows`)
- `backend/services/agent/proposals/*` + `reviews/*` (job aggregation + crash-safe per-item apply)
- `backend/config.py`, `services/runtime_settings.py`, `models_settings.py` (concurrency setting)

Frontend:
- `frontend/src/App.tsx`, `lib/appNavigation.ts`, `components/Sidebar.tsx`,
  `components/layout/RoutePageTitle.tsx`
- `frontend/src/pages/ImportPage.tsx`
- `frontend/src/features/import/*` (create panel, job list, job detail, task grid, task popup,
  job review modal)
- `frontend/src/lib/api/*` + `lib/types/*` (import job types/endpoints)
- Remove bulk paths from `frontend/src/features/agent/panel/{AgentComposer,useAgentComposerActions,helpers}.tsx/ts`

## Documentation Impact (per AGENTS.md)

- New API docs: `docs/api/` import routes + update `docs/api.md` route-family map.
- Data model: `docs/data_model.md`, `docs/backend_index.md`, `docs/repository_structure.md`
  (new tables/files/migration).
- Backend subsystem doc: new `backend/docs/import_workflow.md`; update
  `backend/docs/agent_subsystem.md` (bulk removed; import threads).
- Frontend docs: `frontend/docs/app_shell_and_routing.md` (new route), new import page doc;
  update the composer doc (bulk removed).
- Features: `docs/features/*` import workflow page.
- ADR: add an ADR for backend-orchestrated multi-agent imports (and one for the deferred
  recipe/sandbox decision if pursued).
- Run `uv run python scripts/check_docs_sync.py` and the architecture gates in `AGENTS.md`.

## Acceptance Criteria

- A user can start an import job with `M` sources and concurrency `N`; the backend runs at most
  `N` task conversations at once and drains all `M`, surviving a browser close.
- Job + task state persists; jobs can be cancelled and failed tasks retried.
- The Import tab shows live progress and aggregate cost, with a task grid.
- Clicking a task opens a popup that live-streams and replays that task's conversation.
- Each task's source file is saved; re-attaching a previously-imported file (by content hash,
  even if renamed) is detected and surfaced in the create-job chooser with a suggested default.
- The user can choose re-import or skip per file, and use bulk "Import all" /
  "Skip previously imported"; only files marked Import become tasks.
- "View previous run" from a previously-imported file opens that prior task's conversation popup.
- Proposals across all tasks are aggregated into one review surface; identical proposals collapse
  to a single deduped row with a duplicate count.
- **Approving a bulk of proposals never crashes the server or aborts the batch.** Each item
  applies in isolation; failures (dangling cross-thread refs, constraint clashes, validation
  errors) are marked `APPLY_FAILED` and skipped, and the endpoint returns a structured
  applied/failed summary. Resulting duplicate/inconsistent DB rows are acceptable.
- The legacy Bulk toggle is removed from the Agent composer.
- All `AGENTS.md` verification gates pass.
