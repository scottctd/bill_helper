# Data Model

All data is persisted in SQLite via SQLAlchemy.

## Enum Types

Core:

- `EntryKind`: `EXPENSE`, `INCOME`, `TRANSFER`
- `GroupType`: `BUNDLE`, `SPLIT`, `RECURRING`
- `GroupMemberRole`: `PARENT`, `CHILD`

Legacy note:

- `LinkType` remains in code only to support pre-`0026_entry_groups_v2` migration logic; active group storage no longer persists `entry_links`

Agent:

- `AgentTranscriptRole`: `system`, `user`, `assistant`, `tool`
- `AgentRunStatus`: `running`, `completed`, `interrupted`, `max_steps`, `failed`
- `AgentApprovalPolicy`: `default`, `yolo`
- `AgentToolCallStatus`: `queued`, `running`, `ok`, `error`, `cancelled`
- `AgentStepStatus`: `committed`, `failed`
- `AgentRunEventType`: `run_started`, `model_request_started`, `model_decision_committed`, `tool_started`, `tool_finished`, `step_committed`, `run_finished`
- `AgentChangeType`:
  - entries: `create_entry`, `update_entry`, `delete_entry`
  - accounts: `create_account`, `update_account`, `delete_account`
  - tags: `create_tag`, `update_tag`, `delete_tag`
  - entities: `create_entity`, `update_entity`, `delete_entity`
  - compatibility: legacy persisted `CREATE_GROUP_MEMBER` rows may still exist in `agent_change_items`; backend hydration accepts them, but current API review payloads omit them because the active client contract no longer includes that proposal type
