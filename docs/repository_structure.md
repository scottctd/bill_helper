# Repository Structure (Current)

## Root

- `.gitignore`: ignores venv, build outputs, runtime data, test cache.
- `.env.example`: env-var template with all supported variables (committed; no secrets).
- `.python-version`: local Python version hint.
- `README.md`: top-level onboarding, setup, and dev loop.
- `AGENTS.md`: short coding-agent working agreement plus links to canonical docs.
- `pyproject.toml`: Python package metadata, dependencies, scripts, pytest config.
- `uv.lock`: locked Python dependency graph for `uv`.
- `alembic.ini`: Alembic runtime/logging configuration.
- `docker/`: legacy Docker workspace artifacts plus packaging experiments.
- `ios/`: SwiftUI iOS MVP workspace containing the app shell target, shared mobile core sources, feature surfaces, `ios/docs/` client notes, and focused API/unit tests.
- `telegram/`: top-level Telegram transport package with `telegram/README.md`, `telegram/docs/` implementation notes, config, PTB application/handler wiring, the `telegram/ptb.py` import-collision shim/re-export for `python-telegram-bot`, polling/webhook intake adapters, file/reply helpers, and targeted tests for the bot integration surface.

## Migration Layer (`/alembic`)

- `env.py`: Alembic environment setup and metadata wiring.
- `script.py.mako`: migration template.
- `versions/0001_initial.py`: baseline schema migration.
- `versions/0002_entities_and_entry_entity_refs.py`: entity table + entry entity reference migration.
- `versions/0003_entity_category.py`: entity category column migration.
- `versions/0004_users_and_account_entity_links.py`: users table, account<->entity link, and entry owner->user migration.
- `versions/0005_remove_attachments.py`: removes legacy attachment table/endpoints.
- `versions/0006_agent_append_only_core.py`: introduces agent thread/run/tool-call/change-item/review tables.
- `versions/0007_taxonomy_core.py`: introduces taxonomy/taxonomy_terms/taxonomy_assignments and backfills entity categories.
- `versions/0008_agent_run_usage_metrics.py`: adds run usage token columns.
- `versions/0009_remove_entry_status.py`: drops the obsolete entry `status` column.
- `versions/0010_runtime_settings_overrides.py`: adds persisted runtime settings override table (`runtime_settings`).
- `versions/0011_remove_openrouter_runtime_settings_fields.py`: removes legacy OpenRouter-specific runtime settings columns.
- `versions/0012_remove_related_link_type.py`: migrates legacy `RELATED` entry links to `BUNDLE` and removes `RELATED` from `LinkType`.
- `versions/0013_add_account_markdown_body.py`: adds optional account-level markdown notes (`accounts.markdown_body`).
- `versions/0014_remove_account_institution_type.py`: drops legacy account columns (`accounts.institution`, `accounts.account_type`).
- `versions/0015_add_agent_tool_call_output_text.py`: adds persisted model-visible tool output text (`agent_tool_calls.output_text`).
- `versions/0016_add_user_memory_to_runtime_settings.py`: adds optional persistent agent memory storage to runtime settings (`runtime_settings.user_memory`).
- `versions/0017_rename_tag_category_taxonomy.py`: migrates tag taxonomy key/display naming from category to type (`tag_category` -> `tag_type`).
- `versions/0018_add_tag_description.py`: adds optional free-text tag description (`tags.description`).
- `versions/0019_add_transfer_entry_kind.py`: documents addition of `TRANSFER` to `EntryKind` enum (no DDL change for SQLite).
- `versions/0020_add_agent_message_attachment_original_filename.py`: adds optional upload-name storage for agent attachments (`agent_message_attachments.original_filename`) and safely no-ops if the column already exists in a drifted local DB.
- `versions/0021_add_agent_run_context_tokens.py`: adds nullable prompt-size snapshots for agent runs (`agent_runs.context_tokens`) and safely no-ops if the column already exists.
- `versions/0022_agent_run_events_and_tool_lifecycle.py`: adds persisted run-event timeline rows (`agent_run_events`) and expands `agent_tool_calls` with lifecycle metadata (`llm_tool_call_id`, `started_at`, `completed_at`, queued/running/cancelled states).
- `versions/0023_add_agent_provider_config.py`: adds custom provider configuration fields to runtime settings (`agent_base_url`, `agent_api_key`).
- `versions/0024_entity_root_accounts.py`: rebuilds accounts as entity-root records by rekeying `accounts.id` to shared `entities.id` values and updating dependent account references.
- `versions/0025_user_memory_json_list.py`: normalizes persisted runtime user memory into JSON list form for prompt rendering and add-only appends.
- `versions/0026_entry_groups_v2.py`: replaces link-derived groups with first-class typed groups and membership rows, migrates compatible legacy linked components, and removes `entries.group_id` plus `entry_links`.
- `versions/0027_add_agent_bulk_concurrency_setting.py`: adds persisted Bulk mode concurrency control to runtime settings (`agent_bulk_max_concurrent_threads`).
- `versions/0028_add_available_agent_models_to_runtime_settings.py`: adds persisted ordered runtime model-list overrides (`runtime_settings.available_agent_models`).
- `versions/0029_add_agent_run_surface.py`: adds persisted run surface hints for Telegram-aware agent execution and reply reads.
- `versions/0030_add_account_agent_change_types.py`: expands the agent review enum to persist account create/update/delete proposal types.
- `versions/0031_add_user_is_admin.py`: adds the persisted `users.is_admin` role gate used by principal resolution and admin-only route checks.
- `versions/0032_add_filter_groups.py`: adds principal-owned saved filter-group definitions for dashboard classification and analytics slices.
- `versions/0033_multi_user_security.py`: adds password hashes and sessions, makes owned resources explicitly user-scoped, and migrates user deletion to cascade semantics.
- `versions/0034_add_entry_tagging_model_to_runtime_settings.py`: adds the optional runtime override for inline AI entry tag suggestions (`runtime_settings.entry_tagging_model`).
- `versions/0035_add_user_files_and_agent_workspace.py`: adds the canonical `user_files` registry and rewires historical agent attachments to it.
- `versions/0036_add_agent_run_created_at_index.py`: adds an index on `agent_runs.created_at` for range-based agent dashboard analytics reads.
- `versions/0046_entry_category_lifecycle.py`: replaces tag/filter-group expense partitioning with entry-category assignments and lifecycle values.
- `versions/0047_entry_category_schedule.py`: installs the canonical entry-category schedule and remaps legacy assignments to safe fallback leaves.
- `versions/0048_remove_builtin_filter_groups.py`: removes persisted built-in filter groups while retaining custom groups.
- `versions/0049_unified_groups.py`: merges legacy `entry_groups` and `filter_groups` into unified `groups` and `group_members` with `manual` and `rule` sources.
- `versions/0050_add_agent_model_reasoning_efforts.py`: adds the optional per-model reasoning-effort JSON map to runtime settings.
- `versions/0037_add_agent_message_attachments_use_ocr.py`: adds persisted message-level OCR mode for attachment-bearing user turns.
- `versions/0038_add_agent_model_display_names_to_runtime_settings.py`: adds optional JSON map of model id → UI label (`runtime_settings.agent_model_display_names`).
- `versions/0039_add_agent_run_approval_policy.py`: adds `agent_runs.approval_policy` (`default` vs `yolo`) for optional post-run auto-approval.
- `versions/0040_add_agent_session_sources.py`: adds external-agent session summaries, session-source links, and the runtime PDF page limit.
- `versions/0041_add_agent_run_event_reasoning_duration_ms.py`: adds optional `reasoning_duration_ms` on `agent_run_events` for collapsed model-reasoning summaries.
- `versions/0042_remove_entry_account_id.py`: backfills missing `from_entity_id` / `to_entity_id` links from legacy `entries.account_id`, then drops the column.
- `versions/0043_add_import_workflow.py`: adds `import_jobs` and `import_tasks` for backend-orchestrated multi-file import jobs.
- `versions/0044_remove_agent_change_item_rationale_text.py`: drops unused `agent_change_items.rationale_text`.
- `versions/0045_agent_harness_first_schema.py`: validated full conversation port into the harness-first transcript, step, tool-call, and event schema.
- `versions/__init__.py`: package marker.

