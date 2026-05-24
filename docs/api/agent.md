# API Agent

All agent routes require an authenticated principal.

Scope rules:

- non-admin principals can access only their own threads and all child resources under those threads
- admin principals can access any thread and may impersonate a user when they need an exact end-user scope
- thread-scoped proposal routes accept `X-Bill-Helper-Agent-Run-Id` when a hosted run is invoking `bh`; external agents may omit it, in which case the backend creates or reuses a completed synthetic CLI run for that session

## Threads

### `GET /agent/threads`

List threads in most-recently-updated order. Response: `AgentThreadSummaryRead[]`

Behavior:

- returns the caller's threads
- admin callers receive all threads
- each row includes `last_message_preview`, `pending_change_count`, `has_running_run`, and `initiated_by_external_agent`

### `POST /agent/threads`

Create a thread. Body: optional `title`. Response: `201 AgentThreadRead`

Behavior:

- the new thread is owned by the authenticated principal
- if no title is supplied, the thread remains untitled until a later explicit rename

### `PATCH /agent/threads/{thread_id}`

Rename one thread. Body: `{ "title": string }`. Response: `AgentThreadRead`

Validation:

- title is normalized for internal whitespace
- title must contain 1-5 words
- title must be 80 characters or fewer

### `DELETE /agent/threads/{thread_id}`

Delete one thread and its persisted timeline records. Response: `204`

Behavior:

- lookup is thread-owner scoped
- cascades deletes for messages, runs, tool calls, change items, and review actions
- keeps canonical uploaded file payloads under `{data_dir}/user_files/{owner_user_id}/uploads/...`
- rejects delete when any run in the thread is still running

Errors:

- `404` thread not found
- `409` active running run exists

### `GET /agent/threads/{thread_id}`

Fetch timeline-ready thread detail. Response: `AgentThreadDetailRead`

Includes:

- `thread`
- `messages`
- per-message attachments with `display_name`, `mime_type`, and `attachment_url`
- `runs`
- per-run `change_items`
- `configured_model_name`
- `current_context_tokens`
- `thread.initiated_by_external_agent` when the session was created by an external agent via `bh` / `POST /agent/sessions`
- compact tool-call snapshots by default
- ordered run `events[]`
- nullable usage counters and derived pricing fields

## Sessions And Sources

Sessions are the external-agent-facing shape over the same `agent_threads` review history. They add an editable summary and session-level source links without requiring Bill Helper to know the external agent's cwd or local files. Hosted app attachments are linked into these source records automatically when they are bound to a message. Session creation also seeds a system marker message so the frontend can show an external-session hint and the hosted agent can treat follow-up chat as continuation of external work.

### `GET /agent/sessions`

List principal-scoped sessions. Response: `AgentSessionListRead`

### `POST /agent/sessions`

Create a session. Body: optional `title`, optional `summary`. Response: `201 AgentSessionRead`

### `GET /agent/sessions/{session_id}`

Fetch one session summary. Response: `AgentSessionRead`

### `PATCH /agent/sessions/{session_id}`

Update a session title and/or summary. Body: optional `title`, optional `summary`. Response: `AgentSessionRead`

### `GET /agent/sessions/{session_id}/sources`

List sources attached to the session. Response: `AgentSessionSourceListRead`

### `POST /agent/sessions/{session_id}/sources/text`

Attach raw text as a source. Body: `text`, optional `filename`, optional `display_name`, optional `note`. Response: `201 AgentSessionSourceRead`

### `POST /agent/sessions/{session_id}/sources`

Attach a file source as `multipart/form-data`. Fields: optional `note`, required `file`. Response: `201 AgentSessionSourceRead`

Behavior:

- source files may be text, image, or PDF
- canonical file rows are deduplicated per owner by content hash
- attaching the same stored source to the same session is idempotent and returns the existing source link
- sources are session-level context records only; the external agent remains responsible for parsing/OCR/vision work before deciding what to propose
- hosted image/PDF message attachments are persisted by the app and linked to the current session automatically; hosted agents should not re-upload those files through source routes

## Message Send

### `POST /agent/draft-attachments`

Upload one draft image, PDF, or plain-text attachment and prepare it for a later send.

