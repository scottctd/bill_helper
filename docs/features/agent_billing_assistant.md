# Billing Assistant Agent

This feature doc describes the current billing assistant architecture, prompt shape, exact runtime-visible tool contracts, and the `bh` CLI contract the agent uses through the hosted `run_bh` tool.

## Agent UX Quick Path

1. Open the app and navigate to the Agent route.
2. Create or select a conversation thread.
3. Pick the next-run model from the composer dropdown if needed, attach optional images/PDFs, let vision preparation finish or continue in the background, then send.
4. Review the live run timeline:
  - user and assistant messages render inline
  - progress updates and tool-call events appear during execution
  - untitled threads are gated so the first model step can only call `rename_thread`
5. Open the thread review modal after proposals are created.
6. Approve, reject, reopen, or batch-process proposals.
7. Only approved proposals mutate real owner-scoped ledger data.

## Overview

The current assistant is a review-gated tool-calling runtime with a deliberately small model-visible surface:

- the model sees only `rename_thread`, `add_user_memory`, and `run_bh`
- Bill Helper app reads, proposal creation/updates/removal, and review actions now happen through `bh`
- `run_bh` is a narrow bridge for backend-backed Bill Helper operations, not a general shell
- proposals still create `AgentChangeItem` rows first; direct ledger mutation still happens only in review apply handlers

The old read/proposal/review modules still exist internally, but no longer as direct model-facing tools. They are now backend building blocks reused by proposal HTTP routes, normalization, patching, and apply logic.

## Core Components


| Component                    | Files                                                                                                                                                                                         | Responsibility                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness runtime              | `backend/services/agent/harness/`, `backend/services/agent/production_runtime.py`, `backend/services/agent/production_repository.py`, `backend/services/agent/model_gateway.py`               | Canonical ReAct loop, resumable step/tool persistence, provider boundary, events, and streaming/background composition                              |
| Model client                 | `backend/services/agent/model_client_support/`                                                                                                                                                | LiteLLM integration, retry behavior, streaming delta normalization, and usage accounting                                                            |
| Prompt assembly              | `backend/services/agent/system_prompt.j2`, `backend/services/agent/external_agent_prompt.j2`, `backend/services/agent/prompt_includes/`, `backend/services/agent/prompt_assembly/`                     | Hosted prompt composition with current-user context; external-agent instruction via `bh instruction`; shared proposal/domain policy includes |
| Thread context               | `backend/services/agent/prompt_assembly/thread_context.py`, `backend/services/agent/prompt_assembly/message_history_content.py`, `backend/services/agent/attachment_content.py`                                                | Owned per-turn transcript assembly, prior canonical context, attachment extraction, PDF/image handling, and review prefixing                         |
| Runtime-visible tool catalog | `backend/services/agent/tool_runtime_support/catalog.py`, `backend/services/agent/tool_runtime_support/catalog_session.py`, `backend/services/agent/tool_runtime_support/catalog_terminal.py` | Exact tool schemas exposed to the model                                                                                                             |
| CLI execution                | `backend/services/agent/terminal.py`, `backend/services/agent/work_sessions.py`                                                                                                                 | Hosted `bh` execution, short-lived session injection, source/session persistence, output truncation, and secret scrubbing                           |
| CLI                          | `backend/cli/main.py`, `backend/cli/support.py`, `backend/cli/rendering.py`, `backend/cli_reference/`, `backend/cli/dashboard_commands.py` | Thin HTTP client, compact/text rendering, dashboard analytics reads, and prompt/doc reference metadata |
| Internal domain helpers      | `backend/services/agent/read_tools/`, `backend/services/agent/proposals/`, `backend/services/agent/proposal_http.py`, `backend/services/agent/proposal_patching.py`                           | Lookup helpers plus proposal normalization, metadata, and patching reused behind APIs and review/apply                                              |
| Review/apply                 | `backend/services/agent/reviews/`, `backend/services/agent/apply/`, `backend/routers/agent.py`, `backend/routers/agent_proposals.py`                                                          | Proposal inspection, approve/reject/reopen transitions, reviewer overrides, and canonical mutations                                                 |
| Frontend agent UI            | `frontend/src/features/agent/`                                                                                                                                                                | Thread list, composer, run timeline, tool blocks, and review modal                                                                                  |


