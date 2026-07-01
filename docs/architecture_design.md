# Architecture Design (Backend + Frontend)

This is the normative design baseline for all backend and frontend development in this
repository. `docs/llm_oriented_design.md` defines the generic code-shape rules (file size,
calling specs, registries, pure tools); this document defines the repo-specific
architecture: which layers exist, what each layer owns, and the exact recipe to follow for
each kind of change.

How to use this doc:

- Before building or changing anything, find the matching recipe in section 6 and follow
  it literally. The recipes are checklists, not suggestions.
- If no recipe fits, follow the layer ownership rules (sections 3-5) and the decision
  table (section 8). If those don't answer it, the change is architectural — write it up
  before coding.
- The anti-pattern list (section 7) is a hard "never do" list.

This document describes the current binding architecture. The 2026-07-01 backend/frontend
refactor (`docs/completed_tasks/2026_07_01-backend_frontend_refactor.md`) converged the
codebase onto these rules; treat any drift as a bug.

---

## 1. Design principles (the "why")

1. **One source of truth per concept.** A payload shape, an enum, a policy, or a label
   map is defined in exactly one place; everything else derives from it (inheritance,
   registry lookup, or code generation). Rationale: a maintainer — especially an LLM —
   updates the copy they can see and misses the ones they can't. Duplication converts
   every change into a scavenger hunt with silent-failure endings.
2. **One canonical pipeline per mutation.** Every way of creating/updating a domain row
   (HTTP, agent proposal apply, import, seed script) converges on the same service
   function. Rationale: divergent pipelines produce rows that behave differently
   depending on provenance, and the divergence is invisible until it corrupts data.
3. **Registries over scattered wiring.** When a family of variants shares an interface
   (proposal types, tools, invalidation rules), membership is declared in one dict/spec
   table, and a completeness test asserts nothing is missing. Rationale: registries make
   "add a variant" a one-file change and make partial updates fail loudly in CI.
4. **Explicit ports at subsystem boundaries.** Cross-subsystem calls go through named
   protocol interfaces composed in one place — never `getattr` duck-typing, never lazy
   imports inside functions to dodge cycles. Rationale: hidden contracts cannot be
   discovered by reading the interface, so alternate implementations silently lose
   behavior.
5. **Recipes over inference.** Common changes are documented as literal checklists.
   Rationale: a weaker maintainer following a checklist produces consistent results; a
   weaker maintainer inferring a pattern from mixed examples reproduces the worst one.
6. **Machine-checked parity.** Wherever two artifacts must agree (backend schema and
   frontend types, CLI parser and its reference, SSE enum and its client union), a script
   fails when they don't. Rationale: conventions decay; checks don't.
7. **Delete, don't shim.** This is a prototype. Replaced code is removed in the same
   change — no compatibility re-exports, no deprecated aliases, no "legacy" modules
   parked next to live ones. Git history is the archive.

---

## 2. System topology

- Frontend SPA: React + TypeScript + Vite + TanStack Query (`frontend/`)
- Backend API: FastAPI + SQLAlchemy + SQLite, migrations via Alembic (`backend/`,
  `alembic/`)
- Built-in agent: harness-first runtime inside the backend
  (`backend/services/agent/`), tool surface = the `bh` CLI (`backend/cli/`) executed in
  a subprocess plus two native tools
- AI writes are review-gated: the agent creates proposals; only human review applies
  domain mutations
- Single backend process: SSE streaming and background runs assume one process
  (documented constraint; do not build for multi-worker until that decision changes)

---

## 3. Backend architecture

### 3.1 Layers and ownership

```
routers/          HTTP translation ONLY: parse request -> call service -> map response.
                  No query construction, no DTO building, no business rules,
                  no try/except for domain errors.
services/         Domain policy, orchestration, queries, read-model (DTO) building.
                  Raise PolicyViolation for all domain errors.
models_*.py       SQLAlchemy ORM structure and relationships. No behavior.
schemas_*.py      API request/response pydantic models. Inherit from command models when
                  wire shapes match (`GroupCreate(GroupCreateCommand)`); otherwise keep
                  flat HTTP fields and convert explicitly to commands (entries pattern).
contracts_*.py /  Cross-layer command payloads and shared validated field types.
validation/
auth/ +           Principal resolution (route dependency) and row-level owner
services/access_scope.py   filters. Every owned-resource query uses these helpers.
```