Content type: `multipart/form-data`

Form fields:

- `use_ocr` (legacy compatibility field; current behavior ignores it and prepares vision content for image/PDF uploads)
- `file` (required image, PDF, or plain-text attachment such as CSV)

Behavior:

- owner-scoped to the authenticated principal
- validates the same attachment size and mime-type limits as message-send
- stores the canonical upload bundle under `{data_dir}/user_files/{owner_user_id}/uploads/...`
- when the same owner uploads the same attachment bytes again, the backend reuses the existing canonical file row by content hash
- images are stored as the original bytes; PDFs are rendered into page images for the model without text parsing or OCR; plain-text files are stored as the original bytes for inline model input
- PDFs with more pages than the resolved `agent_max_pdf_pages` setting are rejected before rendering
- returns a lightweight attachment handle for later message-send requests

Response: `201 AgentDraftAttachmentRead`

Errors:

- `400` unsupported type or invalid payload
- `422` attachment could not be prepared for send

### `DELETE /agent/draft-attachments/{attachment_id}`

Delete one unbound draft attachment. Response: `204`

Behavior:

- owner-scoped to the authenticated principal
- removes the canonical `user_files` row and its upload bundle directory
- rejects deletion after the attachment has been bound to a message

Errors:

- `404` draft attachment not found
- `409` attachment is already bound to a message

### `POST /agent/threads/{thread_id}/messages`

Create a user message and run the agent in background.

Content type: `multipart/form-data`

Form fields:

- `content` (optional if files are present)
- `model_name` (optional explicit model selection; must match one of the `available_agent_models` returned by `GET /settings`)
- `attachments_use_ocr` (legacy compatibility field; current hosted sends always use vision-prepared image/PDF parts)
- `approval_policy` (`default` by default; `yolo` auto-applies pending proposals created in this run after it completes successfully, using the same approval dependency rules as manual review)
- `surface` (`app` by default; `telegram` enables Telegram-safe prompt and reply shaping)
- `files` (0..N image, PDF, or plain-text attachments uploaded inline with this request)
- `attachment_ids` (0..N previously uploaded draft attachment ids)

Behavior:

- thread lookup is owner-scoped
- validates the combined attachment count and size limits across inline `files` plus referenced `attachment_ids`
- persists the message, stores uploaded attachments under `{data_dir}/user_files/{owner_user_id}/uploads/...` using dated readable bundle directories (`uploads/YYYY-MM-DD/<original-stem>/`, with `(N)` suffixes for collisions) and a fixed primary filename (`raw.<ext>`), and links the files as session sources
- referenced `attachment_ids` are attached without re-uploading; they must belong to the same principal and still be unbound drafts
- creates an `agent_runs` row with initial `status=running` and the requested `approval_policy`
- starts bounded tool-calling execution in background
- selected models must support vision when image or PDF attachments are present; plain-text attachments do not require vision
- images are sent as direct `image_url` parts without resizing; PDFs are sent as one rendered page image per page up to `agent_max_pdf_pages`; plain-text attachments are sent as inline `text` parts with the file body
- provider routing resolves through LiteLLM using the requested `model_name` when supplied, otherwise the configured default model
- proposal tool outputs include `proposal_id` and `proposal_short_id`

Response: `AgentRunRead`

Errors:

- `400` invalid payload
- `400` selected `model_name` is not enabled in runtime settings
- `400` image or PDF attachments were sent with a non-vision model
- `404` thread not found
- `422` attachment could not be prepared for send; no user message is persisted
- `503` provider credentials unavailable

### `POST /agent/threads/{thread_id}/messages/stream`

Create a user message and run the agent with SSE.

Content type: `multipart/form-data`

Form fields:

- `content` (optional if files are present)
- `model_name` (optional explicit model selection; must match one of the `available_agent_models` returned by `GET /settings`)
- `attachments_use_ocr` (legacy compatibility field; current hosted sends always use vision-prepared image/PDF parts)
- `approval_policy` (`default` by default; `yolo` auto-applies pending proposals created in this run after it completes successfully, using the same approval dependency rules as manual review)
- `surface` (`app` by default; `telegram` enables Telegram-safe prompt and reply shaping)
- `files` (0..N image, PDF, or plain-text attachments uploaded inline with this request)
- `attachment_ids` (0..N previously uploaded draft attachment ids)

