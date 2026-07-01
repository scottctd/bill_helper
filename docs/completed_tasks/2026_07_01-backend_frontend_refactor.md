# Backend + Frontend Architecture Refactor Plan

Status: completed (2026-07-01). Scope: `backend/` and `frontend/` only. `ios/` and `telegram/` are out of
scope; they are mentioned only where they constrain a seam we must not break.

This plan was produced from a full architecture audit on 2026-07-01. Every finding below was
verified against the tree at that date (file paths, line numbers, and LOC counts are real).
The companion normative doc is `docs/architecture_design.md` — it describes the binding
architecture rules future work must follow. Read it first.

---

## 1. Goals

1. Fix the structural problems that make changes expensive and error-prone today:
   contract duplication, split-brain patterns, side effects hidden in the wrong layer,
   and legacy code sitting next to live code.
2. Converge every domain onto one canonical pattern per job (one CRUD recipe, one page
   recipe, one proposal registry, one error contract) so there is exactly one right way
   to do each thing.
3. Make the result durable for future maintainers — including LLM agents weaker than the
   ones that built this. Durability comes from: registries instead of scattered wiring,
   generated contracts instead of hand-copied types, executable checklists ("recipes"),
   and automated parity checks that fail CI when someone updates one copy of a contract
   and forgets the others.

## 2. How to execute this plan

Rules for the implementing team. These are not optional.

- Work in the phase order given in section 5. The ordering encodes real dependencies;
  doing phases out of order means moving the same code twice.
- One phase = one reviewable unit of work (one PR or a small stack). Do not batch phases.
- Each phase lists acceptance criteria. A phase is done only when all criteria pass and
  the verification gates below pass.
- This is a prototype repo: prefer deletion and replacement over compatibility shims.
  When a phase says "remove", remove — do not deprecate, alias, or keep a re-export
  "just in case". If something breaks, the tests will say so.
- Update docs in the same PR as the code change (see the doc-update matrix in
  `AGENTS.md`). Do not leave doc updates for a later phase.
- If you discover the plan is wrong about a detail (line moved, symbol renamed), fix the
  work, then fix this doc in the same PR.

### Verification gates (run after every phase)

```bash
uv run python -m py_compile <touched .py files>
OPENROUTER_API_KEY=test uv run pytest backend/tests -q
uv run python scripts/check_llm_design.py
uv run python scripts/check_docs_sync.py
cd frontend && npx tsc --noEmit && npm test
```

---

## 3. Current state snapshot (verified 2026-07-01)

| Area | Size | Shape |
|---|---|---|
| `backend/services/agent/` | 134 files, 17,490 LOC | median file ~100 LOC; largest `legacy_transcript_backfill.py` 795 |
| `backend/` non-agent, non-test | 109 files, 20,878 LOC | largest cluster is `backend/cli/` (reference 772, main 759, rendering 741) |
| `frontend/src/` | 291 files, 40,881 LOC | largest non-test `useAgentComposerStreamState.ts` 692 |
| `frontend/src/styles/` | 14 files, 4,545 LOC | global CSS split by domain prefix; `workspaces.css` 871 |
| `alembic/versions/` | 50 migrations, 6,084 LOC | linear chain 0001–0049 |

No production source file exceeds the 800 LOC hard limit. The problems are not file size;
they are duplication, wrong-layer ownership, and inconsistent patterns.

---

## 4. Findings

Each finding: what it is, evidence, why it matters, and target state. Findings are grouped
by area and numbered for reference from the phases (`B` = backend core, `A` = agent
subsystem, `F` = frontend, `X` = cross-cutting).

### 4.1 Backend core

#### B1. Entry mutation is defined in four parallel stacks

- HTTP schemas: `EntryCreate` / `EntryUpdate` in `backend/schemas_finance.py`
- Service commands: `EntryCreateCommand` / `EntryUpdateCommand` in
  `backend/services/entries.py`, plus a hand-written adapter in
  `backend/routers/entries.py` (`_entry_create_command_from_request`, ~L117-182) that
  maps the HTTP shape onto the command shape
- Agent proposal contracts: `backend/contracts_agent_entries.py` and
  `backend/services/agent/change_contracts/entries.py` — with **different field names**:
  `date` vs `occurred_at`, `markdown_notes` vs `markdown_body`, name-only entity refs
- Agent apply: `apply_create_entry` in `backend/services/agent/apply/entries.py` (L33)
  **reimplements** entry creation instead of calling `create_entry_from_command`
  (`backend/services/entries.py` L328)

Why it matters: adding one persisted field to `Entry` touches 12–15 files today, and it is
easy to update the HTTP path but miss the agent apply path (or vice versa), producing
entries that behave differently depending on how they were created. This is the single
highest-leverage backend fix.

Target: one command model per mutation, owned by the service layer. The HTTP schema
inherits or converts to it trivially; the agent proposal payload converts to it at apply
time; apply calls the same service function the router calls. The groups domain already
does this (`GroupCreate(GroupCreateCommand)` in `backend/schemas_finance.py` L375-379) —
copy that shape.

#### B2. `routers/entries.py` is a fat controller (486 LOC)

Its calling spec claims HTTP-only translation, but it contains query construction
(`list_entries` ~L341-427 builds `select(Entry)` with category subqueries and tag joins),
an O(n) Python group-membership filter (L392-402 loads all matching rows then calls
`entry_matches_group(db, ...)` per row), serialization orchestration (loads all groups,
all owner entries, and category paths on every list call), and the command adapters from
B1. Contrast with `backend/routers/tags.py` (82 LOC): schema → command → service →
read-builder — that is the template.

Target: a `list_entries_for_principal(db, principal, filters)` service function owning the
query and read-model assembly; the router does request parsing and response mapping only.

#### B3. Group-membership context is rebuilt in three places