## Backend (`/backend`)

- `__init__.py`: package marker.
- `config.py`: settings model and environment variable binding.
- `__main__.py`: package-local launcher (`python -m backend`).
- `db_meta.py`: side-effect-free SQLAlchemy metadata root (`Base`).
- `database.py`: explicit SQLAlchemy engine/session factories plus cached runtime accessors/dependencies.
- `enums_finance.py`: ledger enums (`EntryKind`, `EntryLifecycle`, `GroupSource`, `GroupMemberOverride`).
- `enums_agent.py`: agent run/review/message enums.
- `enums_import.py`: import job/task status enums.
- `models_finance.py`: ledger/account/entity/tag/taxonomy/group ORM models.
- `models_agent.py`: harness-first agent ORM models for threads, runs, canonical transcript rows, steps, tool calls, events, and review items.
- `models_import.py`: import job/task ORM models.
- `models_files.py`: canonical per-user durable file registry ORM model.
- `models_settings.py`: runtime settings ORM model and table mapping.
- `contracts_groups.py`: shared group create/update contracts and the typed group-member target payload used by schemas, routers, services, and group-member apply flows.
- `contracts_entries.py`: shared entry create/update commands plus typed entity/user refs used by services, agent apply, and agent proposal contracts.
- `contracts_users.py`: shared user create/update contracts reused by schemas, routers, and services.
- `contracts_settings.py`: shared runtime-settings write contract used by both schema and service layers.
- `models_shared.py`: shared model defaults (`utc_now`, `uuid_str`) used by both model domains.
- `schemas_finance.py`: ledger, group, and dashboard request/response schemas.
- `schemas_group_rules.py`: recursive group rule tree schemas shared by contracts, services, and API layers.
- `schemas_agent.py`: agent thread/turn/run/step/review request/response schemas.
- `schemas_agent_sessions.py`: external-agent session and source request/response schemas.
- `schemas_import.py`: import workflow request/response schemas.
- `schemas_auth.py`: auth, admin-user, and admin-session request/response schemas.
- `schemas_settings.py`: runtime settings request/response schemas.
- `auth/`: request-principal contracts, explicit dev-session header parsing, and FastAPI auth dependencies.
- `cli/`: `bh` command entrypoint, auth/session/source command groups, output rendering, and HTTP client support for hosted and external agents.
- `cli_reference/`: shared `bh` command specs, compact output schemas, and cheat-sheet renderers (imported by CLI formatters and agent prompts; replaces the former `cli/reference.py`).
- `validation/`: neutral validation/normalization helpers plus shared contract field types used by schemas, services, and tool-input models.
- `main.py`: FastAPI app creation, routing, CORS, health check.
- `README.md`: thin backend-local navigation doc that points to canonical docs.
- `docs/`: package-local backend subsystem docs (`README.md`, `runtime_and_config.md`, `domain_and_http.md`, `agent_subsystem.md`, `operations.md`).