## Runtime Flow

1. User sends a message to an agent thread.
2. If the user attached files in the composer first, backend has already persisted and prepared those draft uploads under canonical `user_files`.
3. Backend persists the message, binds any uploaded attachments (or inline request files), links those files as session sources, and creates a new `agent_runs` row.
4. Runtime builds the system prompt, current-user context, entity-category context, user memory section, and message history.
5. If the thread is untitled, the runtime exposes only `rename_thread` and requests that tool explicitly.
6. After the thread has a valid title, the runtime exposes the three-tool catalog.
7. For Bill Helper app work, the model calls `run_bh` and executes `bh ...`.
8. `run_bh` mints a short-lived backend session, injects `BH_*` env, executes the local CLI module, truncates output when needed, and revokes the temporary session afterward.
9. Hosted `bh` calls backend routes for reads, current-session summary updates, and current-thread proposal lifecycle actions. Session navigation and source attachment commands remain available to external agents through `bh instruction`, but are blocked for hosted runs. External agents load the shared proposal/domain policy plus the full external CLI reference from `bh instruction`.
10. Proposal creation stores pending `AgentChangeItem` rows scoped to the current thread and hosted run, or to a synthetic CLI run for external agents.
11. Human review approves, rejects, or reopens proposals.
12. Only approval apply handlers mutate the real domain tables.

## Prompt Shape

The system prompt is a markdown document with:

- `## Identity`
- `## Operating Rules`
- `### Tool Use`
- `## bh Reference`
- `## Proposal Workflow`
- proposal workflow rules for duplicate checks, proposal inspection, and proposal revision
- `## Domain Rules`
- domain-specific rules for entries, tags, entities, accounts, snapshots, and groups
- `## Error Recovery`
- `## Final Response`
- `## Current User Context`
- `### Entity Category Reference`
- `### Account Context`
- `### Agent Memory`

Important current behavior:

- prompt guidance explicitly routes Bill Helper app work through `run_bh` plus `bh`
- the prompt embeds a concise `bh` cheat sheet, not full tool schema docs
- raw `curl` and ad hoc Python are discouraged when a `bh` command exists
- duplicate checks, entity/tag/account grounding, group workflow rules, and review-continuation rules still live in the prompt

## Runtime-Visible Tool Contracts

The model-visible tool surface is intentionally small, but it is still documented exactly here.

### Attachment Content The Agent Sees

For a newly uploaded PDF or image bundle, the initial user turn is vision-first. The agent sees:

- original uploaded image bytes as `image_url` parts, without resizing
- one high-resolution rendered page image per PDF page
- a short attachment text marker describing each PDF and page count
- the user’s free-text prompt after the attachment parts

The current hosted path does not run Docling or OCR. PDFs with more pages than `agent_max_pdf_pages` are rejected before rendering.


<!-- GENERATED:runtime-tool-contracts:start -->
### `add_user_memory`

Description:

Append new persistent user-memory items. Use this only when the user clearly asks you to remember/store a standing preference, rule, or hint for future runs. This tool is add-only: do not use it to mutate or remove existing memory.

Arguments:

- `memory_items: list[string]` required
  description: New persistent memory items to append. Each item should be a short standalone user preference, rule, or hint.
  constraints: minItems=1, maxItems=20

### `rename_thread`

Description:

Rename the current thread to a short 1-5 word topic. Use this right after the first user message in a new thread. After that, only rename when the user explicitly asks or the topic shifts substantially.

Arguments:

- `title: string` required
  description: Short thread title/topic in 1-5 words.
  constraints: minLength=1, maxLength=80

### `run_bh`

Description:

Use this tool only for Bill Helper app operations through `bh ...`. It does not provide a general shell or filesystem workspace. The hosted prompt already includes the Bill Helper domain rules and hosted CLI reference.

Arguments:

- `command: string` required
  description: Bill Helper CLI command to execute. Must start with `bh`; general shell commands are rejected.
  constraints: minLength=1
- `cwd: string | null`
  description: Ignored legacy field retained for older tool arguments. `run_bh` executes the local `bh` CLI only.
  constraints: default=None