Behavior:

- uses the same validation and persistence rules as the non-stream endpoint
- executes in-request and streams incremental events
- if the client disconnects, the run continues in background
- response payload shape stays aligned with the non-stream endpoint

Response content type: `text/event-stream`

Event contract:

- `reasoning_delta`
- `text_delta`
- `run_event`
  - shape: `{ type, run_id, event, tool_call?, run_usage? }`
  - `tool_call` is present only for tool lifecycle events and uses the compact `AgentToolCallRead` shape (`has_full_payload=false`)
  - `run_usage` is present on **live** execution and carries the run's cumulative token counters, `context_tokens`, and derived USD fields (same pricing rules as `AgentRunRead`); it is omitted when replaying persisted events for an already-finished run so the client does not apply final totals to every historical event
  - `rename_thread` starts streaming as a compact tool-call event before the final assistant message
- `AgentRunEventRead` may include optional `reasoning_duration_ms` on persisted `reasoning_update` rows with `source = model_reasoning` (stream capture from first `reasoning_delta` through step persistence); clients estimate token counts from the stored `message` text

Usage notes:

- live streams include `run_usage` on each emitted `run_event` so clients can refresh usage UI without polling thread detail
- usage totals are persisted on the run record and read from snapshot endpoints
- cache-aware pricing still rolls into the existing `input_cost_usd` and `total_cost_usd` fields
- retries after partial streamed text suppress already-emitted prefixes
- Telegram transport clients typically send `surface=telegram` here and later read `GET /agent/runs/{run_id}?surface=telegram`

## Runs And Tool Calls

### `GET /agent/dashboard`

Get principal-scoped agent usage analytics for the dashboard. Response: `AgentDashboardRead`

Query params:

- `range`: `7d` | `30d` | `90d` | `all` (`30d` default)
- repeated `model`: optional exact model-name filters
- repeated `surface`: optional exact surface filters (`app`, `telegram`)

Behavior:

- only includes finished runs (`completed` and `failed`)
- scopes runs through the owning thread principal, like the rest of the agent read surface
- derives USD costs from persisted token counters and the existing LiteLLM pricing helper
- returns summary metrics, cost-over-time buckets, token distribution, per-model rows, per-surface rows, and top expensive runs
- `90d` resolves to weekly buckets; `all` resolves to monthly buckets; shorter ranges stay daily

### `GET /agent/runs/{run_id}`

Get a run snapshot. Response: `AgentRunRead`

Behavior:

- lookup is owner-scoped through the parent thread
- optional query param `surface` (`app` or `telegram`) overrides terminal-reply formatting for this read only
- payload includes lifecycle metadata, `approval_policy`, full tool calls (`has_full_payload=true`), change items, usage counters, and derived pricing fields

### `GET /agent/tool-calls/{tool_call_id}`

Get one fully hydrated tool-call payload. Response: `AgentToolCallRead`

Behavior:

- lookup is owner-scoped through the parent thread

Errors:

- `404` tool call not found

### `POST /agent/runs/{run_id}/interrupt`

Interrupt a currently running run. Response: `AgentRunRead`

Behavior:

- lookup is owner-scoped through the parent thread
- running runs are marked `failed` with `error_text = "Run interrupted by user."`
- already finished runs are returned unchanged

Errors:

- `404` run not found

## Review Actions

## Thread-Scoped Proposals

### `GET /agent/threads/{thread_id}/proposals`

List proposals in one thread. Response: `AgentProposalListRead`

Query params:

- `proposal_type`
- `proposal_status`
- `change_action`
- `proposal_id`
- `limit`

Behavior:

- uses the same thread-scoped proposal history model as the prior internal proposal-history tooling
- accepts canonical proposal ids only; `bh` resolves displayed short ids before the final API call
- returns proposal summaries, payloads, review metadata, and timestamps

### `GET /agent/threads/{thread_id}/proposals/{proposal_id}`

Fetch one proposal by canonical full id. Response: `AgentProposalRecordRead`

Errors:

- `404` proposal not found

### `POST /agent/threads/{thread_id}/proposals`

