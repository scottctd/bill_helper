# Architecture

## Goal

Bill Helper is a local-first personal finance ledger with AI-assisted, review-gated append-only change proposals.

## Runtime Topology

- Frontend SPA: React + TypeScript + Vite (`http://localhost:5173`)
- Backend API: FastAPI (`http://localhost:8000`)
- Database: SQLite (`{data_dir}/bill_helper.db`, default `~/.local/share/bill_helper/`)
- Canonical user file storage: local filesystem under `{data_dir}/user_files/{user_id}/uploads`

## High-Level Components

- `frontend`: UI pages, agent panel, API calls, cache orchestration
- `backend/routers`: HTTP endpoint layer
- `backend/services`: domain logic, canonical file storage, and agent runtime/review logic
- `backend/models_finance.py` + `backend/models_agent.py` + `backend/models_files.py`: SQLAlchemy ORM tables
- `alembic`: schema migrations

## Core Decisions

- migration-first DB lifecycle via Alembic
- integer minor-unit money representation
- unified groups with `manual` or `rule` source and flat many-to-many membership
- `Entity` is the root identity model; `Account` is a shared-primary-key subtype table (`accounts.id == entities.id`)
- account semantics are determined by subtype membership in `accounts`, not by `entities.category`
- soft-delete entries with direct group-membership cleanup
- AI boundary is append-only proposal creation plus explicit human review apply/reject
- direct API deletes and agent-applied deletes use the same canonical semantics for tag/entity/account removal
- durable user-visible files are canonicalized into a per-user registry before higher-level agent attachment linkage
- user creation/bootstrap eagerly provisions the per-user upload root under `{data_dir}/user_files/{user_id}/uploads`

## Backend Layering

- routers: request validation + status mapping
- services: normalization, calculations, group membership resolution, agent orchestration
- models: persistence structure and relationships in `models_finance.py` and `models_agent.py`
- schemas: API contracts in `schemas_finance.py` and `schemas_agent.py`
- app bootstrap: explicit `create_app()` factory (uvicorn factory mode), avoiding import-time initialization side effects

## Agent Architecture

Execution is harness-first: `AgentHarness` owns the bounded tool-calling loop, canonical transcript commits, step boundaries, and harness event publication. HTTP and background callers go through `production_runtime.py`, which composes the harness with SQLAlchemy persistence, LiteLLM model gateways, production tool execution, and stream fan-out.

## Run Lifecycle

1. user sends a turn to `/api/v1/agent/threads/{thread_id}/messages` (background) or `/api/v1/agent/threads/{thread_id}/messages/stream` (SSE)
2. `execution.py` builds the new-turn `initial_transcript` from prior canonical transcript rows plus the fresh user message and attachments
3. `SqlAlchemyRunRepository` creates an `agent_runs` row (`running`) with a monotonic `turn_index` and seeds `agent_transcript_messages`
4. `AgentHarness.run` / `resume` loops model steps until the assistant finishes without tool requests, hits `max_steps`, is interrupted, or fails
5. each committed model step persists an `agent_steps` row, assistant/tool transcript rows, `agent_tool_calls`, and ordered `agent_run_events`
6. `bh` proposal commands create `agent_change_items` (`PENDING_REVIEW`)
7. stream paths emit ephemeral `model_delta` SSE events plus durable harness events (`tool_started`, `tool_finished`, `step_committed`, `run_finished`, ...)
8. terminal runs set `final_transcript_message_id`, usage counters, and a terminal `AgentRunStatus` (`completed`, `interrupted`, `max_steps`, or `failed`)

## Review Boundary

- agent runtime cannot directly write `entries`, `tags`, `entities`
- only review endpoints apply domain mutations
- review is strictly per item (`approve` / `reject`)
- apply writes audit action rows (`agent_review_actions`)
- approved entry proposals create `entries` rows directly (no entry-level status column)

## Tooling Model (Current)

Model-visible tools:

- `run_bh`
- `rename_thread`
- `add_user_memory`

Execution model:

- `run_bh` executes the local Bill Helper CLI module in a hosted subprocess
- the subprocess receives injected backend/auth/session/thread/run env per invocation
- Bill Helper app-state reads and proposal/review actions go through the installed `bh` CLI
- local file and shell work belongs to external agents on their own machines, not the hosted `run_bh` tool

Contract notes:

- the model-visible tool catalog is intentionally small; app operations should prefer `bh` over raw `curl` or ad hoc Python when a command exists
- proposal lifecycle remains review-gated even though the agent now reaches it through CLI commands instead of direct proposal tools
- thread-scoped proposal commands require the active thread and run context so proposal history stays attached to the invoking run

## Agent Internal Boundaries (Harness-First)