- `timeout_seconds: integer`
  description: Command timeout in seconds. Defaults to 120. Allowed range: 1 to 600.
  constraints: minimum=1, maximum=600, default=120
<!-- GENERATED:runtime-tool-contracts:end -->


## `bh` CLI Contract

`bh` is the canonical app-operation interface for hosted and external agents.

Current behavior:

- `bh` is a thin HTTP client; it never mutates the database or canonical files directly
- auth and backend reachability come from `BH_`* env or the user's local `bh` config
- non-TTY output defaults to `compact`
- TTY output defaults to `text`
- `json` is explicit opt-in only
- compact output never uses ANSI color
- compact list outputs use 8-character ids when unique in the current result set, and fall back to full ids on collisions
- displayed short ids are reusable across follow-up `bh` reads, including proposal inspection commands and nested proposal references inside proposal payloads, because `bh` resolves them to canonical ids before the final API call
- proposal commands use `BH_SESSION_ID` / `BH_THREAD_ID`; `BH_RUN_ID` is optional for hosted runs

### Compact Output Contract

Compact output is line-oriented and token-efficient:

- first line is usually `OK`
- summary metadata uses `summary: ...`
- list outputs emit one `schema: ...` line that defines fixed column order
- each following row is a `|`-delimited record
- `\`, `|`, and newlines are escaped inside cell values
- repetitive field names are omitted from rows

### Canonical `bh` Cheat Sheet


<!-- GENERATED:bh-cheat-sheet:start -->
Use `bh` for Bill Helper app reads and current-session proposal creation and proposal mutation.

- Agent calls should expect `compact` output by default; use `--format text` or `--format json` only when needed.
- Every command also accepts `--format {compact,json,text}` as an optional global override.
- List output uses 8-character ids when unique in the current result set; collisions fall back to full ids.
- Compact output is line-oriented: one `schema:` line defines column order, then one escaped `|`-delimited row per record.
- Text output formats monetary minor units as decimal currency amounts; compact/json preserve raw minor-unit fields.
- Hosted runs receive temporary auth and the current session id automatically.
- Mutating proposal commands use the injected current session. `BH_RUN_ID` is present for hosted runs and should not be supplied manually.
- The app owns hosted session creation, selection, and attachment linking. Hosted runs may update only the current session with `bh sessions update`; do not use session navigation or source-management commands.
- Inspect before mutating: read entries/tags/accounts/entities/groups/proposals first, then create resource-scoped proposals.
- For spending/income questions, prefer `bh dashboard finance get` before scanning raw entries.
- For agent spend questions, use `bh dashboard agent get`.
- `bh proposals update` and `bh proposals remove` only work for pending proposals in the current session/thread.

Command specifications:

### `bh status`
- Purpose: Show current auth and CLI session context.
- Required arguments: none.
- Optional arguments: none.

### `bh sessions update`
- Purpose: Update the current app-managed session title or summary.
- Required arguments: none.
- Optional arguments:
  - `--title TEXT: replace the current session title.`
  - `--summary TEXT: replace the current session summary.`
- Notes:
  - Hosted runs use the injected current session id. Do not provide a session id.
  - `--summary-file` is for external agents with local files and is not available to hosted runs.

### `bh entries list`
- Purpose: List entries.
- Required arguments: none.
- Optional arguments:
  - `--start-date YYYY-MM-DD: inclusive lower bound on entry date.`
  - `--end-date YYYY-MM-DD: inclusive upper bound on entry date.`
  - `--kind KIND: entry kind filter, for example EXPENSE, INCOME, or TRANSFER.`
  - `--currency CODE: 3-letter currency code filter.`
  - `--account-id ID: account id or unique short id prefix filter.`
  - `--source TEXT: free-text source filter.`
  - `--tag NAME: tag-name filter.`
  - `--category TEXT: entry category leaf, parent, or uncategorized filter.`
  - `--group-id ID: group id or unique short id prefix filter.`
  - `--limit N: integer result limit. Default 20.`
  - `--offset N: integer result offset. Default 0.`

### `bh entries get <entry_id>`
- Purpose: Get one entry.
- Required arguments:
  - `<entry_id>: full entry id or unique short id prefix.`
- Optional arguments: none.

### `bh entries create`
- Purpose: Create an entry proposal in the current thread.
- Required arguments:
  - `--kind {EXPENSE,INCOME,TRANSFER}: entry kind.`
  - `--date YYYY-MM-DD: entry date.`
  - `--name TEXT: human-readable entry name.`
  - `--amount-minor INT: integer minor units, for example 1234 for 12.34.`
  - `--from-entity TEXT: source entity name.`
  - `--to-entity TEXT: destination entity name.`
- Optional arguments:
  - `--currency-code CODE: optional 3-letter currency code. Defaults to runtime settings when omitted.`
  - `--tag NAME: tag name. Repeat for multiple tags.`
  - `--markdown-notes TEXT: optional markdown notes.`
  - `--category TEXT: optional entry category leaf or path, for example food_drink/groceries.`
  - `--lifecycle {fixed,day_to_day,one_time}: optional lifecycle override.`

### `bh entries import`
- Purpose: Create multiple entry proposals in the current thread from one JSON document.
- Required arguments:
  - `--payload-json JSON: inline JSON document.`
- Optional arguments: none.
- Notes:
  - --payload-file is for external agents with local files and is not available to hosted runs.
  - JSON must be an object with an entries array (1-100 items).
  - Each entry requires: kind, date, name, amount_minor, from_entity, to_entity.
  - Each entry may include: currency_code, tags, markdown_notes.
  - Each entry becomes one pending review proposal.
  - A matching pending create_entity or create_account proposal in the current thread satisfies entry proposal validation. After proposing a missing entity or account, retry the import immediately; do not wait for approval.
  - Example: bh entries import --payload-json '{"entries":[{"kind":"EXPENSE","date":"2026-03-15","name":"Farm Boy","amount_minor":1234,"from_entity":"Checking","to_entity":"Farm Boy"}]}'

### `bh entries update <entry_id>`
- Purpose: Create an entry-update proposal in the current thread.
- Required arguments:
  - `<entry_id>: full entry id or unique short id prefix.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.