`backend/services/serializers.py` (`build_entry_groups`), `backend/services/groups.py`
(`entry_matches_group` L323, `build_group_summary` / `_build_member_reads`), and the
entries list filter each rebuild the same bundle (scoped entries + category paths + rule
contexts + account entity ids). `entry_matches_group` reloads all scoped entries per call.

Target: one membership read module (extend `backend/services/group_membership.py`) that
computes effective membership once per request and is shared by the serializer, the group
summary builder, and the entries list filter.

#### B4. Error translation is inconsistent across routers

The good pattern exists: services raise `PolicyViolation` (`backend/services/crud_policy.py`)
and a global handler in `backend/main.py` maps it to a JSON response. Tags, accounts,
entities rely on it. Divergences:

- `backend/routers/import_jobs.py` wraps many routes in try/except and re-raises
  `HTTPException` manually; `import_workflow/serializers.load_job_for_owner` raises
  `LookupError` instead of `PolicyViolation.not_found`
- `backend/routers/entries.py` maps `EntryTagSuggestionError` (a parallel error type
  carrying `status_code`) to `HTTPException` by hand (~L442)
- `backend/routers/groups.py` catches `IntegrityError` in the router (L147-149)
- `backend/routers/dashboard.py` maps `ValueError` to 422 by hand and calls `db.commit()`
  on a read-only endpoint (L33-39)

Target: `PolicyViolation` is the only service→HTTP error channel. No router-level
try/except for domain errors. Read endpoints never commit.

#### B5. Read-model / serializer ownership is fragmented

`backend/services/serializers.py` owns entry serialization; accounts/tags/groups own their
own `build_*_read`; `backend/routers/entities.py` has a router-local `_to_schema` +
usage-count struct (L29-60). No convention says where a read DTO is built.

Target: every domain has a read-builder in its service module (or a `*_read_models.py`
sibling); routers never build DTOs.

#### B6. `runtime_settings.py` depends on the agent package, and resolution is uncached

`backend/services/runtime_settings.py` L15-16 imports agent modules
(`model_supports_vision`, `validate_litellm_environment`) — a non-agent service depending
on the agent subtree. `resolve_runtime_settings(db)` merges DB overrides over env settings
on every call with no caching; it is called from dashboard, import jobs, agent execution,
and tag suggestions.

Target: split agent-specific validation into `runtime_settings_agent.py` (or move it into
the agent package) so core settings resolution has no agent import. Caching is optional —
only add it if profiling shows it matters; correctness first.

#### B7. `import_workflow/` runs its own thread machinery on top of agent runs

`backend/services/import_workflow/scheduler.py` (287 LOC) keeps a module-global
`_coordinators` registry, spawns a daemon thread per job, and calls `asyncio.run()` inside
the thread per task (L166-179). Completion is signalled by the agent's
`production_repository.finish()` calling `notify_agent_run_terminal` (see A3) — the doc
`backend/docs/import_workflow.md` points at a file that no longer owns that hook.

Target: one "run finished" notification seam owned by the agent runtime (see A3), with the
import scheduler as a subscriber. Fix the doc. Simplify the per-job coordinator once the
seam exists.

#### B8. Dead code in the groups domain (post-0049 leftovers)

`GroupDefinition` + `list_group_definitions` (`backend/services/groups.py` L33-69) and
`build_group_read_from_row` (L303-309) have zero external callers.
`backend/cli/dashboard_rendering.py` L402 still references the legacy
`filter_group_totals` JSON key.

Target: delete.

### 4.2 Agent subsystem

#### A1. Adding a proposal type touches 10–14 places, only some of which are registries

Verified touch list for a new `AgentChangeType`:

| # | Place | Mechanism |
|---|---|---|
| 1 | `backend/enums_agent.py` | enum member |
| 2 | `backend/services/agent/change_contracts/{catalog,entries,groups}.py` | payload model |
| 3 | `change_contracts/__init__.py` (`CHANGE_PAYLOAD_MODELS`) | registry (good) |
| 4 | `backend/services/agent/proposals/*.py` | `propose_*` handler |
| 5 | `proposals/normalization_*.py` + `proposals/normalization.py` | registry (good) |
| 6 | `backend/services/agent/apply/{catalog,entries,groups}.py` | `apply_*` handler |
| 7 | `apply/dispatch.py` (`APPLY_CHANGE_HANDLERS`) | registry (good) |
| 8 | `backend/services/agent/proposal_metadata.py` | domain/action/label map |
| 9 | `backend/services/agent/proposal_http.py` | **two inline dicts + a 19-branch `if change_type ==` chain at L311-373** |
| 10 | `backend/services/agent/reviews/ordering.py` (`CHANGE_TYPE_REVIEW_ORDER`) | list |
| 11 | `backend/services/agent/reviews/dependencies.py` (357 LOC) | per-type checks |
| 12 | `backend/cli/create_commands.py` + `backend/cli/reference.py` | CLI spec + cheat sheet |
| 13 | `backend/services/agent/benchmark_interface.py` | elif chain |

Why it matters: partial updates are the expected failure mode for any maintainer — a
handler gets added but the normalizer, review order, or CLI cheat sheet is forgotten, and
nothing fails until runtime.

Target: one `ChangeTypeSpec` registry (see phase 6) from which `proposal_http`, metadata,
review ordering, and the summary formatter are all derived, plus a completeness test that
fails when any `AgentChangeType` member lacks a spec.

#### A2. `production_repository.py` owns orchestration side effects behind duck typing

`SqlAlchemyRunRepository.finish()` triggers `maybe_auto_approve_after_completed_run`
(L386-389) and `notify_agent_run_terminal` (L395-397, import scheduler). Interrupt
finalization publishes SSE directly (`publish_run_stream_event`, L442-453).
`ensure_run_finished_event` is a production-only method the harness reaches via
`getattr(self._repository, "ensure_run_finished_event", None)` (`harness/harness.py`
L166, L316) — a hidden second contract not present on the `RunRepository` protocol.