- `harness/`: product-native coordinator (`AgentHarness`), contracts, transcript helpers, step executor, and `EventSink` / `RunRepository` protocols
- `production_runtime.py`: composition root — wires DB repository (`TerminalObservingRunRepository`), model gateway, tools, stop signal, SSE fan-out via `stream_hub.register_run_executor()`, and `RunObserver` hooks from `run_observers.py`
- `production_repository.py`: SQLAlchemy `RunRepository` persistence only (transcript, steps, tool calls, harness events)
- `run_observers.py`: production `RunObserver` registrations (YOLO auto-approve, import scheduler wake, run_finished SSE on interrupt/worker failure) plus `fail_run_terminally`
- `production_events.py`: map harness events to client SSE payloads; tool display enrichment via `DbEventSink` (not the harness)
- `model_gateway.py`: LiteLLM completion adapters (streaming emits `ModelDeltaEvent` into the harness event sink)
- `prompt_assembly/`: per-turn model context pipeline (`__init__.py` entry points, `prompts.py`, `thread_context.py`, `message_history_content.py`, `message_history_prefixes.py`, `user_context.py`); Jinja templates remain in the parent `agent/` directory
- `cli_reference/`: shared `bh` command specs and cheat-sheet renderers (replaces former `backend/cli/reference.py`)
- `api_projection.py`: derive API `turns` and thread-detail read models from transcript rows plus per-run work records
- `execution.py`: HTTP/background intake for user turns and harness run startup
- `runtime.py`: public facade over harness execution plus stable model-call monkeypatch seams (`call_model`, `call_model_stream`, `calculate_context_tokens`)
- `stream_hub.py`: in-process single-worker SSE hub with reconnect replay over persisted harness events and ephemeral `model_delta` buffers
- `stream_sequences.py`: hub sequence numbers, ephemeral buffer bookkeeping, fan-out drop policy, reconnect dedupe
- `tools_for_model_request.py`: single gate (`expose_tools_for_model_request`) for per-request tool schema exposure
- `change_registry.py` + `change_summaries.py`: one `ChangeTypeSpec` per `AgentChangeType`; all proposal/review surfaces derive from the registry
- `attachment_content.py`: public attachment-content seam plus vision capability checks
- `agent_attachment_bundle.py`: dated agent upload bundle layout, PDF page rendering, and dedupe helpers
- `attachment_content_assembly.py`: attachment part assembly helpers (includes pre-2026 Docling-era `parsed.md` read path for historical bundles)
- `model_client_support/`: grouped environment, streaming, usage-normalization, and retrying client internals
- `tool_runtime_support/`: grouped tool metadata, schema-building, family registries, and retry/error policy
- `apply/`: change-type apply package for review-time resource application
- `reviews/`: approval/rejection transitions, dependency checks, override normalization, and audit writes
- `benchmark_interface.py`: benchmark-facing case execution contract returning normalized predictions/trace payloads

## Frontend State Strategy

Remote state:

- TanStack Query for all API domains

Agent state:

- thread list query
- selected-thread detail query
- message send + approve/reject mutations
- optimistic user/assistant message placeholders while runs are in-flight
- pure SSE reducer in `streamReducer.ts` with module store in `agentStreamSession.ts` (`useSyncExternalStore`)
- panel-level UI split:
  - render shell: `frontend/src/features/agent/AgentPanel.tsx`
  - controller/presentation modules: `frontend/src/features/agent/panel/*`
  - run rendering/derivation: `frontend/src/features/agent/AgentRunBlock.tsx`, `frontend/src/features/agent/activity.ts`
  - feature-owned location keeps agent UI beside its tests/review/timeline helpers instead of under generic shared components

Cross-page consistency:

- approving change items invalidates ledger queries (`entries`, `tags`, `entities`, `users`, `dashboard`, `currencies`)
- deleting an account/entity preserves denormalized entry labels and surfaces missing-entity markers instead of erasing history text

## Data Flow Summary

### Standard ledger writes

1. page form submits JSON
2. router validates
3. service mutates models
4. commit + response
5. frontend cache invalidation

### Agent-assisted writes

1. user prompts agent
2. runtime gathers context via `run_bh` commands and records traces
3. runtime creates proposal item(s) only
4. reviewer approves/rejects each item
5. apply service creates resource transactionally
6. UI refreshes across existing pages

## Security / Scope (Current)

- password-backed bearer sessions gate the web app and API
- owner-scoped finance and agent reads reuse the same principal visibility rules
- agent threads are user-owned instead of admin-global; admins can still access everything or impersonate a user
- review apply uses the approving reviewer principal for scoped entry resolution and owner attribution, not mutable runtime settings identity
- image, PDF, and plain-text attachments are accepted in agent messages; images and PDFs require a vision-capable model, while plain-text attachments are inlined as file content
- active agent runs execute Bill Helper app operations through `run_bh`; external file work stays outside the app

## Out of Scope (Current)

- bank sync / CSV ingestion
- autonomous background agent runs
- non-LiteLLM model client implementations

## Deferred / Roadmap

- Live bank sync and generalized multi-bank CSV ingestion workflows
- Finer-grained RBAC beyond the current admin/non-admin split
- Native-client and mobile login UX beyond bearer-token configuration
- FX conversion to a configurable base currency
- Autonomous background agent runs (scheduled or event-driven)