Create one review-gated proposal in the active thread/session. Response: `201 AgentProposalRecordRead`

Body:

- `change_type`
- `payload_json`

Behavior:

- validates payloads with the same normalization/ownership rules used by the internal proposal handlers
- associates the new `AgentChangeItem` with `X-Bill-Helper-Agent-Run-Id` when present, otherwise creates or reuses the session's synthetic external-agent CLI run
- supports the full current proposal set: entry, account, snapshot, group, group-member, tag, and entity changes

### `POST /agent/threads/{thread_id}/proposals/batch-entries`

Create multiple review-gated entry proposals in one request. Response: `201 AgentProposalListRead`

Body:

- `entries`: array of entry create payloads (1-100 items), each with the same fields as a single `create_entry` proposal

Behavior:

- validates every entry before creating any proposals; failures include the array index (`entries[2]: ...`)
- creates one `PENDING_REVIEW` `create_entry` proposal per entry
- uses the same run association rules as `POST /agent/threads/{thread_id}/proposals`

Errors:

- `400` invalid payload, entity reference failure, or batch handler failure

### `PATCH /agent/threads/{thread_id}/proposals/{proposal_id}`

Update one pending proposal by canonical full id. Response: `AgentProposalRecordRead`

Body:

- `patch_map`

Behavior:

- only `PENDING_REVIEW` proposals are mutable
- validates patch-map roots by change type before applying the update
- validates the patched payload against the stored proposal payload contract before saving it

Errors:

- `400` invalid patch or proposal is not pending
- `404` proposal not found

### `DELETE /agent/threads/{thread_id}/proposals/{proposal_id}`

Remove one pending proposal by canonical full id. Response: `204 No Content`

Behavior:

- only `PENDING_REVIEW` proposals are removable

Errors:

- `400` proposal is not pending
- `404` proposal not found

### `POST /agent/change-items/{item_id}/approve`

Approve and apply one proposal item. Response: `AgentChangeItemRead`

Body:

- `note` (optional)
- `payload_override` (optional; supported for `create_entry`, `update_entry`, `create_group`, `update_group`, `create_group_member`, `create_tag`, `update_tag`, `create_entity`, and `update_entity`)

State rules:

- allowed for any non-`APPLIED` item
- returns `409` if already applied
- transitions to `APPLY_FAILED` on apply failure

Apply behavior covers:

- entry create, update, and soft-delete
- group create, rename, delete, and direct-member add/remove
- tag create, update, and delete
- entity create, update, and delete
- account create, update, delete, and snapshot operations when present in the pending proposal set

Notes:

- lookup is owner-scoped through the parent thread
- approving `create_entry` / `update_entry` returns `422` when the payload references **from/to entities** or **tags** that are not yet persisted and are only covered by other **pending** `create_entity` / `create_account` / `create_tag` proposals in the same thread; resolve those proposals first
- the same approve path returns `422` when a referenced entity or tag is still missing from the database but a **rejected** or **apply-failed** `create_entity`, `create_account`, or `create_tag` proposal for that name exists in the thread, so approving the entry cannot bypass an explicit rejection by recreating the resource on apply
- reviewer edits are sent through `payload_override`
- invalid `payload_override` payloads return `422` and leave the item unchanged
- apply uses the approving principal for scoped resolution and owner attribution
- when reviewer edits are present, later agent turns receive a compact `review_override=...` summary in the prepended review-results context

### `POST /agent/change-items/{item_id}/reject`

Reject one proposal item. Response: `AgentChangeItemRead`

Body:

- `note` (optional)
- `payload_override` (optional)

Behavior:

- lookup is owner-scoped through the parent thread

### `POST /agent/change-items/{item_id}/reopen`

Move one reviewed item back to `PENDING_REVIEW`. Response: `AgentChangeItemRead`

Body:

- `note` (optional)
- `payload_override` (optional)

Behavior:

- lookup is owner-scoped through the parent thread

## Attachments

### `GET /agent/attachments/{attachment_id}`

Download a stored attachment. Response: file body

Behavior:

- lookup is owner-scoped through the parent thread
- returns the original stored media type

Errors:

- `404` attachment not found
- `404` attachment file missing on disk