### `bh entries remove <entry_id>`
- Purpose: Create an entry-delete proposal in the current thread.
- Required arguments:
  - `<entry_id>: full entry id or unique short id prefix.`
- Optional arguments: none.

### `bh accounts list`
- Purpose: List accounts.
- Required arguments: none.
- Optional arguments: none.

### `bh accounts create`
- Purpose: Create an account proposal in the current thread.
- Required arguments:
  - `--name TEXT: account display name.`
  - `--currency-code CODE: 3-letter currency code such as CAD or USD.`
- Optional arguments:
  - `--markdown-body TEXT: optional markdown description.`
  - `--is-active: mark the account as active.`
  - `--inactive: mark the account as inactive.`
- Notes:
  - If neither `--is-active` nor `--inactive` is provided, the proposal defaults to active.

### `bh accounts update <account_ref>`
- Purpose: Create an account-update proposal in the current thread.
- Required arguments:
  - `<account_ref>: exact account name, full id, or unique short id prefix.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.

### `bh accounts remove <account_ref>`
- Purpose: Create an account-delete proposal in the current thread.
- Required arguments:
  - `<account_ref>: exact account name, full id, or unique short id prefix.`
- Optional arguments: none.

### `bh snapshots list <account_id>`
- Purpose: List account snapshots.
- Required arguments:
  - `<account_id>: full account id or unique short id prefix.`
- Optional arguments: none.

### `bh snapshots reconciliation <account_id>`
- Purpose: Get account reconciliation.
- Required arguments:
  - `<account_id>: full account id or unique short id prefix.`
- Optional arguments:
  - `--as-of YYYY-MM-DD: reconciliation cutoff date.`

### `bh snapshots create`
- Purpose: Create a snapshot proposal in the current thread.
- Required arguments:
  - `--account-id ID: full account id or unique short id prefix.`
  - `--snapshot-at YYYY-MM-DD: snapshot date.`
  - `--balance DECIMAL: decimal balance amount such as 1234.56.`
- Optional arguments:
  - `--note TEXT: optional snapshot note.`

### `bh snapshots remove <account_id> <snapshot_id>`
- Purpose: Create a snapshot-delete proposal in the current thread.
- Required arguments:
  - `<account_id>: full account id or unique short id prefix.`
  - `<snapshot_id>: full snapshot id or unique short id prefix within the account.`
- Optional arguments: none.

### `bh groups list`
- Purpose: List groups.
- Required arguments: none.
- Optional arguments: none.

### `bh groups get <group_id>`
- Purpose: Get one group.
- Required arguments:
  - `<group_id>: full group id or unique short id prefix.`
- Optional arguments: none.

### `bh groups create`
- Purpose: Create a group proposal in the current thread.
- Required arguments:
  - `--name TEXT: group display name.`
- Optional arguments:
  - `--source {manual,rule}: group source. Defaults to manual.`
  - `--description TEXT: optional group description.`
  - `--color TEXT: optional group color token.`
  - `--rule-json JSON or --rule-file PATH: required for rule groups.`

### `bh groups update <group_id>`
- Purpose: Create a group-update proposal in the current thread.
- Required arguments:
  - `<group_id>: full group id or unique short id prefix.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.
  - Patch object format examples: `{"name":"New Group Name"}` or `{"rule":{...}}`.