### Backend Routers (`/backend/routers`)

- `accounts.py`: accounts, account deletion, snapshots, reconciliation endpoints.
- `auth.py`: login/logout/current-session endpoints.
- `admin.py`: admin user/session management and impersonation endpoints.
- `users.py`: visible-user reads plus self-service password change.
- `entries.py`: entry CRUD and tag-suggestion HTTP adapters; list/detail reads delegate to `entries_read.py`.
- `entities.py`: entity list/create/update/delete endpoints for entry selectors/properties.
- `tags.py`: tag list/create/update/delete endpoints for property/tag selectors.
- `taxonomies.py`: taxonomy/term list and term create/rename endpoints.
- `currencies.py`: currency catalog placeholder endpoint for selector/property tables.
- `groups.py`: unified group CRUD, membership mutation, and read-model summaries for manual and rule groups.
- `dashboard.py`: monthly analytics endpoint.
- `agent.py`: append-only agent thread/message/run/review endpoints.
- `settings.py`: runtime settings read/update endpoints backed by `models_settings.py` / `schemas_settings.py`, with env fallback where applicable and DB-backed list-form `user_memory`.
- `agent_sessions.py`: external-agent session CRUD plus text/file source attachment endpoints.
- `import_jobs.py`: import preflight, job lifecycle, and aggregated proposal review endpoints.
- non-admin principal scope applies to owned-resource routes (`accounts`, `entries`, `users`, `groups`, `dashboard`).
- shared dictionary mutation routes (`entities`, `tags`, `taxonomies` POST/PATCH, plus entity and tag DELETE) require admin principal.

### Backend Services (`/backend/services`)