Rules:

- **Commands own mutations.** Command models live in `contracts_*.py` or the owning
  service module. HTTP schemas either inherit the command when wire shapes match
  (`GroupCreate(GroupCreateCommand)`) or stay flat and convert explicitly when field
  names or refs differ (entries: `entry_create_command_from_http` /
  `entry_update_command_from_http` in `backend/services/entries.py`; commands in
  `backend/contracts_entries.py`). Agent proposal payloads convert via contract helpers
  (`to_create_command` / `to_update_command` on change-contract models). Every mutation
  caller builds a command and calls the one service function.
- **Read models are built in services.** Each domain has `build_x_read` /
  `list_x_for_principal` in its service module. Routers never assemble DTOs or issue
  `select()`.
- **Errors:** services raise `PolicyViolation` (`backend/services/crud_policy.py`);
  the global handler in `backend/main.py` maps it to HTTP. Routers contain no domain
  try/except. `HTTPException` appears only for pure transport concerns.
- **Scoping:** all owned-resource access goes through `access_scope.py` helpers
  (`*_owner_filter`, `get_*_for_principal_or_404`). Never hand-roll
  `owner_user_id == principal.user_id` conditions.
  `backend/tests/test_auth_boundaries.py` asserts every route has a principal
  dependency — extend it, never weaken it.
- **Reference domain:** `tags` (`backend/routers/tags.py` +
  `backend/services/tags.py`) is the canonical CRUD implementation. When in doubt, make
  your domain look like tags.
- **Layer direction:** non-agent services never import from `backend/services/agent/`.
  Agent-specific settings validation lives in
  `backend/services/agent/runtime_settings_validation.py`; core settings resolution stays
  in `backend/services/runtime_settings.py`. The agent package may import non-agent
  services (it is a client of the domain layer).

### 3.2 Configuration and settings

- Env settings: `backend/config.py` (`get_settings()`, cached).
- Runtime overrides: `backend/services/runtime_settings.py` merges the persisted
  `runtime_settings` row over env defaults per request. Agent-specific validation
  (model/vision checks) lives in `backend/services/agent/runtime_settings_validation.py`;
  the settings read view is built in `backend/services/agent/runtime_settings_view.py`.
- No import-time side effects beyond the documented env-file loading; app construction
  happens only inside `create_app()`.

### 3.3 Data lifecycle

- Schema changes only via Alembic migrations (linear chain). Seeds
  (`scripts/seed_*.py`) create data, never schema.
- Money is integer minor units. Soft-delete for entries. Append-only agent proposals.
- Every migration is referenced in `docs/backend_index.md` and
  `docs/repository_structure.md` (enforced by `scripts/check_docs_sync.py`).

---

## 4. Agent subsystem architecture

### 4.1 Execution core (harness-first)

```
routers/agent_*.py       HTTP translation for threads/runs/reviews/proposals/attachments
services/agent/execution.py      turn intake: validate -> persist message -> start run
services/agent/harness/          THE loop. AgentHarness + contracts + step executor.
                                 Depends only on its ports:
                                   ModelGateway   (complete(request) -> decision)
                                   ToolExecutor   (execute tool requests)
                                   RunRepository  (create/load/prepare/commit/finish —
                                                   the FULL contract, no optional
                                                   getattr-discovered methods)
                                   EventSink      (publish harness events)
                                   StopSignal     (cooperative interrupt)
services/agent/production_runtime.py   composition root: wires SQLAlchemy repository,
                                 LiteLLM gateway, tools, stop signal, SSE fan-out via
                                 stream_hub.register_run_executor(), and RunObserver
                                 post-terminal hooks composed through
                                 TerminalObservingRunRepository
services/agent/production_repository.py  persistence ONLY (no auto-approve, import
                                 notifications, or SSE publishing)
services/agent/run_observers.py  production RunObserver registrations (YOLO auto-approve,
                                 import scheduler wake, run_finished SSE on interrupt/
                                 worker failure) plus fail_run_terminally helper
services/agent/production_events.py    harness event -> SSE payload mapping, including
                                 display label/detail enrichment in DbEventSink (not the
                                 harness)
services/agent/stream_hub.py     in-process SSE hub: thread-per-run execution,
                                 subscriber fan-out, durable-sequence replay +
                                 ephemeral model_delta buffer. Single-process only.
services/agent/stream_sequences.py  hub sequence numbers, ephemeral buffer bookkeeping,
                                 fan-out drop policy, reconnect dedupe helpers
services/agent/api_projection.py read models: transcript rows -> API turns/thread detail
```