### `bh groups remove <group_id>`
- Purpose: Create a group-delete proposal in the current thread.
- Required arguments:
  - `<group_id>: full group id or unique short id prefix.`
- Optional arguments: none.

### `bh groups add-member`
- Purpose: Create a group-membership add proposal.
- Required arguments:
  - `exactly one of --payload-json JSON or --payload-file PATH.`
- Optional arguments: none.
- Notes:
  - Payload is nested; `target.target_type` must be `entry`.
  - Top-level JSON: `{"action":"add","group_ref":{...},"target":{...}}`.
  - Parent `group_ref`: exactly one of `{"group_id":"<id>"}` or `{"create_group_proposal_id":"<id>"}`.
  - Entry target: `{"target_type":"entry","entry_ref":{"entry_id":"<id>"}}` or `entry_ref` with `create_entry_proposal_id`.
  - Rule groups require `target.override` (`include` or `exclude`); manual groups must omit `override`.

### `bh groups remove-member`
- Purpose: Create a group-membership removal proposal.
- Required arguments:
  - `exactly one of --payload-json JSON or --payload-file PATH.`
- Optional arguments: none.
- Notes:
  - Remove supports **existing ids only**; proposal-id references are rejected for parent group and targets.
  - Top-level JSON: `{"action":"remove","group_ref":{"group_id":"<id>"},"target":{"target_type":"entry","entry_ref":{"entry_id":"<id>"}}}`.

### `bh entities list`
- Purpose: List entities.
- Required arguments: none.
- Optional arguments: none.

### `bh entities create`
- Purpose: Create an entity proposal in the current thread.
- Required arguments:
  - `--name TEXT: entity display name.`
- Optional arguments:
  - `--category TEXT: optional entity category.`

### `bh entities update <entity_name>`
- Purpose: Create an entity-update proposal in the current thread.
- Required arguments:
  - `<entity_name>: exact entity name.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.

### `bh entities remove <entity_name>`
- Purpose: Create an entity-delete proposal in the current thread.
- Required arguments:
  - `<entity_name>: exact entity name.`
- Optional arguments: none.

### `bh tags list`
- Purpose: List tags.
- Required arguments: none.
- Optional arguments: none.

### `bh tags create`
- Purpose: Create a tag proposal in the current thread.
- Required arguments:
  - `--name TEXT: tag name.`
- Optional arguments:
  - `--type TEXT: optional tag type/category.`

### `bh tags update <tag_name>`
- Purpose: Create a tag-update proposal in the current thread.
- Required arguments:
  - `<tag_name>: exact tag name.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.

### `bh tags remove <tag_name>`
- Purpose: Create a tag-delete proposal in the current thread.
- Required arguments:
  - `<tag_name>: exact tag name.`
- Optional arguments: none.

### `bh entry-categories list`
- Purpose: List entry categories.
- Required arguments: none.
- Optional arguments: none.

### `bh entry-categories get <category_ref>`
- Purpose: Get one entry category by name, path, full id, or unique id prefix.
- Required arguments:
  - `<category_ref>: name, path, full id, or unique id prefix.`
- Optional arguments: none.

### `bh entry-categories create <name>`
- Purpose: Create an entry category directly.
- Required arguments:
  - `<name>: category term name.`