- `accounts.py`: account create/update/delete workflows for shared account/entity roots.
- `entries.py`: typed entry create/update workflows, HTTP-to-command adapters, tag handling, manual group assignment, and entry soft-delete helper.
- `entries_read.py`: entry list filters, queries, and read-model assembly (`list_entries_for_principal`, `get_entry_detail_for_principal`).
- `group_membership.py`: effective membership resolution plus request-scoped `GroupMembershipContext` snapshots shared by entry and group reads.
- `group_rules.py`: recursive rule evaluation and plain-language summaries for rule groups.
- `groups.py`: group CRUD, membership validation, summaries, and rule-group persistence.
- `finance_contracts.py`: service-owned account/entity/tag write commands shared across routers and agent apply flows.
- `tags.py`: tag CRUD helpers, taxonomy cleanup, and random default color generation.
- `entities.py`: entity normalization, account-backed guards, usage queries, and `EntityRead` builders.
- `currencies.py`: currency catalog reads from scoped entry aggregates.
- `users.py`: user normalization, lookup, and current-user helpers.
- `principals.py`: request-principal materialization from a persisted user row plus optional session row.
- `passwords.py`: Argon2 hashing and reset-required password helpers.
- `sessions.py`: session creation, lookup, and revocation.
- `groups.py`: group CRUD, membership validation, and read-model generation.
- `finance_dashboard.py`: dashboard query orchestration and monthly trend reads.
- `finance_dashboard_rollups.py`: deterministic category, lifecycle, rule-group, KPI, projection, and breakdown rollups.
- `crud_policy.py`: shared CRUD validation/conflict policy primitives and standardized error-translation helpers.
- `serializers.py`: ORM-to-schema mapping helpers.
- `taxonomy.py`: shared taxonomy normalization, term assignment, and usage-count helpers.
- `runtime_settings.py`: resolves effective runtime settings from persisted overrides + env defaults, including DB-backed ordered `user_memory`, `available_agent_models`, optional model display-name and reasoning-effort maps, and the PDF page cap.
- `services/agent/runtime_settings_view.py`: builds the settings read view with agent-derived fields for `GET/PATCH /settings`.
- `services/agent/runtime_settings_validation.py`: vision-capable model filtering and LiteLLM credential checks for settings reads.
- `user_files.py`: canonical per-user upload path management, atomic writes/imports, hashing, and readable stored-filename helpers.
- `import_workflow/`: backend-orchestrated import jobs (`jobs.py`, `preflight.py`, `scheduler.py`, `proposals.py`, `dedup.py`, `serializers.py`).
- `agent/`: harness-first agent runtime, canonical transcript persistence, tool execution, prompt-size counting, serialization, prompt/model adapters, and review apply handlers.
  - `tool_args/`: focused tool-input package for read filters, thread rename, and pending-proposal admin wrappers.
  - `session_tools/`: session-scoped non-proposal tool handlers for add-only memory appends and thread rename operations.
  - `threads.py`: thread lookup and rename persistence helpers used by the router and tool runtime.
  - `protocol_helpers.py`: shared helper contracts for tool-call decoding and usage-shape normalization.
  - `error_policy.py`: shared recoverable-error policy/result primitives and contextual fallback logging.
  - `harness/`: product-native `AgentHarness` coordinator, contracts, transcript helpers, step executor, and event/repository protocols.
  - `production_runtime.py`: compose production harness with DB repository, model gateway, tools, stop signal, and SSE fan-out.
  - `production_repository.py`: SQLAlchemy `RunRepository` for canonical transcript, steps, tool calls, and harness events.
  - `production_events.py`: map harness events to client SSE payloads.
  - `model_gateway.py`: LiteLLM completion adapters used by the harness model gateway.
  - `api_projection.py`: derive API `turns` and thread-detail projections from canonical transcript rows plus per-run work records.
  - `prompt_assembly/`: per-turn model context pipeline (`thread_context.py`, `message_history_content.py`, `message_history_prefixes.py`, `user_context.py`, `prompts.py`); Jinja templates stay in the parent `agent/` directory.
  - `execution.py`: HTTP/background intake for user turns and harness run startup.
  - `attachments.py`: message-to-canonical-file linkage helpers for attachment rows.
  - `attachment_content.py`: public attachment-content seam plus vision capability checks.
  - `agent_attachment_bundle.py`: dated upload bundle paths, vision page rendering, and bundle path helpers
  - `work_sessions.py`: external-agent session/source persistence plus synthetic CLI run ownership for proposal creation
  - `attachment_content_assembly.py`: attachment display-name, data-url, and model-content assembly helpers (includes the pre-2026 Docling-era `parsed.md` read path for historical bundles).
  - `runtime.py`: public facade over harness execution plus stable test/benchmark monkeypatch seams.
  - `stream_hub.py`: in-process single-worker SSE hub with reconnect replay over persisted harness events and ephemeral `model_delta` buffers; executor wired via `register_run_executor()` from `production_runtime.py`.
  - `stream_sequences.py`: durable hub sequence + ephemeral buffer state, fan-out drop policy, and reconnect dedupe helpers.
  - `retry_policy.py`: shared tenacity retry builders for model client and tool runtime.
  - `run_observers.py`: production `RunObserver` registrations and `fail_run_terminally` helper.
  - `tools_for_model_request.py`: single gate (`expose_tools_for_model_request`) for per-request tool schema exposure.
  - `change_registry.py` + `change_summaries.py`: one `ChangeTypeSpec` per `AgentChangeType`.
  - `entry_references.py`: shared entry-id alias, selector lookup, and public entry snapshot helpers.
  - `group_references.py`: shared group-id alias lookup plus public group summary/detail formatting for group tools and review payloads.
  - `proposals/`: proposal-family helpers split into `common.py`, `catalog.py`, `entries.py`, `groups.py`, the `group_memberships/` package (`common.py`, `validation.py`, `handlers.py`), family-owned normalization modules plus a small `normalization.py` registry, and `pending.py`.
  - `proposal_metadata.py`: canonical proposal domain/action/tool-name mapping shared by list/history/review surfaces.
  - `tool_runtime_support/`: grouped tool-runtime internals split into tool definitions, schema inlining, family registries, merged registry composition, and retry/error execution policy.
  - `benchmark_interface.py`: stable benchmark execution contract returning normalized predictions/trace data.
  - `change_contracts/`: proposal payload contracts split into `catalog.py`, `entries.py`, `groups.py`, shared normalization in `common.py`, and registry/patch helpers in `__init__.py` + `patches.py`.