Rules:

- The harness stays product-agnostic: no display formatting, no HTTP types, no direct DB
  access, no knowledge of reviews or imports. Anything the harness needs from the outside
  is a declared port method.
- Post-terminal side effects (auto-approve on yolo runs, import-task notification,
  run_finished SSE on interrupt/worker failure) are `RunObserver` registrations in
  `run_observers.py`, composed via `TerminalObservingRunRepository` in
  `production_runtime.py` — never hidden inside the repository.
- Durable events get DB `sequence_index`; ephemeral `model_delta` events are buffered in
  the hub only and may be dropped under backpressure; durable events are never dropped.
  Reconnect = `GET /runs/{id}/stream?after_sequence=N` replay.
- Model-call seams for tests/benchmarks (`call_model`, `call_model_stream`,
  `calculate_context_tokens`) live in `services/agent/runtime.py` and are the only
  sanctioned monkeypatch points.

### 4.2 Tool surface

Two kinds of tools, on purpose:

1. **Native tools** (model-visible function calls): declared as `AgentToolDefinition`
   in `tool_runtime_support/catalog_*.py`, merged in `catalog.py` (`TOOLS` dict +
   `EXPOSED_RUNTIME_TOOL_NAMES`). Currently: `rename_thread`, `add_user_memory`,
   `run_bh`. Keep this catalog small — app operations belong in `bh`.
2. **`bh` CLI commands** (the real app surface): `run_bh` executes
   `python -m backend.cli.main` in a subprocess with injected backend URL, short-lived
   bearer session, thread id, and run id (`services/agent/terminal.py`). The CLI talks
   to the same HTTP API as the web app — one server-side policy path for everything.

The per-request tool list (e.g. rename-only gating for untitled threads) is decided in
exactly one function: `expose_tools_for_model_request()` in
`services/agent/tools_for_model_request.py`, used by both the live gateway and the token
counter.

### 4.3 Proposal / review pipeline

The agent never mutates domain tables. It creates `agent_change_items`
(`PENDING_REVIEW`); review approval applies them through the same domain command
functions the HTTP API uses.

Every `AgentChangeType` has exactly one `ChangeTypeSpec` entry in
`services/agent/change_registry.py` bundling: payload model, normalizer, apply handler,
domain/action/CLI labels, review-order rank, dependency-check hook, and summary
formatter. All list/HTTP/review/benchmark surfaces derive from the registry, and
`backend/tests/test_change_registry.py` fails if any enum member lacks a spec.

Review invariants:

- approval/rejection is per item; `APPLIED` items are immutable
- dependency blocking: proposals referencing pending create-proposals cannot be approved
  until dependencies apply
- apply uses the reviewing principal for scoping and ownership, and calls the canonical
  domain command functions (never a private reimplementation)

### 4.4 Prompt assembly

One package (`services/agent/prompt_assembly/`) with entry points in `__init__.py`
builds everything the model sees for a turn: system prompt (Jinja shell + includes +
user/account context + memory + `bh` cheat sheet), prior-transcript assembly, review
prefixes, and attachment parts — in one linear pipeline. The `bh` cheat sheet is rendered
from the same `CommandSpec` rows in `backend/cli_reference/specs.py` that the CLI uses,
and `scripts/render_agent_system_prompt_snapshot.py` regenerates
`docs/features/system_prompt_example.md` whenever prompts or the reference change.

---

## 5. Frontend architecture

### 5.1 Layers