- Optional arguments:
  - `--parent REF: create a child under a parent category.`
  - `--description TEXT: category description.`
  - `--default-lifecycle {fixed,day_to_day,one_time}: default lifecycle.`

### `bh entry-categories update <category_ref>`
- Purpose: Update an entry category directly.
- Required arguments:
  - `<category_ref>: name, path, full id, or unique id prefix.`
- Optional arguments:
  - `--name TEXT, --description TEXT, or --clear-description.`
  - `--default-lifecycle VALUE or --clear-default-lifecycle.`

### `bh entry-categories remove <category_ref>`
- Purpose: Delete an entry category directly; assigned entries become uncategorized.
- Required arguments:
  - `<category_ref>: name, path, full id, or unique id prefix.`
- Optional arguments: none.

### `bh proposals list`
- Purpose: List proposals in the current thread.
- Required arguments: none.
- Optional arguments:
  - `--proposal-type TYPE: proposal type filter.`
  - `--proposal-status STATUS: proposal status filter.`
  - `--change-action ACTION: change-action filter.`
  - `--proposal-id ID: full proposal id or unique short id prefix filter.`
  - `--limit N: integer result limit. Default 20.`

### `bh proposals get <proposal_id>`
- Purpose: Get one proposal by full id or unique prefix.
- Required arguments:
  - `<proposal_id>: full proposal id or unique short id prefix.`
- Optional arguments: none.

### `bh proposals update <proposal_id>`
- Purpose: Update one pending proposal by id.
- Required arguments:
  - `<proposal_id>: full proposal id or unique short id prefix.`
  - `exactly one of --patch-json JSON or --patch-file PATH.`
- Optional arguments: none.
- Notes:
  - JSON/PATH must contain a patch object.

### `bh proposals remove <proposal_id>`
- Purpose: Remove one pending proposal by id.
- Required arguments:
  - `<proposal_id>: full proposal id or unique short id prefix.`
- Optional arguments: none.

### `bh dashboard timeline`
- Purpose: List dashboard activity months in ascending YYYY-MM order.
- Required arguments: none.
- Optional arguments: none.
- Notes:
  - Returns months with visible expense or cash-withdrawal activity in the dashboard currency.
  - Use before `--year` batch reads or to pick a valid `--month` value.

### `bh dashboard finance get`
- Purpose: Read personal finance dashboard analytics for one month or a batch.
- Required arguments: none.
- Optional arguments:
  - `exactly one of --month YYYY-MM, --year YYYY, or --months LIST.`
  - `--month YYYY-MM: single month. Defaults to the current calendar month.`
  - `--year YYYY: batch all expense-active months in that year.`
  - `--months LIST: comma-separated YYYY-MM list (backend max 24).`
  - `--sections NAME: section filter. Repeat or comma-separate. Default: all.`
  - `--breakdown-depth {summary,categories,destinations,entries}: category drill-down depth.`
  - `Sections: meta, kpis, categories, lifecycles, groups, daily_spending, monthly_trend, spending_by_from, spending_by_to, spending_by_tag, income_by_from, weekday_spending, largest_expenses, projection, reconciliation, all.`
- Notes:
  - Dashboard currency only; internal account-to-account transfers are excluded from expense analytics.
  - Use `--format json --sections categories` for the category -> destination -> entry tree.
  - Example: bh dashboard finance get --month 2026-05 --sections kpis,categories,lifecycles,largest_expenses
  - Example: bh dashboard finance get --year 2026 --sections kpis,monthly_trend --format json

### `bh dashboard agent get`
- Purpose: Read agent usage and cost dashboard analytics.
- Required arguments: none.
- Optional arguments:
  - `--range {7d,30d,90d,all}: rolling window. Default 30d.`
  - `--model NAME: model filter. Repeat for multiple models.`
  - `--surface NAME: surface filter. Repeat for multiple surfaces.`
  - `--sections NAME: section filter. Repeat or comma-separate. Default: all.`
  - `Sections: meta, metrics, cost_series, token_distribution, model_breakdown, surface_breakdown, top_runs, all.`