### Backend Tests (`/backend/tests`)

- `conftest.py`: test app/client setup with isolated SQLite DB.
- `agent_test_utils.py`: shared agent test harness helpers (model patching, thread/message flows, SSE parsing, PDF fixture builders).
- `test_entries.py`: entry/group/delete behavior tests, including unified-group validation and principal scoping.
- `test_finance.py`: reconciliation and dashboard aggregation tests.
- `test_migrations_core.py`: migration regression coverage, including unified-group migration `0049_unified_groups` and per-model reasoning settings migration `0050_add_agent_model_reasoning_efforts`.
- `test_taxonomies.py`: taxonomy endpoints and tag/entity category assignment behavior tests.
- `test_auth_boundaries.py`: app-level principal dependency boundary regression tests.
- `test_agent_sessions.py`: external-agent session/source and CLI proposal ownership coverage.
- `test_benchmark_seed_workflows.py`: benchmark/seed workflow regression tests.

## Frontend (`/frontend`)

- `package.json`: npm scripts and frontend dependencies.
- `package-lock.json`: locked npm dependencies.
- `vite.config.ts`: dev server config and API proxy.
- `vitest.config.ts`: frontend unit test runner configuration (`jsdom` + RTL setup).
- `tsconfig.json`: TypeScript compiler settings.
- `index.html`: Vite app shell.
- `README.md`: thin frontend-local navigation doc that points to canonical docs.
- `docs/`: package-local frontend subsystem docs (`README.md`, `app_shell_and_routing.md`, `client_and_state.md`, `workspaces.md`, `agent_workspace.md`, `styles_and_operations.md`).

### Frontend Source (`/frontend/src`)

- `main.tsx`: React root and providers, including the auth provider.
- `App.tsx`: top-level shell layout (sidebar + content) and route map.
- `styles.css`: import barrel for the split global stylesheet modules under `styles/`.
- `styles/`: `tokens.css`, `base.css`, `shell.css`, `sections.css`, `entries.css`, `groups.css`, `properties.css`, `settings.css`, `dashboard.css`, `overlays.css`, `agent.css`, `review.css`, and import-* sheets.
- `test/`: frontend test setup, typed fixture factories, and shared query-client test renderer.

#### Components (`/frontend/src/components`)