Why it matters: the harness claims persistence-agnostic ports, but review policy, import
scheduling, and streaming are silently coupled to the persistence adapter. Anyone writing
a second repository (tests, benchmarks) silently loses those behaviors.

Target: `RunRepository` protocol covers everything the harness calls (no `getattr`).
Post-terminal side effects (auto-approve, import notify) move into an explicit
`RunObserver` port invoked by the runtime composition layer, not by the repository.

#### A3. Presentation logic inside the harness loop

`harness/harness.py` calls `build_tool_call_display(...)` (L234-246, L277-291) to compute
UI labels when publishing tool events. The core loop should not know about display strings.

Target: harness publishes raw tool events; the event→SSE mapping layer
(`production_events.py`) attaches display fields.

#### A4. Prompt assembly is spread across ~8 modules and depends on the CLI package

Participants in one turn: `prompts.py`, `system_prompt.j2` + `prompt_includes/*.j2`,
`user_context.py`, `message_history_content.py`, `message_history_prefixes.py`,
`thread_context.py`, `model_gateway_support/transcript_hydration.py`,
`model_gateway_support/conversion.py`. `prompts.py` L17 imports `backend.cli.reference`
to embed a 772-line command cheat sheet in the system prompt (a service→CLI dependency).

Target: a `prompt_assembly/` package with a single documented pipeline entry point, and
the cheat-sheet renderer moved to a location both CLI and prompts can import without the
service layer depending on `backend/cli` internals (see phase 8).

#### A5. Stream hub is a fragile in-process singleton

`backend/services/agent/stream_hub.py`: module globals `_executions` + `_registry_lock`,
one daemon thread per run, unbounded per-subscriber `queue.Queue` with non-blocking
`put(..., block=False)` (L75) that can silently drop events, dual sequence numbering
(durable DB `sequence_index` vs hub-local `_hub_sequence` for ephemeral `model_delta`),
worker failure path that mutates `run_row.status = FAILED` directly in the DB (L102-111)
bypassing harness terminal semantics, and a lazy circular import with
`production_runtime.py` (hub imports `execute_harness_run`; runtime's
`StreamPublishingEventSink` lazily imports the hub).

Target: keep the single-process design (documented constraint) but fix the failure path
(route through harness terminal handling), define an explicit drop/backpressure policy,
unify sequence bookkeeping behind one helper, and break the import cycle with an explicit
composition seam (see phase 9).

#### A6. Legacy migration code lives in the production tree

`legacy_transcript_backfill.py` (795), `legacy_transcript_backfill_apply.py` (287),
`legacy_structured_backfill.py` (125), `agent_upload_bundle_relocate.py` (178),
`docling_convert.py` (192 — archived pipeline; the live attachment path uses PyMuPDF page
renders). Also dead: `runtime.py` `run_existing_agent_run_stream()` (resumes then
`yield from ()`), referenced only by an import-convention test. Doc drift:
`backend/docs/agent_subsystem.md` references `tool_runtime_support/catalog_image.py`,
which does not exist.

Target: confirm the one-time backfills have been applied to the production DB, then delete
them (they are in git history). Delete dead stubs. Fix the doc.

#### A7. Compatibility facades multiply entry points

`tools.py` (30 LOC, self-described "compatibility re-export surface"), `tool_runtime.py`
(22), `model_client.py` (20), `protocol.py`, and `runtime.py` (164) all wrap the same
production paths. Multiple import paths for one thing means grep misses usages and agents
edit the facade instead of the owner.

Target: exactly one public seam per concern (`runtime.py` for execution seams stays —
tests monkeypatch it; the rest collapse into their owner modules).

#### A8. Duplicated rename-thread gating policy

`_RENAME_THREAD_TOOL_NAME` and the forced-`tool_choice` logic exist in both
`model_gateway.py` (L35, L66-80) and `tools_for_model_request.py` (L12, L15-23). If one
copy changes, live requests and token counting diverge.

Target: one module owns the "which tools does this request expose" decision; both the
gateway and the token counter call it.

#### A9. Error policy exists but is barely used

`error_policy.recoverable_result()` is used in ~4 modules, while broad
`except Exception` handlers with ad hoc behavior exist in `agent_attachment_bundle.py`
(5 sites), `attachment_content_assembly.py`, `proposal_http.py` (→ generic 400),
`langfuse_litellm.py`, and others. Retry policies differ per layer (tenacity in
`model_client_support/client.py` vs `tool_runtime_support/execution.py` vs none in the
harness) with independently configured backoff.

Target: every recoverable fallback goes through `error_policy` with scope/context
metadata; retries are defined in one policy module and referenced by both layers.

#### A10. ~60 modules have autogenerated, information-free calling specs

Pattern: `# - Purpose: implement focused service logic for \`{module}\`.` These satisfy
`check_llm_design.py` but convey nothing, defeating the purpose of Pattern 2 in
`docs/llm_oriented_design.md`. (This is repo-wide, not agent-only: the same boilerplate
appears in frontend modules, e.g. `frontend/src/lib/queryInvalidation.ts`.)

Target: real specs (inputs, outputs, side effects) rewritten module-by-module as files are
touched in each phase; a spot-checkable style rule in `docs/architecture_design.md`.

### 4.3 Frontend

#### F1. Page architecture is split-brain