```
lib/api/core.ts        THE request layer: auth header injection, ApiError, 401 token
                       cleanup. SSE/upload paths reuse its helpers.
lib/api/<domain>.ts    typed endpoint functions per domain. Nothing else calls fetch.
lib/api-types.gen.ts   TS types generated from committed `frontend/openapi.json`
                       (`scripts/dump_openapi.py` + `npm run gen:api`). Hand-written
                       types only for frontend-local view models.
lib/queryKeys.ts       the ONLY place query keys are defined.
lib/queryInvalidation.ts  the ONLY place invalidation rules live. Components call
                       invalidate<Domain>ReadModels helpers; never
                       queryClient.invalidateQueries directly.
features/<domain>/     useXPageModel hook (queries + mutations + derived state +
                       handlers) plus feature components. All data logic lives here.
pages/<X>Page.tsx      thin shells (< ~150 LOC): compose the model hook with feature
                       components. No useQuery/useMutation in pages.
components/ui/         Radix-based primitives (button, dialog shell, table, inputs,
                       select family). All dialogs/selects build on these.
styles/                tokens.css + base.css + one CSS file per feature. Global
                       classes are feature-prefixed; inline styles only for
                       data-driven values (chart/tag colors).
```

Reference implementations: `features/accounts/` (page model shape), `lib/api/core.ts`
(request layer), `features/agent/activity.ts` + `liveRun.ts` + `threadDetailCache.ts`
(pure, unit-tested state helpers).

### 5.2 Server-state rules

- TanStack Query owns all remote state. No `useEffect`+fetch. The only sanctioned
  exceptions: auth bootstrap in `AuthProvider` and explicit cache seeding documented in
  the page model.
- Every mutation ends with the matching `queryInvalidation.ts` helper in
  `onSuccess`/`onSettled`. If your mutation's domain has no helper, add the helper —
  don't inline `invalidateQueries`.
- Optimistic updates follow one recipe: patch the cache via a pure helper module (like
  `features/agent/threadDetailCache.ts`), then invalidate on settle. No ad hoc
  `setQueryData` scattered through components.
- Auth state lives in `AuthProvider` (outside Query) because it must survive redirects;
  it calls `queryClient.clear()` on login/logout/impersonation adoption.

### 5.3 Streaming (SSE) consumption

- The `AgentStreamEvent` union covers every backend `AgentRunEventType` member plus wire
  extras (`model_delta`, legacy `reasoning_delta` / `text_delta`). Keep
  `KNOWN_AGENT_STREAM_EVENT_TYPES` in `lib/types/agent.ts` aligned via
  `scripts/check_sse_parity.py` and `agentStreamEventTypes.test.ts`.
- Stream state lives in the module-level session store (`agentStreamSession.ts`),
  consumed via `useSyncExternalStore`, updated by the pure reducer in
  `streamReducer.ts` with unit tests.
- Unknown event types must log a dev warning — never silently no-op.
- Reconnect uses `after_sequence` replay; the client tracks the last durable sequence
  index per run.

### 5.4 Robustness requirements

- `strict: true` stays on; prefer adding `noUncheckedIndexedAccess` when practical.
- Error display goes through an ApiError-aware helper (`getApiErrorMessage`) —
  `(error as Error).message` is banned.
- Every page renders explicit loading, error, and empty states; empty states use
  `EmptyState`.
- No non-null assertions (`!`) on data derived from API responses; narrow explicitly.
- Every feature has tests targeting its model hook and pure helpers (mock the domain
  API module functions, not the whole `lib/api` barrel).

---

## 6. Recipes

Follow these literally. Each step is required; "it seemed unnecessary" is not a reason
to skip one. If reality diverges from a recipe, fix the recipe in the same PR.

### 6.1 Add or change a field on a domain model (e.g. Entry)

1. `backend/models_finance.py`: add the column/relationship.
2. New Alembic migration; reference it in `docs/backend_index.md` and
   `docs/repository_structure.md`.
3. Command model in `backend/contracts_entries.py` (`EntryCreateCommand` /
   `EntryUpdateCommand`); HTTP schema fields in `backend/schemas_finance.py` (flat wire
   shape — do not assume schema inheritance for entries).