- Notes:
  - Costs are USD floats from finished agent runs.
  - Example: bh dashboard agent get --range 30d --sections metrics
  - Example: bh dashboard agent get --range 90d --sections model_breakdown,top_runs --format json

Compact output schemas:
- `entries_list` -> `id|date|kind|amount_minor|currency|name|from|to|tags|category|lifecycle`
- `accounts_list` -> `id|name|currency|active|balance_minor|balance_as_of`
- `snapshots_list` -> `id|date|balance_minor|note`
- `groups_list` -> `id|source|name|members|first_date|last_date`
- `entities_list` -> `name|category`
- `tags_list` -> `name|type|description`
- `sessions_detail` -> `id|title|pending|running|updated_at`
- `proposals_list` -> `id|status|change_type|summary`
- `dashboard_timeline` -> `month`
- `dashboard_kpis` -> `expense_minor|income_minor|net_minor|cash_withdrawal_minor|avg_day_minor|median_day_minor|spending_days|one_time_minor|core_spend_minor|uncategorized_minor`
- `dashboard_categories` -> `name|total_minor|share|entry_count`
- `dashboard_lifecycles` -> `lifecycle|total_minor|share|entry_count`
- `dashboard_groups` -> `group_id|name|source|total_minor|share`
- `dashboard_breakdown` -> `kind|label|total_minor|share`
- `dashboard_agent_metrics` -> `total_cost_usd|total_tokens|total_runs|completed_runs|failed_runs|avg_cost_usd|avg_tokens|cache_hit_rate|most_used_model|failure_rate`

Common flows:
- Update the current session summary: `bh sessions update --summary "Reviewed May receipts and proposed 3 entries."`
- Inspect recent matching entries: `bh entries list --source "farm boy" --limit 10`
- Read monthly dashboard KPIs: `bh dashboard finance get --sections kpis`
- Read expense breakdown tree: `bh dashboard finance get --month 2026-05 --sections categories --format json`
- Compare yearly trend: `bh dashboard finance get --year 2026 --sections monthly_trend`
- Read agent cost KPIs: `bh dashboard agent get --range 30d --sections metrics`
- Inspect current proposal state: `bh proposals list --proposal-status PENDING_REVIEW --limit 20`
- Create a tag proposal: `bh tags create --name travel --type context`
- Create an entry proposal: `bh entries create --kind EXPENSE --date 2026-03-15 --name "Farm Boy" --amount-minor 1234 --from-entity Checking --to-entity "Farm Boy" --category food_drink/groceries --lifecycle day_to_day`
- Create an entry-update proposal: `bh entries update 8bf2fa83 --patch-json '{"category":"groceries","lifecycle":"one_time"}'`
- Import multiple entry proposals: `bh entries import --payload-json '{"entries":[{"kind":"EXPENSE","date":"2026-03-15","name":"Farm Boy","amount_minor":1234,"from_entity":"Checking","to_entity":"Farm Boy","category":"food_drink/groceries","lifecycle":"day_to_day"}]}'`
- Patch a pending create-entry proposal: `bh proposals update a1b2c3d4 --patch-json '{"category":"food_drink/groceries","lifecycle":"day_to_day"}'`
- Create an account proposal: `bh accounts create --name "Wealthsimple Cash" --currency-code CAD --inactive`
- Create a snapshot proposal: `bh snapshots create --account-id 1a2b3c4d --snapshot-at 2026-03-15 --balance 1234.56 --note "statement balance"`
- Update a pending proposal: `bh proposals update a1b2c3d4 --patch-json '{"patch.tags":["travel"]}'`
- Remove a pending proposal: `bh proposals remove a1b2c3d4`
- Create a group-membership add proposal: `bh groups add-member --payload-json '{"action":"add","group_ref":{"group_id":"a971c92e"},"target":{"target_type":"entry","entry_ref":{"entry_id":"8bf2fa83"}}}'`
<!-- GENERATED:bh-cheat-sheet:end -->



## Proposal And Review Lifecycle

Proposal lifecycle is now session/thread-scoped through the CLI and review APIs:

1. the agent creates or selects a session
2. the agent optionally attaches sources and updates the session summary
3. the agent runs a resource-scoped `bh ... create|update|remove|add-member|remove-member ...` command
4. backend stores a pending `AgentChangeItem`
5. the agent continues constructing related proposals without waiting for approval; for example, after proposing a missing entity or account, it immediately retries dependent entry creation using the same entity name
6. `bh proposals list` and `bh proposals get` inspect session-local proposal history
7. `bh proposals update` and `bh proposals remove` can change or drop pending proposals before review
8. the human review UI drives approve, reject, and reopen, with dependencies applied in the required order
9. approval applies the change through the existing backend apply handlers

## API Surface Behind The CLI

Session/source routes:

- `GET /api/v1/agent/sessions`
- `POST /api/v1/agent/sessions`
- `GET /api/v1/agent/sessions/{session_id}`
- `PATCH /api/v1/agent/sessions/{session_id}`
- `GET /api/v1/agent/sessions/{session_id}/sources`
- `POST /api/v1/agent/sessions/{session_id}/sources/text`
- `POST /api/v1/agent/sessions/{session_id}/sources`

Thread-scoped proposal routes:

- `GET /api/v1/agent/threads/{thread_id}/proposals`
- `GET /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`
- `POST /api/v1/agent/threads/{thread_id}/proposals`
- `PATCH /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`
- `DELETE /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`

Review routes:

- `POST /api/v1/agent/change-items/{item_id}/approve`
- `POST /api/v1/agent/change-items/{item_id}/reject`
- `POST /api/v1/agent/change-items/{item_id}/reopen`

Read routes used by `bh` include:

- `GET /api/v1/auth/me`
- `GET /api/v1/entries`
- `GET /api/v1/entries/{entry_id}`
- `GET /api/v1/accounts`
- `GET /api/v1/accounts/{account_id}/snapshots`
- `GET /api/v1/accounts/{account_id}/reconciliation`
- `GET /api/v1/groups`
- `GET /api/v1/groups/{group_id}`
- `GET /api/v1/entities`
- `GET /api/v1/tags`

## CLI And Configuration Notes

- from a checkout, `uv run bh ...` runs the CLI without global installation
- external agents can install `bh` onto `PATH` with `uv tool install --editable .`
- if `bh` is not on `PATH`, add `$(uv tool dir --bin)` to the shell `PATH`
- `BILL_HELPER_AGENT_CLI_BASE_URL` controls hosted `run_bh` to backend reachability
- `run_bh` execution injects `BH_API_BASE_URL`, `BH_AUTH_TOKEN`, `BH_SESSION_ID`, `BH_THREAD_ID`, and `BH_RUN_ID`
- the auth token is a short-lived session created for the thread owner and revoked after the command finishes
- `run_bh` scrubs the temporary auth token from captured stdout/stderr

## Verification Expectations

When this surface changes, useful checks include:

- CLI unit tests for format defaults and compact renderer behavior
- hosted `run_bh` execution against a disposable backend
- session/source create/list/update through `bh`
- proposal create/list/get through `bh`
- review approve/reject/reopen through `bh`
- browser review/apply flow on an isolated backend
- docs and prompt sync checks

## Related Files

- [backend/cli/main.py](../../backend/cli/main.py)
- [backend/cli/support.py](../../backend/cli/support.py)
- [backend/cli/rendering.py](../../backend/cli/rendering.py)
- [backend/cli_reference/specs.py](../../backend/cli_reference/specs.py)
- [backend/services/agent/tool_runtime_support/catalog.py](../../backend/services/agent/tool_runtime_support/catalog.py)
- [backend/services/agent/tool_runtime_support/catalog_terminal.py](../../backend/services/agent/tool_runtime_support/catalog_terminal.py)
- [backend/services/agent/system_prompt.j2](../../backend/services/agent/system_prompt.j2)
- [backend/services/agent/external_agent_prompt.j2](../../backend/services/agent/external_agent_prompt.j2)
- [backend/services/agent/prompt_assembly/prompts.py](../../backend/services/agent/prompt_assembly/prompts.py)
- [backend/services/agent/terminal.py](../../backend/services/agent/terminal.py)
- [backend/services/agent/work_sessions.py](../../backend/services/agent/work_sessions.py)
- [backend/routers/agent_sessions.py](../../backend/routers/agent_sessions.py)
- [backend/routers/agent_proposals.py](../../backend/routers/agent_proposals.py)