| Page | LOC | Pattern |
|---|---|---|
| `AccountsPage` | 124 | thin page + `useAccountsPageModel` (436) — target shape |
| `EntitiesPage` | 70 | thin page + model hook |
| `SettingsPage` | 61 | thin page + model hook |
| `PropertiesPage` | 36 | thin page, but model hook is itself a 548 LOC monolith |
| `EntriesPage` | 576 | ~10 queries/mutations inline in the page |
| `DashboardPage` | 555 | queries + derived state in the page |
| `GroupsPage` | 441 | 9 queries + 6 mutations inline |
| `AdminPage` | 418 | inline queries/mutations, no tests |
| `EntryDetailPage` | 192 | 8 queries inline |

Page-local helpers are copy-pasted: `kindLabel`/`kindSymbol` exist in `EntriesPage.tsx`
(L66-82), `EntryDetailPage.tsx` (L33-43), and `GroupDetailModal.tsx`; `groupRangeLabel`
in `GroupsPage.tsx` and `GroupDetailModal.tsx`.

Target: every page is a thin shell + `useXPageModel` feature hook; shared label helpers
live in `lib/format.ts` or a domain helper module. One recipe, no exceptions.

#### F2. API types are hand-written with no generation or validation

`lib/types/*.ts` mirrors backend pydantic by hand. No OpenAPI codegen, no Zod, no runtime
validation — `request<T>` does `(await response.json()) as T`. Verified drift:
`RuntimeSettings.vision_capable_agent_models` is required on the backend
(`backend/schemas_settings.py` L46) but optional in `frontend/src/lib/types/settings.ts`
(L38). `frontend/docs/client_and_state.md` still describes `lib/api.ts` / `lib/types.ts`
as definition sites and lists a `workspace.snapshot` query key that no longer exists.

Target: generate TS types from FastAPI's `openapi.json` (see phase 10) and add a CI
freshness check. Hand-written types remain only for frontend-local view models.

#### F3. `ApiError` exists but is unused by callers

`lib/api/core.ts` defines `ApiError` with `.status`, clears the token on 401. But callers
everywhere do `(error as Error).message` (e.g. `AdminPage.tsx` L361); nothing branches on
403/404/409/422/500. SSE and upload paths in `lib/api/agent.ts` (~490 LOC) duplicate the
auth/error logic instead of sharing `core.ts`.

Target: a single `getApiErrorMessage(error)` helper plus a documented per-status handling
recipe; SSE/upload paths share the core auth header + error extraction helpers.

#### F4. SSE consumption is partially typed and silently drops unknown events

`lib/types/agent.ts` (L280-338) enumerates a union missing `run_started`,
`model_request_started`, and `step_committed`. The parser (`lib/api/agent.ts` L60-78)
casts any object with a string `type` to `AgentStreamEvent`. The handler
(`useAgentComposerStreamState.ts` L426-656) has no default branch — unknown event types
no-op silently. `patchAgentThreadCachedRunUsage` (`threadDetailCache.ts` L114-152) is
defined but never called, so live `run_usage` events are ignored.

Target: the frontend event union covers every backend `AgentRunEventType` member plus
`model_delta`; unknown events log a console warning; a parity test compares the union to
the backend enum (or the union is generated). Wire or delete the run-usage patch helper.

#### F5. The agent panel streaming stack is a hairball (well-tested, but unreadable)

`features/agent/` is 64 files / 11,635 LOC. The core problem is state ownership:
`useAgentComposerStreamState.ts` (692 LOC) keeps every piece of stream state **twice** —
in React `useState` and in the module singleton `agentStreamSession` — synced by hand in
both directions (L143-195, L521-566). `useAgentComposerRuntime` takes 16 callbacks;
`AgentTimeline` receives ~27 props via spread. Optimistic state lives in four places
(thread actions, composer runtime, query cache patches in `threadDetailCache.ts`, and the
session store).

The pure helpers (`activity.ts`, `liveRun.ts`, `threadDetailCache.ts`) are the good part —
tested, deterministic seams.

Target: one stream store (the module session store, formalized) with a pure reducer
`applyStreamEvent(state, event) -> state`, React subscribing via `useSyncExternalStore`;
timeline props collapsed into one typed view-model object (see phase 14).

#### F6. UI duplication and dead code

- ~13 distinct modal/dialog implementations over the same Radix primitives
- Three near-duplicate floating-select components: `SingleSelect` (260),
  `CreatableSingleSelect` (255), `TagMultiSelect` (540)
- Dead: `components/LineChart.tsx` (zero imports), `queryKeys.auth.session` (never used),
  `DailyExpensePoint` type (only used by dead LineChart)
- `styles/workspaces.css` (871 LOC) is misnamed — it holds Entries/Groups/Properties page
  styles under a legacy name

Target: one modal shell + one select family; delete dead code; split/rename the CSS by
owning feature.

#### F7. Invalidation discipline is inconsistent

`lib/queryKeys.ts` + `lib/queryInvalidation.ts` are the right pattern and are used by
entries/groups/accounts/properties/settings/agent. But `AdminPage.tsx` (L83-131) and the
import feature call `queryClient.invalidateQueries` ad hoc; there are no
`invalidateAdminReadModels` / `invalidateImportReadModels` helpers. There is no `onMutate`
rollback recipe anywhere; optimism is ad hoc `setQueryData`.

(Note: admin impersonation is fine — `AuthProvider` calls `queryClient.clear()` when
adopting a session, so the stale-cache risk flagged in an earlier audit does not exist.)

Target: every domain has an invalidation helper; pages never call
`queryClient.invalidateQueries` directly; one documented optimistic-update recipe.

#### F8. Test seams and gaps

Strong: agent panel pure helpers and page tests exist for most pages. Gaps: no tests for
`AdminPage` (418 LOC, impersonation), `EntryDetailPage`, `usePropertiesPageModel`
(548 LOC). Page tests mock the `lib/api` module boundary, so they break when imports move
rather than when behavior changes.

Target: after pages move to model hooks (phase 11), tests target the model hooks and pure
helpers; add the missing page tests.

### 4.4 Cross-cutting

#### X1. No contract generation anywhere