- `Sidebar.tsx`: collapsible left-panel navigation with icon+label links and the active-principal switcher.
- `MetricCard.tsx`: reusable metric container.
- `GroupEditorModal.tsx`: create/rename dialog for manual groups.
- `GroupDetailModal.tsx`: wide group-detail modal for manual-group inspection and membership management.
- `GroupMemberEditorModal.tsx`: add-member dialog for manual groups.
- `TagMultiSelect.tsx`: Notion-style chip/dropdown multi-select for entry tags (uses `ui/floating-select/` core).
- `SingleSelect.tsx` / `CreatableSingleSelect.tsx`: searchable and creatable single-select controls sharing the floating-select core.
- `DeleteConfirmDialog.tsx`: shared destructive confirmation dialog built on `ui/modal-shell.tsx`.
- `EntryEditorModal.tsx`: shared popup for entry create/edit, including manual-group assignment.
- `MarkdownBlockEditor.tsx`: BlockNote wrapper for markdown + pasted images.
- `agent/AgentRunBlock.tsx`: extracted run activity/summary renderer used by `AgentPanel`.
- `agent/activity.ts`: extracted run/activity derivation helpers for agent timeline state.
- `agent/review/model.ts`: review-item summaries, proposal-domain grouping, and shared change-type labels.
- `agent/panel/*`: agent panel presentation layer (`AgentThreadList`, `AgentThreadPanel`, `AgentTimeline`, `AgentComposer`, `AgentThreadUsageBar`, `AgentAttachmentPreviewDialog`) plus the coordinator hooks (`useAgentPanelController`, `useAgentPanelQueries`, `useAgentThreadActions`, `useAgentComposerRuntime`), composer-runtime support hooks (`useAgentComposerStreamState`, `useAgentComposerActions`), the module stream store (`agentStreamSession.ts`), pure SSE reducer (`streamReducer.ts`), stream effect runner (`runAgentStreamEffects.ts`), grouped timeline view-model types (`agentTimelineModel.ts`), panel-local hooks (`useResizablePanel`, `useStickToBottom`, `useAgentDraftAttachments`), and type/format helpers.
- `agent/review/*`: thread-review modal shell plus split modal presentation modules (`ReviewModalHeader`, `ReviewModalControls`), the read-only review controller (`useAgentThreadReviewController.ts`), and diff record-shaping packages (`diff/core.ts`, `domains.ts`) consumed by shared field builders.
- `review/*`: shared proposal review shell (`ReviewPanel.tsx`), unified read-only detail card (`ReviewItemCard.tsx`, `ReviewSummary.tsx`, `ReviewContextList.tsx`, `ReviewOutcomeList.tsx`, `ReviewFieldList.tsx`, `proposalSummary.ts`, `proposalContext.ts`, `proposalOutcome.ts`, `proposalFields.ts`), detail card header (`ReviewCardHeader.tsx`, `cardMetadata.ts`), hierarchical TOC (`ReviewToc.tsx`, `tocTree.ts`, `entryTocFields.ts`), styling/grouping helpers (`helpers.ts`), and mappers for import (`mapImportProposal.ts`) and agent thread items (`mapThreadReviewItem.ts`).

#### Pages (`/frontend/src/pages`)

- `DashboardPage.tsx`: tabbed category/lifecycle analytics dashboard backed by Recharts.
- `LoginPage.tsx`: password sign-in page for the browser app.
- `AdminPage.tsx`: admin-only user/session management workspace.
- `WorkspacePage.tsx`: legacy current-user workspace IDE shell retained without an active app route.
- `SettingsPage.tsx`: thin runtime-settings page shell that composes the `features/settings` controller and section modules.
- `EntriesPage.tsx`: thin page orchestrator that composes the entries feature model and table.
- `EntryDetailPage.tsx`: thin page orchestrator for entry detail and popup editing.
- `GroupsPage.tsx`: thin page orchestrator that composes the groups feature model and browser table.
- `DashboardPage.tsx`: thin page orchestrator that composes dashboard period controls and tab panels.
- `AdminPage.tsx`: thin admin page orchestrator for user CRUD, session revoke, and impersonation.
- `AdminPage.test.tsx`: page-level integration tests for admin user CRUD, session revoke, and login-as adoption.
- `AccountsPage.tsx`: thin page orchestrator that composes accounts feature modules.
- `PropertiesPage.tsx`: thin page orchestrator that composes properties feature modules.
- `AccountsPage.test.tsx`: page-level integration tests for account create, snapshot, and delete flows.
- `EntriesPage.test.tsx`: page-level integration tests for missing-entity markers in the entries table.
- `PropertiesPage.test.tsx`: page-level integration tests for taxonomy and property delete flows.
- `WorkspacePage.test.tsx`: legacy page-level integration tests for workspace IDE launch, degraded states, and narrow-screen fallback.