- `AgentChangeStatus`: `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `APPLIED`, `APPLY_FAILED`
- `AgentReviewActionType`: `approve`, `reject`

Import:

- `ImportJobStatus`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `ImportTaskStatus`: `queued`, `running`, `completed`, `failed`, `cancelled`
- `ImportPreflightSuggestedAction`: `import`, `skip`

## Core Ledger Tables

## `accounts`

- `id` (PK UUID string, FK -> `entities.id`)
- `owner_user_id` (FK -> `users.id`)
- `markdown_body`, `currency_code`, `is_active`
- `created_at`, `updated_at`

Operational rules:

- `accounts` is a subtype table for `entities`; every account is an entity root with the same id.
- Account identity is determined by the presence of a row in `accounts`, not by `entities.category = 'account'`.
- `AccountRead.id` is the only public account identifier; `entity_id` is no longer exposed.

## `account_snapshots`

- `id` (PK)
- `account_id` (FK -> `accounts.id`)
- `snapshot_at`, `balance_minor`, `note`, `created_at`

## `entry_groups`

- `id` (PK)
- `owner_user_id` (FK -> `users.id`)
- `name`
- `group_type`
- `created_at`, `updated_at`

## `users`

- `id` (PK UUID string)
- `name` (unique)
- `password_hash`
- `is_admin` (persisted admin-role gate)
- `created_at`, `updated_at`

## `sessions`

- `id` (PK UUID string)
- `user_id` (FK -> `users.id`)
- `token_hash` (unique SHA-256 digest of the opaque bearer token)
- `created_at`
- `expires_at` (nullable)
- `is_admin_impersonation`

Operational rules:

- password mode never stores raw session tokens in the database
- deleting a user cascades through owned sessions
- logout and admin revocation delete rows from this table

## `filter_groups`

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `key` (stable internal identifier, unique per owner)
- `name` (user-visible label)
- `description` (nullable)
- `color` (nullable chart/display color)
- `is_default` (built-in vs custom group)
- `position` (owner-local display order)
- `definition_json` (structured include/exclude rule tree)
- `created_at`, `updated_at`

Operational rules:

- filter groups are always principal-owned; admin access does not expose another user's saved groups
- default groups are provisioned lazily per user and persisted on first dashboard/filter-group read
- default groups keep stable `key` values (`day_to_day`, `one_time`, `fixed`, `transfers`, `untagged`) even when their rules are edited
- rule definitions are recursive logical trees over `entry_kind`, tag inclusion/exclusion, and `is_internal_transfer`

## `runtime_settings`

- `id` (PK int)
- `scope` (unique string, current runtime uses `default`)
- nullable override fields:
  - `user_memory`
  - `default_currency_code`
  - `dashboard_currency_code`
  - `agent_model`
  - `available_agent_models` (nullable JSON-serialized ordered list of model identifiers)
  - `entry_tagging_model`
  - `agent_model_display_names` (nullable JSON-serialized object mapping model id → display label for UI)
  - `agent_max_steps`
- `agent_bulk_max_concurrent_threads` (default import job worker pool size; UI label: import concurrent workers)
  - `agent_retry_max_attempts`
  - `agent_retry_initial_wait_seconds`
  - `agent_retry_max_wait_seconds`
  - `agent_retry_backoff_multiplier`
  - `agent_max_image_size_bytes`
  - `agent_max_images_per_message`
  - `agent_max_pdf_pages`
  - `agent_base_url` (optional custom provider endpoint, validated to prevent SSRF)
  - `agent_api_key` (optional custom provider API key, never exposed in API responses)
- `created_at`, `updated_at`

Purpose:

- stores optional runtime overrides managed by `/api/v1/settings`
- effective runtime values are resolved as `override -> env default` where applicable
- `user_memory` is an optional DB-only JSON-serialized list of strings used for persistent agent prompt context
- `available_agent_models` is an optional DB-only JSON-serialized ordered list; the resolved API value always includes the effective `agent_model`
  - `agent_model_display_names` is an optional DB-only JSON object of UI labels; the API merges these with built-in labels for known default-catalog model ids and exposes only entries for models in the effective available list
- `vision_capable_agent_models` is not persisted; it is derived at read time from the effective available model list
- identity is not stored here

## `entities`

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `name` (unique per owner)
- `category` (nullable normalized lowercase, compatibility mirror of taxonomy assignment)
- `created_at`, `updated_at`

Operational rules:

- generic counterparties live only in `entities`
- account-backed entities are the rows whose id also exists in `accounts`
- legacy generic entities may still have `category = 'account'`, but that category no longer grants account semantics

## `entries`

- `id` (PK)
- `kind`, `occurred_at`, `name`, `amount_minor`, `currency_code`
- `from_entity_id`, `to_entity_id` (nullable FK -> `entities.id`)
- `owner_user_id` (FK -> `users.id`)
- denormalized labels: `from_entity`, `to_entity`, `owner`
- `markdown_body`
- `is_deleted`, `deleted_at`
- `created_at`, `updated_at`

Deletion semantics:

- `from_entity_id` / `to_entity_id` use `ON DELETE SET NULL`
- when an entity or account root is deleted, the denormalized `from_entity` / `to_entity` text is intentionally preserved so historical labels remain visible
- API serializers derive `from_entity_missing` / `to_entity_missing` when preserved text remains but the linked entity FK is now `NULL`
- group context is derived from optional membership rows plus parent-chain traversal; there is no persisted `entries.group_id`

## `entry_group_members`

- `id` (PK)
- `group_id` (FK -> `entry_groups.id`)
- `entry_id` (nullable FK -> `entries.id`)
- `child_group_id` (nullable FK -> `entry_groups.id`)
- `member_role` (nullable `GroupMemberRole`)
- `position`
- `created_at`, `updated_at`

Core constraints:

- exactly one of `entry_id` or `child_group_id` must be set
- `entry_id` is globally unique, so an entry can belong to at most one direct group
- `child_group_id` is globally unique, so a child group can belong to at most one parent group
- `(group_id, entry_id)` and `(group_id, child_group_id)` are unique
- `child_group_id != group_id`

Operational rules:

- top-level groups may contain direct entries and/or child groups
- child groups may contain direct entries only
- edges are not persisted; graph topology is derived at read time from `group_type` plus sorted direct membership
- `position` and `created_at` provide deterministic ordering for recurring-group chain derivation
- entry create/update flows may assign or clear one direct group membership inline; split-group assignment also requires a direct member role

## `tags`

- `id` (PK int)
- `owner_user_id` (FK -> `users.id`)
- `name` (unique normalized lowercase per owner)
- `color`
- `description` (nullable free-text note)
- `created_at`

## Taxonomy Tables (`0007_taxonomy_core`)

Taxonomies generalize reusable categorical properties without creating a new table per category type.

## `taxonomies`

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `key` (unique per owner, e.g. `entity_category`, `tag_type`)
- `applies_to` (subject domain, e.g. `entity`, `tag`)
- `cardinality` (`single` in current defaults)
- `display_name`
- `created_at`, `updated_at`

## `taxonomy_terms`

- `id` (PK UUID string)
- `taxonomy_id` (FK -> `taxonomies.id`)
- `name` (normalized lowercase display value)
- `normalized_name` (unique per taxonomy)
- `parent_term_id` (nullable self-FK for hierarchical terms)
- `metadata_json` (nullable JSON extension slot)
- `created_at`, `updated_at`

Unique constraint:

- `(taxonomy_id, normalized_name)`

Current metadata usage:

- optional term `description` is stored at `metadata_json.description` (used by entity categories/tag types)

## `taxonomy_assignments`

- `id` (PK UUID string)
- `taxonomy_id` (FK -> `taxonomies.id`)
- `term_id` (FK -> `taxonomy_terms.id`)
- `subject_type` (e.g. `entity`, `tag`)
- `subject_id` (string id of referenced subject)
- `position` (reserved for multi-cardinality ordering)
- `created_at`, `updated_at`

Unique constraint:

- `(taxonomy_id, subject_type, subject_id, term_id)`

Current seeded taxonomies:

- `entity_category`
- `tag_type`

## `entry_tags`

- `entry_id` (PK/FK -> `entries.id`)
- `tag_id` (PK/FK -> `tags.id`)

Deletion semantics:

- deleting a tag removes junction rows through `entry_tags.tag_id ON DELETE CASCADE`

## Current Delete Rules

- deleting an account deletes the shared account/entity root, cascades account snapshots, and detaches `from_entity_id` / `to_entity_id` references that pointed at that root while preserving label text
- deleting a generic entity detaches `from_entity_id` / `to_entity_id` and preserves label text
- deleting an account-backed entity through generic entity routes is blocked; account-backed roots are managed through `/accounts`
- soft-deleting an entry removes its direct `entry_group_members` row if one exists
- deleting a group is allowed only when it has no direct members and is not attached as a child group

## Agent Tables (`0045_agent_harness_first_schema`)

Migration `0045_agent_harness_first_schema` replaces the legacy thread/message/run layout with the harness-first schema below. Before dropping legacy tables it exports and validates every thread, run, conversation message, attachment, session source, proposal, and review action, then ports them into the new schema. The upgrade aborts before dropping tables if any conversation message or attachment cannot be ported, or if any run is `RUNNING`. Historical event journals are used to reconstruct tool-using transcripts but are not themselves retained.

## `user_files`

Purpose: canonical registry for durable user-visible uploads, including agent attachment bundles.

Fields:

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `storage_area` (currently `upload`)
- `source_type` (string origin marker such as `agent_message_attachment` or `agent_session_source`)
- `stored_relative_path` (owner-local relative path under `user_files/{user_id}`)
- `original_filename`
- `display_name`
- `mime_type`
- `size_bytes`
- `sha256` (nullable)
- `created_at`

Operational notes:

- files live under `{data_dir}/user_files/{user_id}/uploads`
- `(owner_user_id, stored_relative_path)` is unique
- repeated uploads by the same owner reuse the existing row by content hash when size, mime type, and SHA-256 match
- deleting a thread removes attachment rows but does not delete canonical file payloads from disk

## `agent_threads`

Purpose: conversation container.

Fields:

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `title` (nullable)
- `summary` (nullable external-agent editable session summary)
- `created_at`, `updated_at`

## `agent_transcript_messages`

Purpose: canonical ordered transcript rows for one run. This is the source of truth for model-visible conversation state and for API turn projections.

Fields:

- `id` (PK UUID string)
- `run_id` (FK -> `agent_runs.id`)
- `sequence_index` (monotonic per run)
- `role` (`AgentTranscriptRole`)
- `content_json` (structured message payload: text, multimodal parts, tool requests, or tool results)
- `reasoning_text` (nullable; assistant reasoning captured for the step)
- `tool_request_id` (nullable; tool-result rows only)
- `tool_name` (nullable; tool-result rows only)
- `created_at`

Operational rules:

- one run owns only messages introduced by that turn: its system prompt snapshot, user input, assistant decisions, and tool results
- model context is assembled from the current system snapshot, prior runs' non-system rows, and the current turn's owned rows
- attachment-bearing user sends require a vision-capable model for image/PDF parts

## `agent_transcript_attachments`

Purpose: linkage from a user transcript row to one canonical `user_files` row.

Fields:

- `id` (PK UUID string)
- `transcript_message_id` (FK -> `agent_transcript_messages.id`)
- `user_file_id` (FK -> `user_files.id`)
- `created_at`

Operational note:

- new uploads are persisted under `{data_dir}/user_files/{owner_user_id}/uploads/...`
- serializers derive `mime_type`, `original_filename`, `file_path`, and `attachment_url` from the linked `user_files` row

## `agent_session_sources`

Purpose: session-level source links for external agents using `bh sessions sources ...` and for hosted app attachments that are automatically linked when bound to a message.

Fields:

- `id` (PK UUID string)
- `thread_id` (FK -> `agent_threads.id`)
- `user_file_id` (FK -> `user_files.id`)
- `note` (nullable)
- `created_at`

Operational notes:

- `(thread_id, user_file_id)` is unique, so attaching the same stored source to the same session is idempotent.
- deleting a session removes source links but keeps canonical `user_files` payloads.
- migration `0045_agent_harness_first_schema` refuses the destructive table swap unless every legacy thread, run, message, attachment, tool call, and event has a canonical replacement; proposal and review rows retain their IDs and relationships.

## `agent_runs`

Purpose: one harness execution per user turn. Each run owns a canonical transcript, step records, tool calls, harness events, and review items.

Fields:

- `id` (PK UUID string)
- `thread_id` (FK -> `agent_threads.id`)
- `turn_index` (nullable int; monotonic per thread for user turns; external-session anchor runs may use `NULL`)
- `status` (`AgentRunStatus`)
- `model_name`
- `principal_user_id` (the durable tool-execution principal)
- `principal_user_name` (nullable display/audit name)
- `metadata_json` (durable run/tool context such as attachment handling flags)
- `origin` (string execution origin; currently `app`, `telegram`, or `cli` for external-session anchors)
- `approval_policy` (`default` or `yolo`; `yolo` triggers server-side auto-approval of this run’s pending change items after a successful run completion, subject to the same dependency ordering rules as manual approval)
- `max_steps` (bounded harness step limit for the run)
- `final_transcript_message_id` (nullable FK -> `agent_transcript_messages.id`; terminal assistant row when the run completes successfully)
- `input_tokens` (nullable int)
- `output_tokens` (nullable int)
- `cache_read_tokens` (nullable int)
- `cache_write_tokens` (nullable int)
- `input_cost_usd` (nullable float; persisted when available)
- `output_cost_usd` (nullable float; persisted when available)
- `total_cost_usd` (nullable float; persisted when available)
- `error_code` (nullable string terminal error code)
- `error_detail` (nullable text terminal error detail)
- `stop_requested` (bool; user interrupt flag checked by the harness stop signal)
- `created_at`, `completed_at`

Unique constraint:

- `(thread_id, turn_index)`

API-derived fields (not persisted in DB columns):

- `final_assistant_reply` (terminal assistant content formatted for the requested read origin)
- derived USD pricing fields are also recomputed at serialization time from persisted usage counters when needed
- `current_context_tokens` on thread detail is computed at read time from the canonical transcript plus tool schemas; it is not stored on `agent_runs`

## `agent_steps`

Purpose: durable model-step projection for one harness loop iteration.

Fields:

- `id` (PK UUID string)
- `run_id` (FK -> `agent_runs.id`)
- `step_index` (monotonic per run)
- `assistant_transcript_message_id` (FK -> `agent_transcript_messages.id`)
- `status` (`AgentStepStatus`)
- `input_tokens` (nullable int)
- `output_tokens` (nullable int)
- `cache_read_tokens` (nullable int)
- `cache_write_tokens` (nullable int)
- `finish_reason` (nullable string)

Operational rules:

- a model decision is persisted as a `running` step with queued tool calls before any tool executes
- queued tools are claimed as `running` before execution and become `ok` or `error` with a canonical tool-result transcript row
- resume executes queued tools, but converts tools left `running` by a process interruption into an explicit unknown-outcome error instead of repeating possible side effects
- a step becomes `committed` only after all of its tool calls are terminal
- `latency_ms` (nullable int)
- `diagnostic_json` (nullable JSON)
- `created_at`

## `agent_tool_calls`

Purpose: audit trail for tool usage during a committed step.

Fields:

- `id` (PK UUID string)
- `run_id` (FK -> `agent_runs.id`)
- `step_id` (FK -> `agent_steps.id`)
- `call_index` (monotonic per step)
- `tool_request_id` (provider-stable request id within the run)
- `tool_name`
- `arguments_json`
- `result_content_json` (nullable structured tool result sent back to the model)
- `status` (`AgentToolCallStatus`)
- `error_code` (nullable)
- `started_at` (nullable)
- `completed_at` (nullable)

Operational notes:

- tool rows are created when the model decision commits, then updated as execution starts and finishes

## `agent_run_events`

Purpose: durable harness event log for live streaming and historical replay.

Fields:

- `id` (PK UUID string)
- `run_id` (FK -> `agent_runs.id`)
- `sequence_index` (monotonic per run)
- `event_type` (`AgentRunEventType`)
- `payload_json` (event-specific harness payload)
- `created_at`

Operational notes:

- streaming also emits ephemeral `model_delta` SSE events that are not persisted as rows
- persisted event types map directly to harness coordinator events such as `tool_started`, `tool_finished`, `step_committed`, and `run_finished`

## `agent_change_items`

Purpose: review-gated proposed changes (CRUD proposals across entries/accounts/tags/entities/groups).

Fields:

- `id` (PK UUID string)
- `run_id` (FK -> `agent_runs.id`)
- `change_type` (`AgentChangeType`)
- `payload_json`
- `status` (`AgentChangeStatus`)
- `review_note`
- `applied_resource_type`, `applied_resource_id`
- `created_at`, `updated_at`

## `agent_review_actions`

Purpose: immutable review history per change item.

Fields:

- `id` (PK UUID string)
- `change_item_id` (FK -> `agent_change_items.id`)
- `action` (`AgentReviewActionType`)
- `actor`
- `note`
- `created_at`

## Import Tables (`0043_add_import_workflow`)

## `import_jobs`

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `title` (nullable)
- `status` (`ImportJobStatus`)
- `model_name`
- `concurrency`
- `approval_policy` (`AgentApprovalPolicy`)
- `instructions`
- `total_tasks`, `completed_tasks`, `failed_tasks`
- `created_at`, `updated_at`, `completed_at`

## `import_tasks`

- `id` (PK UUID string)
- `job_id` (FK -> `import_jobs.id`)
- `thread_id` (FK -> `agent_threads.id`)
- `source_user_file_id` (nullable FK -> `user_files.id`)
- `source_sha256` (nullable; used for re-import detection)
- `source_label`
- `status` (`ImportTaskStatus`)
- `active_run_id` (nullable)
- `error_text` (nullable)
- `sequence_index`
- `created_at`, `updated_at`, `completed_at`

Operational rules:

- one source attachment → one task → one agent thread
- import threads are omitted from the Agent thread list query
- re-import by identical `source_sha256` is allowed; preflight surfaces prior jobs

## Derived Rules

- `agent_change_items` are created as `PENDING_REVIEW` by proposal creation commands.
- proposal create/list/get responses include proposal ids so later turns can target existing pending items.
- pending proposals remain inspectable while `PENDING_REVIEW` via thread-scoped proposal reads before human review.
- only `PENDING_REVIEW` items can be approved/rejected.
- approving applies exactly one proposed mutation and records review action.
- rejecting records review action and does not create domain resources.
- approving `create_entry` persists an entry directly without an entry-level status column.
- approving `create_account` creates both the account row and its shared entity root (`accounts.id == entities.id`).
- `delete_tag` is allowed only when the tag has no non-deleted entry references.
- `delete_entity` nulls/detaches entity references from entries/accounts before deleting the entity.
- `delete_account` deletes snapshots and detaches account-root entity refs while preserving denormalized labels.
- resolved runtime settings drive current-user attribution defaults, dashboard currency, and agent runtime limits/model selection.

## Currency Catalog (Current)

There is no dedicated `currencies` table.

Currency responses are synthesized from:

- built-in codes in `backend/routers/currencies.py`
- distinct `entries.currency_code` values in non-deleted entries

## Current Constraints

- no auth/tenant scoping for agent or ledger tables
- runtime settings are global to the app instance (single `scope` row in current implementation)
- image files are local filesystem references (not object storage)
- proposal payloads are JSON and schema-evolved by app logic (not DB-level JSON schema constraints)
- category assignments are persisted in taxonomy tables; `entities.category` remains for compatibility and is synchronized by service logic
- historical runs can have null usage counters when model/provider usage metadata is unavailable
- run pricing fields are computed at read time and can be null when usage counters are missing or model pricing is unmapped