4. HTTP-to-command converters in `backend/services/entries.py`
   (`entry_create_command_from_http`, `entry_update_command_from_http`); update the one
   service create/update functions and the read builder in `entries_read.py`.
5. If agent-proposable: update the change-contract payload in
   `services/agent/change_contracts/entries.py` and its `to_create_command` /
   `to_update_command` helpers — apply already delegates to the canonical service
   functions, so apply logic should not need changes.
6. Regenerate OpenAPI artifacts: `uv run python scripts/dump_openapi.py`, then
   `cd frontend && npm run gen:api`; `scripts/check_api_types_sync.py` must pass.
7. Frontend feature: form state + submit payload + display components (domain types in
   `frontend/src/lib/types/*.ts` alias generated schemas).
8. Docs: `docs/data_model.md`, relevant `docs/api/*.md`.
9. Tests: service-level (both HTTP and agent-apply paths), frontend model hook.
10. Run all verification gates.

### 6.2 Add a new agent proposal (change) type

1. Add the `AgentChangeType` enum member (`backend/enums_agent.py`).
2. Add the payload model in `services/agent/change_contracts/`.
3. Add the apply function in `services/agent/apply/` — it must call the domain's
   canonical command function.
4. Register one `ChangeTypeSpec` in `services/agent/change_registry.py` (the
   completeness test in `backend/tests/test_change_registry.py` lists anything missing).
5. Add the `bh` command spec in `backend/cli_reference/specs.py` (and parser/handler in
   the relevant `backend/cli/*_commands.py` module); regenerate the prompt snapshot.
6. Tests: propose -> review -> apply round trip, dependency blocking if applicable.
7. Frontend: review card mapping if the new type needs custom display
   (`components/review/`).

### 6.3 Add a `bh` CLI command

1. Add the parser + handler in the appropriate `backend/cli/*_commands.py` module;
   handlers call the HTTP API via `request_json` (never services directly).
2. Add the matching `CommandSpec` in `backend/cli_reference/specs.py`; `scripts/check_cli_parity.py` fails otherwise.
3. If hosted agents should not see it, add it to `HOSTED_HIDDEN_COMMANDS` in
   `backend/cli_reference/specs.py`; if hosted agents need it, verify `terminal.py`
   guards allow it.
4. Regenerate the prompt snapshot
   (`uv run python scripts/render_agent_system_prompt_snapshot.py`).
5. Tests in `backend/tests/test_cli_support.py` or the relevant CLI test module.

### 6.4 Add a native agent tool (rare — prefer a `bh` command)

1. Define input args in `services/agent/tool_args/`.
2. Implement the handler (pure-ish function taking `ToolContext`).
3. Register an `AgentToolDefinition` in the right
   `tool_runtime_support/catalog_*.py`; add the name to
   `EXPOSED_RUNTIME_TOOL_NAMES` in `catalog.py`.
4. Document it in the system prompt template; regenerate the snapshot.
5. Tests: schema exposure + execution + error path.

### 6.5 Add a durable SSE event type

1. Add the `AgentRunEventType` member (`backend/enums_agent.py`).
2. Emit it from the harness (new event dataclass in `harness/contracts.py`) or the
   runtime layer; map it in `production_events.py`.
3. Persist ordering: confirm `DbEventSink` handles it (durable events get
   `sequence_index`).
4. Frontend: extend the `AgentStreamEvent` union, add the type to
   `KNOWN_AGENT_STREAM_EVENT_TYPES` in `lib/types/agent.ts`, and update the stream
   reducer; `scripts/check_sse_parity.py` fails until you do.
5. Update `docs/api/agent.md`.

### 6.6 Add a frontend page or workspace

1. Create `features/<domain>/use<X>PageModel.ts`: all queries (keys from
   `queryKeys.ts`), mutations (invalidation via `queryInvalidation.ts` helpers),
   derived state, and handlers.
2. Create feature components beside it; build dialogs on the shared dialog shell and
   selects on the shared select family.
3. Create `pages/<X>Page.tsx` as a thin shell; register the route in `App.tsx` and the
   sidebar if user-visible.