#### Feature Modules (`/frontend/src/features`)

- `auth/`
  - `storage.ts`: localStorage-backed bearer token helpers.
  - `AuthProvider.tsx`: app-wide auth context, `/auth/me` bootstrap, login, logout, and impersonation token adoption.
  - `AuthSessionCard.tsx`: sidebar logout control that reflects the signed-in user.
- `accounts/`
  - `useAccountsPageModel.ts`: query/mutation orchestration, derived state, and action handlers.
  - `AccountsTableSection.tsx`: account table/search/selection UI.
  - `ReconciliationSection.tsx`: account reconciliation summary UI.
  - `SnapshotCreatePanel.tsx`: snapshot-create form shown in the account edit modal sidebar.
  - `SnapshotHistoryTable.tsx`: snapshot history table shown in the account edit modal history column.
  - `AccountDialogs.tsx`: create/edit account dialog UI.
  - `helpers.ts`, `types.ts`: normalization helpers and local state contracts.
- `entries/`
  - `useEntriesPageModel.ts`: entries list queries, filters, editor mutations, and infinite-scroll wiring.
  - `useEntryDetailPageModel.ts`: entry detail queries and update mutation for the detail route.
  - `EntriesTable.tsx`: entries table, load-more footer, and row presentation helpers.
  - `EntriesFilterToolbar.tsx`, `entriesFilters.ts`, `entriesDisplayHelpers.ts`: filter toolbar, URL sync, and display helpers.
- `groups/`
  - `useGroupsPageModel.ts`: group browser queries, detail modal state, and membership/entry-editor mutations.
  - `GroupsBrowserTable.tsx`: searchable groups table with detail open actions.
  - `GroupsTableToolbar.tsx`, `GroupRuleEditorSection.tsx`: toolbar and embedded rule editor UI.
- `dashboard/`
  - `useDashboardPageModel.ts`: dashboard queries, period selection, derived chart/KPI state, and batch cache seeding.
  - `DashboardFinanceChrome.tsx`: summary hero, trend chart, and period toolbar shell.
  - `DashboardPeriodControls.tsx`, `DashboardPanels.tsx`, `DashboardBreakdownsPanel.tsx`, `helpers.ts`: dashboard panels and chart helpers.
- `admin/`
  - `useAdminPageModel.ts`: admin user/session queries, drafts, and CRUD/revoke/impersonation mutations.
  - `AdminUsersSection.tsx`, `AdminSessionsSection.tsx`: user management and session revoke UI sections.
- `properties/`
  - `usePropertiesPageModel.ts`: top-level properties coordinator composing query/state/mutation hooks.
  - `usePropertiesTagMutations.ts`, `usePropertiesEntryCategoryMutations.ts`, `usePropertiesEntityTaxonomyMutations.ts`: focused mutation and action hooks.
  - `usePropertiesQueries.ts`: users/entities/tags/currencies/taxonomy queries + derived option/label state.
  - `usePropertiesSectionState.ts`: section routing/search/create-panel state.
  - `usePropertiesFormState.ts`: section form/editing state.
  - `usePropertiesFilteredData.ts`: filtered list derivation by section search state.
  - `sections/*.tsx`: dedicated users/entities/tags/currencies/taxonomy section UI blocks.
  - `helpers.ts`, `types.ts`: filtering/taxonomy helpers and section contracts.
- `settings/`
  - `useSettingsPageModel.ts`: runtime-settings query/mutation orchestration, tab state, and form patch actions.
  - `formState.ts`: runtime-settings form hydration, validation, and update-payload construction.
  - `SettingsToolbar.tsx`, `SettingsGeneralSection.tsx`, `SettingsAgentSection.tsx`, `ResetSettingsDialog.tsx`: settings workspace UI sections and dialogs.
  - `constants.ts`, `types.ts`: shared settings field ids, tab definitions, and form-state contracts.
- `import/`
  - `ImportWorkspace.tsx`: import job list/create/detail shell.
  - `ImportCreatePanel.tsx`: upload, preflight re-import chooser, and job start.
  - `ImportJobDetailView.tsx`: progress, task grid, aggregated proposals, job actions.
  - `ImportTaskDialog.tsx`, `useImportTaskTimeline.ts`: per-task timeline popup with SSE reconnect.

#### Frontend Lib (`/frontend/src/lib`)

