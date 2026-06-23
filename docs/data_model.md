# Data Model

All data is persisted in SQLite via SQLAlchemy.

## Enum Types

Core:

- `EntryKind`: `EXPENSE`, `INCOME`, `TRANSFER`
- `EntryLifecycle`: `fixed`, `day_to_day`, `one_time`
- `GroupSource`: `manual`, `rule`
- `GroupMemberOverride`: `include`, `exclude`

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

## `groups`

- `id` (PK UUID string)
- `owner_user_id` (FK -> `users.id`)
- `name` (user-visible label)
- `description` (nullable)
- `color` (nullable chart/display color)
- `source` (`manual` | `rule`)
- `definition_json` (nullable structured include/exclude rule tree for `rule` groups)
- `position` (owner-local display order)
- `created_at`, `updated_at`

Operational rules:

- groups are always principal-owned; admin access does not expose another user's saved groups
- `manual` groups store explicit entry membership in `group_members` with `override = NULL`
- `rule` groups derive membership from `definition_json` plus optional per-entry `include` / `exclude` overrides
- no built-in groups are provisioned; the saved list is empty until the user creates one
- rule groups may overlap and are auxiliary dashboard cross-cuts, not the primary expense partition
- rule definitions are recursive logical trees over entry fields such as `entry_kind`, tags, category, entities, amounts, dates, and `is_internal_transfer`

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
- `lifecycle` (nullable enum: `fixed`, `day_to_day`, `one_time`)
- `is_deleted`, `deleted_at`
- `created_at`, `updated_at`

Deletion semantics:

- `from_entity_id` / `to_entity_id` use `ON DELETE SET NULL`
- when an entity or account root is deleted, the denormalized `from_entity` / `to_entity` text is intentionally preserved so historical labels remain visible
- API serializers derive `from_entity_missing` / `to_entity_missing` when preserved text remains but the linked entity FK is now `NULL`
- group context is derived from effective membership across manual and rule groups; there is no persisted `entries.group_id`

## `group_members`

- `id` (PK UUID string)
- `group_id` (FK -> `groups.id`)
- `entry_id` (FK -> `entries.id`)
- `override` (nullable `GroupMemberOverride`; required semantics for rule-group membership edits)
- `position`
- `created_at`, `updated_at`

Core constraints:

- `(group_id, entry_id)` is unique
- an entry may belong to many manual groups simultaneously
- manual membership rows use `override = NULL`
- rule-group override rows use `include` or `exclude` to force or block rule matches

Operational rules:

- manual groups require explicit member rows without overrides
- rule groups evaluate `definition_json` against each entry, then apply override rows
- entry create/update flows may assign many manual groups through `group_ids`
- soft-deleting an entry removes its `group_members` rows

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
- `key` (unique per owner, e.g. `entity_category`, `tag_type`, `entry_category`)
- `applies_to` (subject domain, e.g. `entity`, `tag`, `entry`)
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

- optional term `description` is stored at `metadata_json.description`
- entry-category leaves can store `metadata_json.default_lifecycle`
- entry categories support at most one parent/child level

## `taxonomy_assignments`

- `id` (PK UUID string)
- `taxonomy_id` (FK -> `taxonomies.id`)
- `term_id` (FK -> `taxonomy_terms.id`)
- `subject_type` (e.g. `entity`, `tag`, `entry`)
- `subject_id` (string id of referenced subject)
- `position` (reserved for multi-cardinality ordering)
- `created_at`, `updated_at`

Unique constraint:

- `(taxonomy_id, subject_type, subject_id, term_id)`

Current seeded taxonomies:

- `entity_category`
- `tag_type`
- `entry_category`

The canonical `entry_category` schedule is:

- `food_drink`: `groceries`, `restaurants`, `delivery_takeout`, `coffee_snacks`, `alcohol_bars`
- `transport`: `transit`, `rideshare_taxi`, `fuel`, `parking`, `airfare`
- `housing`: `rent`, `utilities`, `internet`, `phone`, `home_maintenance`, `accommodation`
- `health`: `medical`, `pharmacy`, `fitness`
- `shopping`: `clothing`, `electronics`, `household_goods`, `personal_care`, `gifts`
- `entertainment`: `streaming_media`, `events_activities`, `hobbies`
- `software_tools`: `ai_apis`, `software_subscriptions`
- `education`: `tuition`, `courses_books`
- `financial`: `insurance`, `taxes`, `fees`, `debt_interest`
- `income`: `salary_wages`, `investment_income`, `other_income`
- `refunds`: `refund`, `reimbursement`, `tax_refund`

Travel is an auxiliary tag rather than a category. Temporary accommodation uses `housing/accommodation`; flights use `transport/airfare`.

## `entry_tags`

- `entry_id` (PK/FK -> `entries.id`)
- `tag_id` (PK/FK -> `tags.id`)

Deletion semantics:

- deleting a tag removes junction rows through `entry_tags.tag_id ON DELETE CASCADE`

## Current Delete Rules

- deleting an account deletes the shared account/entity root, cascades account snapshots, and detaches `from_entity_id` / `to_entity_id` references that pointed at that root while preserving label text
- deleting a generic entity detaches `from_entity_id` / `to_entity_id` and preserves label text
- deleting an account-backed entity through generic entity routes is blocked; account-backed roots are managed through `/accounts`
- soft-deleting an entry removes its `group_members` rows
- deleting a group removes its `group_members` rows; entries are unchanged

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