4. Styles in `styles/<feature>.css` with feature-prefixed classes.
5. Loading/error/empty states for every async region.
6. Tests for the model hook + a page-level render test.
7. Update `frontend/docs/` and `docs/repository_structure.md`.

### 6.7 Add a backend domain (full CRUD)

Copy the tags domain end to end: ORM model + migration -> command models -> service
(create/update/delete/list + read builders, `PolicyViolation` errors,
`access_scope` filters) -> thin router -> HTTP schemas (inherit commands when wire
shapes match; otherwise explicit converters like entries) -> tests (service +
route + auth boundary) -> frontend recipe 6.6 -> docs.

---

## 7. Anti-patterns (never do these)

- Never duplicate a payload/enum/label map "temporarily". Derive or generate it.
- Never write a second code path that mutates the same domain rows as an existing
  service function.
- Never put `select()`/DTO-building/business rules in a router, or HTTP concerns in a
  service.
- Never branch on a variant family with if/elif — extend the registry.
- Never reach a dependency via `getattr(obj, "method", None)` — add it to the protocol.
- Never lazy-import inside a function to break a cycle — fix the dependency direction
  or inject at composition time.
- Never swallow exceptions without `error_policy.recoverable_result` (backend) or a
  logged, user-visible error state (frontend).
- Never call `queryClient.invalidateQueries` outside `lib/queryInvalidation.ts`; never
  define a query key outside `lib/queryKeys.ts`.
- Never hand-roll a modal, floating select, or table when a shared primitive exists.
- Never leave a "compatibility re-export" module behind after moving code.
- Never write a boilerplate calling spec ("implement focused service logic for X") — a
  spec must state real inputs, outputs, and side effects, or the file needs rethinking.
- Never commit machine-specific absolute paths into repo files.

---

## 8. Decision table

| You want to... | Do this |
|---|---|
| Let the agent read app state | `bh` read command (recipe 6.3), not a native tool |
| Let the agent change app state | New proposal type (recipe 6.2) — never direct writes |
| Show a new field in the UI | Recipe 6.1; types come from the backend schema |
| React to a mutation elsewhere in the UI | Extend the domain's helper in `queryInvalidation.ts` |
| Add cross-domain business rules | Service layer, raising `PolicyViolation` |
| Cache/optimize a hot read | Service read-model function first; measure before caching |
| Handle a new stream/live update | Durable SSE event (recipe 6.5); never poll from components |
| Skip review "just this once" | Don't. `approval_policy=yolo` (post-run auto-approve) is the only sanctioned bypass |
| Keep old code "for reference" | Delete it; git history is the reference |

---

## 9. Durability mechanisms

The architecture stays healthy only because these run on every change
(see `AGENTS.md` for the authoritative gate list):

- `uv run python scripts/check_llm_design.py` — LOC caps, calling specs, broad-except
  hygiene, `extra="forbid"`
- `uv run python scripts/check_docs_sync.py` — doc existence, migration references,
  stale terms, index links, prompt snapshot banner
- `OPENROUTER_API_KEY=test uv run pytest backend/tests -q` and frontend
  `npx tsc --noEmit && npm test`
- `backend/tests/test_auth_boundaries.py` — every route requires a principal
- `uv run python scripts/check_api_types_sync.py` — OpenAPI snapshot and generated frontend types freshness
- Parity checks: `check_cli_parity.py` (argparse ↔ `cli_reference/specs.py` ↔ prompt
  snapshot), `check_sse_parity.py` (backend enum ↔
  `KNOWN_AGENT_STREAM_EVENT_TYPES`), `check_frontend_discipline.py` (query keys,
  invalidation, page purity greps); change-type registry completeness in
  `test_change_registry.py`

When you add a new "two things must agree" seam, add the parity check in the same PR.
That is the difference between a convention and an architecture.

## Related docs

- `docs/llm_oriented_design.md` — generic LLM-oriented code-shape rules
- `docs/architecture.md` — current-system topology and behavior
- `docs/completed_tasks/2026_07_01-backend_frontend_refactor.md` — archived refactor
  plan and outcome notes
- `backend/docs/` and `frontend/docs/` — subsystem behavior docs