- `../openapi.json`: committed OpenAPI snapshot dumped from the backend (`scripts/dump_openapi.py`).
- `api-types.gen.ts`: generated TypeScript schemas (`npm run gen:api` / `openapi-typescript`).
- `types/`: domain modules that alias generated schemas; hand-written types only for frontend-local view models.
- `types.ts`: compatibility barrel re-exporting domain type modules.
- `api.ts`: fetch wrappers and API request functions, including shared bearer-token injection plus admin/auth helpers.
- `api/import.ts`: import preflight, job lifecycle, and aggregated proposal review helpers.
- `collections.ts`: helpers such as `listOrEmpty` for optional generated list fields.
- `format.ts`: money formatting, date helpers, entry kind labels, and group date-range labels.
- `queryKeys.ts`: centralized TanStack Query key factory for all domains.
- `queryInvalidation.ts`: shared cache invalidation rules after mutations/review actions, including group-driven entry/group refresh.

## Supporting Directories

- `/docs`: architecture and engineering documentation.
  - `README.md`: canonical index for the docs tree.
  - `backend_index.md`, `frontend_index.md`, `ios_index.md`, `telegram_index.md`, `api.md`: subsystem index docs.
  - `/api`: focused API topic docs.
  - `/features`: cross-cutting feature docs and feature index.
  - `documentation_system.md`: source-of-truth matrix + anti-drift workflow.
  - `/completed_tasks`: archived task docs, retrospectives, and fix logs.
  - `features/entry_lifecycle.md`: entry-domain flow map.
  - `features/dashboard_analytics.md`: dashboard flow map.
  - `features/account_reconciliation.md`: account workspace + snapshot/reconciliation flow map.
  - `/adr`: architecture decision records.
- `/tasks`: active implementation plans, temporary caveats, and migration checklists.
- `/skills/frontend-ui-builder/SKILL.md`: project-local frontend build skill focused on shared layout primitives, explicit scroll/overlay ownership, concise copy, and preserving bespoke high-value interactions.
- `/skills/desloppify-maintenance/SKILL.md`: project-local desloppify workflow skill for exclude review, queue-driven fix loops, and standards-log updates during cleanup campaigns.
- `/scripts/seed_defaults.py`: reset local DB and seed default tags, entity categories, and accounts; optional user-memory copy now has explicit error policy (`best_effort` default, optional `fail_fast`) and shared DB factory usage.
- `/scripts/seed_demo.py`: local seed dataset generation.
- `/scripts/download_bank_statements.py`: headed Chrome bank-export downloader with manual login plus local JSON recipes under `/scripts/bank_download/recipes/` (gitignored except `template.example.json`; see `/scripts/bank_download/README.md`).
- `/scripts/bootstrap_admin.py`: create or reset an admin password-backed login and upgrade the database to head when needed.
- `/scripts/setup_shared_env.sh`: copies `.env` (or `.env.example`) to `~/.config/bill-helper/.env` for cross-worktree secret sharing.
- `/scripts/check_docs_sync.py`: docs consistency checks (migration refs + stale term detection + index links).
- `/scripts/dump_openapi.py`: dump the FastAPI OpenAPI schema to `frontend/openapi.json`.
- `/scripts/check_api_types_sync.py`: verify `frontend/openapi.json` and `frontend/src/lib/api-types.gen.ts` match the live backend schema.
- `/.data` (runtime, legacy): per-worktree SQLite DB override location (ignored in git). Default data location is `~/.local/share/bill_helper/`.

## Benchmark (`/benchmark`)

Agent import benchmark framework for evaluating LLMs on bank-statement-to-entry extraction.

- `snapshot.py`: create/restore/list DB snapshots.
- `create_empty_snapshot.py`: create default snapshot with accounts, tags, entity categories.
- `runner.py`: run benchmark cases against a model (parallel via `ProcessPoolExecutor`).
- `scorer.py`: match predicted entries to ground truth, compute field-level and aggregate scores, compare models.
- `generate_ground_truth.py`: run a capable model to produce draft ground truth for manual editing.
- `schemas.py`: Pydantic schemas for case input, ground truth, and result data.
- `README.md`: benchmark usage guide.
- `fixtures/` (gitignored): DB snapshots and benchmark cases (private data).
- `results/` (gitignored): run outputs, interaction traces, per-case scores (private).
- `reports/` (tracked): aggregate metrics and comparison reports (public).