FastAPI already produces `openapi.json`; nothing consumes it. Every payload is
hand-maintained in backend pydantic + frontend TS (+ CLI compact schemas + docs). An Entry
field change touches 12–15 files across the stack.

#### X2. `bh` CLI triplication with no parity checks

The argparse tree (`backend/cli/main.py`), the `CommandSpec` list
(`backend/cli/reference.py`), and the prompt cheat sheet rendered from it are maintained
by hand in parallel. `scripts/check_docs_sync.py` verifies only banner phrases of the
generated prompt snapshot, not command parity. Nothing fails when a command is added to
argparse but not to `reference.py` (the agent then doesn't know the command exists).

#### X3. Guardrail scripts have gaps

`check_llm_design.py` enforces LOC caps, calling specs (satisfiable by boilerplate, see
A10), broad-except hygiene, and `extra="forbid"`. `check_docs_sync.py` enforces doc
existence, migration mentions, stale terms, and link graphs. Neither enforces: contract
parity (backend↔frontend, argparse↔reference, SSE enum↔TS union), invalidation coverage,
or test-file size.

### 4.5 What is good and must be preserved

Do not "improve" these while refactoring around them:

- `harness/` core: real injected ports, readable 352-LOC loop, `decision_injection.py`
  test seam
- `apply/dispatch.py` `APPLY_CHANGE_HANDLERS`, `change_contracts/__init__.py`
  `CHANGE_PAYLOAD_MODELS`, `proposals/normalization.py` — the registry pattern to extend
- `crud_policy.PolicyViolation` + global handler; `access_scope.py` owner-filter helpers;
  `validation/contract_fields.py` shared field types
- `backend/routers/tags.py` as the reference thin router
- `tests/test_auth_boundaries.py` route-dependency scan (architectural gate — extend it,
  never delete it)
- Frontend: `lib/api/core.ts` + domain API modules; `queryKeys.ts`/`queryInvalidation.ts`;
  thin-page + model-hook pattern in accounts/entities/settings; agent pure helpers
  (`activity.ts`, `liveRun.ts`, `threadDetailCache.ts`) and their tests;
  `components/ui/*` Radix primitives; `ProtectedShell` auth gate
- Ephemeral vs durable event split (deltas not persisted) — right idea, fix the plumbing
- Telegram's pattern of importing backend pydantic for validation — means backend schema
  modules must stay import-stable for out-of-scope surfaces; renaming schema classes
  requires a grep through `telegram/`

---

## 5. The plan

Four workstreams, sixteen phases. Dependency graph:

```
WS1 (backend contracts)   : P1 -> P2 -> P3 -> P4
WS2 (agent subsystem)     : P5 -> P6 -> P7 -> P8 -> P9      (P6+ depend on P1 for entry apply unification)
WS3 (frontend)            : P10 -> P11 -> P12 -> P13 -> P14 (P10 benefits from P1-P4 being settled first)
WS4 (guardrails)          : P15 -> P16                      (last; locks everything in)
```

WS1 and WS2-P5 can run in parallel. WS3 can start P11/P12 in parallel with WS2, but P10
(codegen) should wait until WS1 stabilizes backend schemas so generated types don't churn.

### Workstream 1 — Backend domain contracts

#### Phase 1: One mutation pipeline per domain (fixes B1)

1. Decide canonical field names once: the ledger names win (`occurred_at`,
   `markdown_body`). The agent-facing payloads (`change_contracts/entries.py`,
   `contracts_agent_entries.py`) keep their model-friendly external names (`date`,
   `markdown_notes`) **only** as pydantic aliases/conversion at the contract boundary —
   internally everything becomes an `EntryCreateCommand`.
2. Make `apply_create_entry` / `apply_update_entry` in
   `backend/services/agent/apply/entries.py` convert the proposal payload to
   `EntryCreateCommand` / `EntryUpdateCommand` and call `create_entry_from_command` /
   the update service function. Delete the duplicated creation logic.
3. Collapse the router adapter: make `EntryCreate` / `EntryUpdate` inherit from (or
   trivially convert to) the command models, following the groups pattern
   (`GroupCreate(GroupCreateCommand)`). Delete
   `_entry_create_command_from_request`-style adapters from the router.
4. Add an equivalence test: creating an entry via `POST /entries` and via an approved
   agent proposal with the same logical payload produces identical rows (minus ids and
   provenance).

Why first: every later phase that touches entries (router slimming, codegen, proposal
registry) otherwise has to handle two divergent pipelines.

Acceptance: one function creates entries; one updates them; equivalence test passes;
`rg "apply_create_entry"` shows it as a thin converter.

#### Phase 2: Read models + entries router slimming (fixes B2, B3, B5)

1. Extend `backend/services/group_membership.py` with a request-scoped context object
   (`GroupMembershipContext`) built once, used by `serializers.build_entry_groups`,
   `groups.build_group_summary`, and the entries list filter. Delete the per-row
   `entry_matches_group` usage from the router; membership filtering happens inside the
   list service against the precomputed context.
2. Create `list_entries_for_principal(db, principal, filters) -> EntryListResponse` in
   `backend/services/entries.py` (or `entries_read.py` if the file nears 800 LOC), moving
   the query construction, category subquery, and serialization orchestration out of the
   router.
3. Move `routers/entities.py` `_to_schema` and usage counts into
   `backend/services/entities.py`.
4. Router list queries in `accounts.py`, `groups.py`, `import_jobs.py` move into their
   services the same way.

Acceptance: no `select(` / `db.scalars` in any router except trivial one-liners already
delegating; `routers/entries.py` under ~200 LOC; membership context built once per list
request (verify with a query-count assertion in tests).

#### Phase 3: Error contract normalization (fixes B4)

1. Convert `import_workflow/serializers.load_job_for_owner` to raise
   `PolicyViolation.not_found`; delete try/except HTTPException blocks in
   `routers/import_jobs.py`.
2. Replace `EntryTagSuggestionError` with `PolicyViolation` (it already carries a status).
3. Move the `IntegrityError` → conflict translation from `routers/groups.py` into the
   groups service (catch at flush point).
4. Dashboard router: delete the `db.commit()` on read; move the month `ValueError` →
   422 mapping into a validated query param type.

Acceptance: `rg "HTTPException" backend/routers` matches only auth/infrastructure cases
(document each remaining case inline); all domain errors flow through the global handler.

#### Phase 4: CRUD recipe consolidation + dead code (fixes B6, B8)

1. Split agent imports out of `backend/services/runtime_settings.py` into an
   agent-owned validation module; core resolution keeps zero agent imports.
2. Delete `GroupDefinition`, `list_group_definitions`, `build_group_read_from_row`, and
   the `filter_group_totals` key in CLI dashboard rendering.
3. Write the canonical CRUD recipe into `docs/architecture_design.md` (already drafted
   there — verify it matches the final code) with `tags` as the named reference domain.

Acceptance: `rg "from backend.services.agent" backend/services/runtime_settings.py`
empty; dead symbols gone; recipe doc matches reality.

### Workstream 2 — Agent subsystem

#### Phase 5: Delete legacy and collapse facades (fixes A6, A7, part of A10)

1. Confirm with the repo owner that the 0045 harness backfill and bundle relocate have
   been applied to the production DB. Then delete `legacy_transcript_backfill.py`,
   `legacy_transcript_backfill_apply.py`, `legacy_structured_backfill.py`,
   `agent_upload_bundle_relocate.py`, and `docling_convert.py` (plus the archived-bundle
   read paths that exist only for Docling-era bundles, if the owner confirms none are
   still viewed). Git history preserves them.
2. Delete `run_existing_agent_run_stream` and its import-convention test entry.
3. Collapse `tools.py`, `tool_runtime.py`, `model_client.py`, `protocol.py` re-export
   facades: point importers at the owner modules and delete the shims. Keep `runtime.py`
   (documented monkeypatch seam) — but prune it to only the seams tests actually patch.
4. Fix `backend/docs/agent_subsystem.md` (remove `catalog_image.py` reference and the
   deleted modules).
5. Rewrite boilerplate calling specs in every file touched.

Acceptance: `rg "compatibility" backend/services/agent` returns nothing;
`check_docs_sync.py` passes; agent test suite green.

#### Phase 6: Proposal-type registry (fixes A1) — depends on Phase 1

1. Define one `ChangeTypeSpec` (frozen dataclass) per `AgentChangeType` in a new
   `backend/services/agent/change_registry.py`:
   payload model, normalizer, apply handler, proposal domain/action/CLI labels, review
   order rank, dependency-checker hook, summary formatter.
2. Derive from it: `CHANGE_PAYLOAD_MODELS`, `PAYLOAD_NORMALIZERS`,
   `APPLY_CHANGE_HANDLERS`, `proposal_metadata.py`, `reviews/ordering.py`, and the two
   inline dicts + 19-branch summary chain in `proposal_http.py` (L311-373 becomes a
   single `spec.summarize(payload)` call).
3. Replace the `benchmark_interface.py` elif chain with registry lookups.
4. Add a completeness test: every `AgentChangeType` member has a spec, and every spec
   field is non-null. This is the test that protects future maintainers.
5. Write the "add a proposal type" recipe in `docs/architecture_design.md` — it should
   be: enum member + one spec entry + one payload model + one apply function + tests.

Acceptance: adding a hypothetical change type in a test requires touching exactly the
files in the recipe; completeness test fails when a spec is missing.

#### Phase 7: Repository/side-effect separation (fixes A2, A3)

1. Add `ensure_run_finished_event` to the `RunRepository` protocol
   (`harness/repository.py`); remove both `getattr` probes from `harness.py`.
2. Introduce a `RunObserver` port (protocol with `on_run_terminal(run_result)`), composed
   in `production_runtime.py`. Move auto-approve and `notify_agent_run_terminal` out of
   `SqlAlchemyRunRepository.finish()` / `finalize_interrupt()` into observers. The
   repository persists; the runtime composition layer orchestrates.
3. Move `build_tool_call_display` calls from `harness.py` into `production_events.py`
   (the SSE mapping layer); harness events carry raw tool name + args reference only.
   Update the frontend expectation only if the SSE payload shape changes (it should not —
   display fields stay on the SSE payload).
4. Coordinate with the import workflow: `notify_agent_run_terminal` becomes an observer
   registration; fix `backend/docs/import_workflow.md`.

Acceptance: `rg "getattr\(self._repository" backend/services/agent` empty;
`production_repository.py` contains no imports from `reviews/`, `import_workflow`, or
`stream_hub`; harness has no display imports; import workflow tests still pass.

#### Phase 8: Prompt assembly consolidation (fixes A4, A8)

1. Create `backend/services/agent/prompt_assembly/` with a single entry:
   `build_turn_context(db, thread, run, principal, ...) -> TurnContext` that internally
   calls the current pieces in an explicit, linear order. `thread_context.py`,
   `message_history_content.py`, `message_history_prefixes.py`, `user_context.py` become
   its internals (move, don't wrap).
2. Move the `bh` cheat-sheet rendering out of `backend/cli/reference.py` consumption by
   `prompts.py`: extract the command specs + renderer into
   `backend/cli_reference/` (importable by both `backend/cli` and the agent prompts) or
   accept the dependency but make it one-way and documented. Pick the first unless it
   creates worse coupling.
3. Unify the rename-thread tool-gating: one function
   `tools_for_request(state) -> list[ToolDefinition]` used by both `model_gateway.py`
   and `tools_for_model_request.py`; delete the duplicate constant and logic.
4. Regenerate the prompt snapshot
   (`uv run python scripts/render_agent_system_prompt_snapshot.py`).

Acceptance: one call path builds a turn's model context; `rg "_RENAME_THREAD_TOOL_NAME"`
matches one definition; snapshot regenerated and committed.

#### Phase 9: Stream/eventing hardening (fixes A5, A9)

1. Break the `stream_hub` ↔ `production_runtime` cycle: the hub receives the execution
   callable via registration at composition time instead of importing it.
2. Route worker failure through the harness terminal path (or a shared
   `fail_run_terminally(run_id, code, detail)` helper that both use) instead of raw
   `run_row.status = FAILED` writes.
3. Unify sequence handling: one small module owns "durable sequence + ephemeral buffer"
   bookkeeping with unit tests for the reconnect/replay dedupe logic; document the
   dropped-event policy for the non-blocking `put` (either bounded queue with disconnect
   on overflow, or documented drop of ephemeral deltas only — never durable events).
4. Sweep agent broad-except handlers onto `error_policy.recoverable_result` (the ~10
   sites listed in A9); consolidate the two tenacity retry configurations into one
   policy module.
5. Document the single-process constraint prominently in
   `backend/docs/agent_subsystem.md`.

Acceptance: no lazy imports between hub and runtime; replay dedupe has direct unit tests;
`check_llm_design.py` broad-except check passes without new suppressions.

### Workstream 3 — Frontend

#### Phase 10: Generated API contracts (fixes F2, X1) — after WS1 settles schemas

1. Add codegen: `openapi-typescript` (dev dependency) generating
   `frontend/src/lib/api-types.gen.ts` from the backend's `openapi.json`; add an npm
   script (`npm run gen:api`) and a backend helper to dump the schema
   (`uv run python scripts/dump_openapi.py`).
2. Migrate `lib/types/*.ts` domain by domain to re-export/alias generated types.
   Hand-written types remain only for frontend-local view models (document which).
3. Add a freshness check to CI/scripts: regenerate and `git diff --exit-code` (wire into
   `scripts/check_docs_sync.py` or a sibling script).
4. Fix `frontend/docs/client_and_state.md` (stale `lib/api.ts`/`lib/types.ts`/
   `workspace.snapshot` references).

Acceptance: the verified drift case (`vision_capable_agent_models`) is impossible to
reintroduce — the generated type matches the backend and the freshness check fails on
drift.

#### Phase 11: Page model normalization (fixes F1)

Convert, one page per PR, to the thin-page + model-hook shape (reference:
`features/accounts/`):

1. `EntriesPage` → `features/entries/useEntriesPageModel.ts` (+ move the 10 inline
   queries/mutations; extract `kindLabel`/`kindSymbol` to `lib/format.ts` and update the
   three copies)
2. `GroupsPage` → `features/groups/useGroupsPageModel.ts` (extract `groupRangeLabel`)
3. `DashboardPage` → `features/dashboard/useDashboardPageModel.ts`
4. `AdminPage` → `features/admin/useAdminPageModel.ts` (+ add the missing tests: user
   CRUD, session revoke, impersonation adoption)
5. `EntryDetailPage` → small model hook
6. Split `usePropertiesPageModel` (548 LOC) along its existing sub-hooks so no single
   hook exceeds ~300 LOC.

Rewrite tests against the model hooks + rendered page (mock the domain API module
functions, not the whole `lib/api` barrel).

Acceptance: every `pages/*.tsx` file under ~150 LOC; no `useQuery`/`useMutation` calls in
`pages/`; duplicated label helpers exist in exactly one module.

#### Phase 12: UI primitives + dead code (fixes F6)

1. Extract one modal shell component (title/body/footer/size variants) in
   `components/ui/` and migrate the ~13 dialog implementations onto it (mechanical, one
   or two dialogs per commit).
2. Consolidate the select family: one floating-menu core with `single`, `creatable`, and
   `multi` variants replacing `SingleSelect`/`CreatableSingleSelect`/`TagMultiSelect`.
3. Delete `LineChart.tsx`, `DailyExpensePoint`, `queryKeys.auth.session`.
4. Split `styles/workspaces.css` into `entries.css`, `groups.css`, `properties.css` (or
   move styles beside their feature); delete truly-legacy workspace rules.

Acceptance: `rg "LineChart"` empty; new dialogs must be implementable only via the shared
shell (documented in the design doc); CSS files map 1:1 to features.

#### Phase 13: Error + invalidation discipline (fixes F3, F7)

1. Add `getApiErrorMessage(error: unknown): string` (ApiError-aware, status-aware) in
   `lib/api/core.ts`; replace all `(error as Error).message` sites (mechanical sweep).
2. Route the SSE/upload code paths in `lib/api/agent.ts` through the shared header/error
   helpers from `core.ts`.
3. Add `invalidateAdminReadModels` and `invalidateImportReadModels` to
   `queryInvalidation.ts`; replace ad hoc `queryClient.invalidateQueries` calls in
   `AdminPage`/import components. Add a lint-style check (grep in CI or an ESLint
   no-restricted-syntax rule) forbidding `queryClient.invalidateQueries` outside
   `lib/queryInvalidation.ts`.
4. Document the one optimistic-update recipe (setQueryData patch + invalidation on settle)
   in the design doc; the agent thread cache patches in `threadDetailCache.ts` are the
   reference implementation.

Acceptance: `rg "as Error" frontend/src` near-zero (each remaining case justified);
`rg "invalidateQueries" frontend/src --glob '!lib/queryInvalidation.ts'` empty.

#### Phase 14: Agent panel streaming simplification (fixes F4, F5)

1. Formalize `agentStreamSession` as the single stream store: a plain module store with
   `subscribe`/`getSnapshot`, consumed via `useSyncExternalStore`. Delete the dual
   React-state mirrors and both sync directions from `useAgentComposerStreamState.ts`.
2. Extract a pure reducer `applyStreamEvent(sessionState, event) -> sessionState` (the
   L426-656 switch becomes a tested pure function beside `activity.ts`). Add a `default`
   branch that logs unknown event types.
3. Complete the `AgentStreamEvent` union (add `run_started`, `model_request_started`,
   `step_committed`); add a parity test against a checked-in list of backend event types
   (replaced by generated types if phase 10 covers SSE shapes).
4. Wire `run_usage` handling (call `patchAgentThreadCachedRunUsage` from the reducer) or
   delete the helper and the event's frontend type — decide with the repo owner; do not
   leave it half-wired.
5. Collapse the ~27-prop `AgentTimeline` spread into one `timeline: AgentTimelineModel`
   prop; reduce `useAgentComposerRuntime`'s 16 callbacks by grouping into cohesive
   objects (`composerIO`, `threadCacheOps`).

Keep the existing tests green throughout — they are the safety net; extend them for the
reducer.

Acceptance: `useAgentComposerStreamState.ts` under ~250 LOC; stream state lives in exactly
one store; unknown SSE events produce a console warning in dev; reducer has direct unit
tests.

### Workstream 4 — Guardrails (make it durable)

#### Phase 15: Parity + discipline checks (fixes X2, X3)

Add to `scripts/` (and wire into the standard verification gates):

1. `check_cli_parity.py`: walks the argparse tree in `backend/cli/main.py` and asserts
   every command/subcommand has a `CommandSpec` in `reference.py` and vice versa; asserts
   the prompt snapshot is regenerated (render and diff, not banner-check).
2. SSE parity: assert the frontend `AgentStreamEvent` union covers
   `backend/enums_agent.AgentRunEventType` + `model_delta` (skip if phase 10 generation
   makes this structural).
3. OpenAPI freshness check (from phase 10) added to the gate list.
4. Frontend greps as checks: no `invalidateQueries` outside `queryInvalidation.ts`, no
   `useQuery(` in `pages/`, no `as Error` (allowlist file if needed).
5. Extend `check_llm_design.py`: flag the known boilerplate calling-spec pattern
   (`Purpose: implement focused service logic for`) as a violation; add an 800-LOC cap
   for test files with a temporary allowlist of the 6 current offenders so the list can
   only shrink.
6. Update `AGENTS.md` verification gates to include the new scripts.

Acceptance: intentionally breaking each parity (add an argparse command without a spec;
add a backend event type) fails the corresponding check.

#### Phase 16: Documentation convergence

1. Update `docs/architecture.md`, `docs/repository_structure.md`,
   `backend/docs/agent_subsystem.md`, `frontend/docs/*.md` to the post-refactor reality.
2. Verify the recipes in `docs/architecture_design.md` against the final code (add a
   field, add a proposal type, add a `bh` command, add a page, add an SSE event) — each
   recipe must be executable as a literal checklist.
3. Move this task doc to `docs/completed_tasks/`.

Acceptance: `check_docs_sync.py` passes; a fresh agent given only the design doc and a
recipe can perform the corresponding change without reading this plan.

---

## 6. Risks and mitigations

- **Deleting the backfills (P5) is irreversible against a drifted DB.** Mitigation:
  explicit owner confirmation + DB snapshot (`benchmark/snapshot.py` tooling) before
  deletion.
- **Registry consolidation (P6) touches the review pipeline** — the most
  correctness-sensitive area (money mutations). Mitigation: the registry derives the
  existing dicts first (assert-equal against the old structures in a transition test),
  then the old structures are deleted in the same PR once equality is proven.
- **Frontend stream refactor (P14) risks UX regressions invisible to unit tests**
  (reconnect timing, optimistic message dedupe). Mitigation: the existing 700-LOC panel
  and timeline tests must pass unchanged before any test is rewritten; manual smoke of
  send/interrupt/reconnect/refresh flows per PR.
- **Codegen (P10) can freeze bad names.** Mitigation: run it after WS1 renames settle;
  treat the first generation as a schema review checkpoint.
- **Parallel work collision**: WS2-P7 and WS1-P3 both touch import workflow error/notify
  seams. Sequence P3 before P7 or assign to one person.

## 7. Explicit non-goals

- No multi-process/distributed stream hub (single-process is a documented constraint).
- No new features, no schema/data-model changes beyond field-name alias cleanup in P1.
- No iOS or Telegram changes; backend pydantic schema classes consumed by `telegram/`
  keep their import paths (grep `telegram/` before renaming any `backend/schemas_*`
  symbol).
- No styling redesign — CSS work in P12 is ownership/naming only.

---

## Outcome

All 16 phases executed. Verification baselines at completion: backend 509 tests passed;
frontend 275 tests passed with `tsc` clean.

Key deviations from the original plan wording:

- **Entries HTTP contracts:** command models live in `backend/contracts_entries.py`, but
  HTTP schemas stay flat (wire field names/refs differ). Routers and agent apply convert
  explicitly instead of schema inheritance (`GroupCreate(GroupCreateCommand)` remains the
  inheritance reference for domains where wire shapes match).
- **Docling:** write path and `docling_convert.py` deleted; pre-2026 Docling-era bundle
  read paths (`parsed.md`) retained in `attachment_content_assembly.py` pending data
  migration.
- **SSE parity:** enforced by `scripts/check_sse_parity.py` against
  `KNOWN_AGENT_STREAM_EVENT_TYPES` in `frontend/src/lib/types/agent.ts` (not a generated
  OpenAPI type).
- **Run terminal observers:** worker-failure and interrupt paths notify the import
  scheduler and emit `run_finished` SSE via `run_observers.py` (not only normal harness
  finish).
