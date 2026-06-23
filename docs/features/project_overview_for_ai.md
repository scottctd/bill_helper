# Bill Helper – Project Overview for AI Context

## 1. Project Overview

**What it is:** Self-hosted personal finance ledger with an AI chat assistant. You run the backend (e.g., Docker); clients include a **web app** (React), an **iOS app** (SwiftUI), and **Telegram** (PTB bot for chat, commands, and review). The assistant reads and proposes changes to financial records via a **human-in-the-loop review workflow**. Data changes are never applied without explicit approval.

**Tech stack:**


| Layer        | Stack                                                      |
| ------------ | ---------------------------------------------------------- |
| Frontend     | React, TypeScript, Vite, Tailwind CSS, shadcn/ui           |
| Backend      | FastAPI, SQLAlchemy, Pydantic, LiteLLM                     |
| Database     | SQLite                                                     |
| Migrations   | Alembic                                                    |
| Package mgmt | uv (Python), npm (frontend)                                |


**Architecture principles:**

- **Routers:** HTTP translation only (parsing, response mapping, status codes).
- **Services:** Domain logic and orchestration.
- **Storage:** Dedicated service modules, not routers.
- **Data flow:** Client -> router -> service -> models; agent proposals are created through the `run_bh` tool plus `bh`, applied only after human review.

---

## 2. Agents – AI Tools, Workflows, and Capabilities

### 2.1 Agent Overview

- Tool-calling LLM via LiteLLM (OpenAI, Anthropic, Google, OpenRouter, Bedrock, etc.).
- **Review-gated:** agent proposes changes only; humans approve/reject before domain mutations.
- No direct domain writes; all creates/updates/deletes go through proposal → review → apply.

### 2.2 Agent Tools

**Model-visible tools:**

- `run_bh` - executes local `bh ...` CLI commands with injected backend/auth/session/thread/run env.
- `rename_thread` – rename current thread.
- `add_user_memory` – append persistent memory items (add-only).

**Agent CLI interface:**

- Bill Helper reads and proposal/review actions now go through `bh` instead of a large direct CRUD tool catalog.
- Current CLI coverage includes status, entries, accounts, snapshots, reconciliation, groups, entities, tags, and current-thread proposals.

### 2.3 Agent Run Lifecycle

1. User sends message (background or streaming).
2. Backend persists message and attachments.
3. Run starts; tool-call loop via LiteLLM.
4. Proposals stored for review.
5. Stream emits text and run events (reasoning, tool lifecycle).
6. Run completes or fails.
7. Untitled threads: only rename exposed until title set.

### 2.4 Agent Features

- **Attachments:** Image and PDF; uploads are prepared as vision content (PyMuPDF page renders for PDFs) and sent directly to vision-capable models. Plain-text attachments are inlined as file content.
- **Surface context:** Telegram gets adapted prompts/replies.
- **Model selection:** Dropdown to pick from available models; can change mid-conversation.
- **Import tab:** Backend-orchestrated multi-file import jobs with worker pool, re-import detection, and aggregated proposal review.
- **Run interrupt:** User can stop a running agent.
- **Review results:** Prepended to latest message for continuation; agent iteratively improves proposals after feedback and inspects prior proposal state through `bh proposals list|get`.
- **Tool lifecycle:** Queued → running → completed/cancelled; collapsible observability (arguments, output).
- **Usage tracking:** Context tokens, input/output/cache tokens, cost estimates; thread-level footnote.
- **Custom provider:** Configurable base URL and API key in settings.
- **Reasoning updates:** Model reasoning and assistant tool-step text emit `reasoning_update` events during runs; the timeline shows them before the final assistant message.
- **Parallel threads:** Multiple threads can run concurrently; composer is thread-scoped (Send on idle thread even when another runs).
- **Running indicator:** Sidebar shows which threads have active runs.
- **Agent context:** Receives account markdown notes in system prompt for grounding.
- **Tool contract:** The model-facing tool surface stays small; domain operations are expressed as `bh` CLI calls through `run_bh`. Proposal history remains thread-scoped and review-gated.

### 2.5 Review Workflow

- **Edit-before-approve:** Entry proposals can be edited in the review modal before approving; structured forms mirror entry editor.
- **Batch actions:** Approve All and Reject All (with confirmation).
- **Diff display:** Human-friendly values (amounts in major units, no raw JSON quotes); field order stable and readable.
- **Pending across turns:** Unresolved proposals stay pending and editable when user sends follow-up; agent can continue proposing or update pending via proposal id.
- **Reopen:** Applied/rejected items can be reopened for audit.

---

## 3. Backend Features

### 3.1 Backend Scope

- **Core:** Accounts (CRUD, snapshots, reconciliation), entries (CRUD, filtering, group context), groups, filter groups, dashboard (KPIs, charts, timeline).
- **Catalogs:** Entities, tags, users, taxonomies, currencies.
- **Agent:** Threads, messages, runs, reviews, attachments, and hosted `bh` execution.
- **Settings:** Runtime settings.
- **Auth:** Password-backed bearer sessions for the app and API.

### 3.2 Data and Integration

- SQLite database; agent uploads stored on server.
- LLM providers via LiteLLM; no bank sync or CSV ingestion yet.

---

## 4. Frontend Features

### 4.1 Routes

- Home – agent workspace
- Dashboard – analytics and charts
- Filters – saved filter groups
- Entries – list, filter, create, edit; entry detail with group graph
- Entities – entity catalog
- Groups – groups workspace
- Accounts – accounts workspace
- Properties – users, entities, tags, taxonomy
- Settings – runtime settings

### 4.2 Capabilities

- Layout: sidebar, page headers, workspace sections.
- **Table pattern:** Rightmost compact add button; double-click row to edit; consistent filter row layout across Entries, Accounts, Properties.
- Shared editors for entries, tags, groups; group graph visualization; markdown notes.
- Agent: chat panel, thread list (running indicator per thread), timeline, composer, model dropdown, usage bar, attachments, review modal.
- **Agent UX:** Assistant messages rendered as markdown. Tool calls collapsible. Run/tool blocks in assistant column. Thread-scoped composer (parallel threads supported). Stop targets selected thread only.
- Principal session for auth; startup gate until principal selected.

---

## 5. Telegram Features

### 5.1 Commands

- `/start`, `/help` – intro and help.
- `/new`, `/reset` – new backend thread.
- `/threads` – list threads.
- `/use <number|uuid>` – switch active thread.
- `/model [provider/model]` – get/set shared agent model.
- `/stop` – interrupt active run.
- `/status` – model, thread, run state.
- `/dashboard [YYYY-MM]` – KPI and chart images.
- `/topics on|off` – forum-topic routing (one thread per topic).

### 5.2 Behavior

- Private chats only; user allow-list.
- Accepts text, photos, images, PDFs.
- **Streaming:** Progressive message edits as text arrives; reasoning updates and tool lifecycle events appear in the timeline during the run.
- **Forum topics:** `/topics on` maps one Telegram topic ↔ one backend thread; messages in topic go to that thread.
- Pending review items as inline keyboards (approve/reject).
- Dashboard charts rendered as images (matplotlib).

---

## 6. iOS Features

- Dashboard tab: month view, KPIs, charts, reconciliation.
- Entries tab: list, detail, pull-to-refresh.
- Agent tab: threads, messages, run state, streaming, review cards.
- Composer: text + invoice/receipt attachments.
- Backend base URL configurable (env or scheme).

---

## 7. Finance Domain Features

### 7.1 Entries

- Manual entry ledger with income/expense/transfer tracking.
- Counterparty entities, tags, entry groups.
- Entry kinds: EXPENSE, INCOME, TRANSFER.
- Money in minor units per currency.
- **Entry editor:** Modal-based create and edit (Notion-like); properties plus optional markdown body. Swap from/to control. Ranked fuzzy tag picker. Multi-select manual group assignment; rule groups appear as read-only badges.

### 7.2 Entities

**What they are:** Counterparties in transactions — people, merchants, payees, banks, etc. Every entry has a "from" and "to" entity describing where money came from and went to.

**Types:**
- **Account entities:** Each account is an entity root; the account id and entity id are the same. These represent your bank accounts, wallets, etc.
- **Generic entities:** Non-account counterparties — stores, friends, landlords, employers. These live in the entity catalog and can be assigned taxonomy categories.

**Behavior:**
- When an entity is deleted, entries keep the preserved name text for historical display, but the link is cleared; the UI shows a missing-entity marker.
- Entity deletion is blocked if the entity has an associated account (must delete the account first).
- Tags describe what was spent on; entities describe who the transaction was with.

### 7.3 Accounts

Accounts are entity-root records (each account is also an entity). They represent bank accounts, wallets, etc., with optional markdown notes.

**Snapshots:** User-recorded bank balance checkpoints. The user adds snapshots manually from their bank app — they are not derived. Each snapshot has date, balance, and optional note. Snapshots partition the account timeline. Deleting a snapshot removes that checkpoint; reconciliation rebuilds around the remaining snapshots. List order is newest first.

**Reconciliation (interval-based):** Snapshots divide the timeline into intervals. For each pair of consecutive snapshots:
- Bank change = end balance − start balance (what the bank says changed).
- Tracked change = sum of entry effects in the interval (what you recorded).
- Delta = tracked change − bank change (untracked difference — "you're missing $X of transactions").

The most recent snapshot produces one **open interval** from that snapshot to today: tracked change only, no bank change or delta (no closing checkpoint yet). Entries on a snapshot date belong to the interval ending at that snapshot. **Reconciled** intervals (delta = 0) can be collapsed; **mismatched** intervals (delta ≠ 0) are highlighted so the user can find missing or incorrect entries.

**Delete semantics:** Deleting an account removes the account and its snapshots. Entries keep denormalized from/to labels; the UI shows missing-entity markers where the link was cleared.

### 7.4 Groups

- Unified groups with `manual` or `rule` source.
- Manual groups store explicit entry membership rows.
- Rule groups compute membership from a saved rule tree plus optional include/exclude override rows on individual entries.
- Groups workspace lists and edits groups; rule groups embed the shared rule editor from `frontend/src/features/groupRules/`.

### 7.5 Taxonomy

- Taxonomies, taxonomy terms, taxonomy assignments. Entity Categories and Tag Categories are first-class manageable tables.
- Entities and tags can be assigned to taxonomy terms (categories).
- Default entity categories: merchant, account, financial_institution, government, utility_provider, employer, investment_entity, person, placeholder, organization.
- Entry categories are seeded as a two-level taxonomy (housing, food_drink, transport, and related leaves). Tags remain auxiliary cross-cutting labels such as internal_transfer, e_transfer, cash_withdrawal, and needs_review.

### 7.6 Filter Groups

**What they are:** Reusable user-created filter definitions that classify entries for optional overlapping analytics.

**Default groups:** None. The list stays empty until a user creates a custom group.

**Rule model:** Each editable filter group has include and exclude conditions. Rules support entry kind, tag inclusion, tag exclusion, internal-transfer flag, and nested AND/OR logic.

**Usage:** Entry categories form the non-overlapping dashboard partition. Lifecycle (`fixed`, `day_to_day`, `one_time`, or null) is a disjoint cross-cut with category-leaf defaults and per-entry overrides. Filter groups remain auxiliary and may overlap. Internal transfers and cash withdrawals retain their exclusion behavior.

### 7.7 Dashboard

**Data rules:** Uses a single configurable dashboard currency; entries in other currencies are excluded from all calculations. Internal account-to-account transfers are excluded from KPIs, charts, and projections. Entries tagged `cash_withdrawal` are reported separately instead of counted as spending.

**Tabs and behavior:**
- **Overview:** Month/year toggle; KPI hero (expense, income, net) with expense minus one-time and cash withdrawn; total income vs expense trend; ranked category partition with sub-category detail; lifecycle and filter-group cross-cuts; category projection.
- **Daily Expense:** Day-to-day daily bar chart with average/median spend metrics; yearly mode switches to monthly filter-group bars.
- **Breakdowns:** Summary tag, destination, and source charts above a filter-group → tag → destination drill-down tree.
- **Breakdown:** Category, sub-category, destination, and entry drill-down.

**Navigation:** Scrollable timeline of months with visible expense or cash-withdrawal activity; no manual month picker. Yearly view assembled from repeated month-scoped reads.

### 7.8 Catalogs

- Entities, tags, users, filter groups.
- Currencies catalog (read-only).

---

## 8. Auth and Session

- Principal header for protected routes.
- Local principal session; startup gate until principal selected.
- Admin vs non-admin; admin required for agent routes.

---

## 9. Configuration and Data Paths

- **Config cascade:** Env vars → `.env` in CWD → `~/.config/bill-helper/.env` → defaults.
- **Data:** Default `~/.local/share/bill_helper/` for SQLite and agent uploads. Override via `BILL_HELPER_DATA_DIR` or `BILL_HELPER_DATABASE_URL`.
- Shared config and data support Git worktree workflows (secrets and DB shared across worktrees).

---

## 10. Dev Tooling

- **Config cascade:** Env vars → `.env` in CWD → `~/.config/bill-helper/.env` → defaults.
- **Data:** Default `~/.local/share/bill_helper/` for SQLite and agent uploads. Override via `BILL_HELPER_DATA_DIR` or `BILL_HELPER_DATABASE_URL`.
- Shared config and data support Git worktree workflows (secrets and DB shared across worktrees).

## 10. Dev Tooling

- Start backend, frontend, telegram (if configured).
- Seed defaults and demo data.
- Env setup, docs sync check.

---

## 11. Benchmark and Evaluation

- LLM evaluation for bank-statement parsing.
- Tags, entities, entries scoring.

---

## 12. Integration Points

- LiteLLM for model routing and credentials.
- SQLite for persistence.
- Telegram API for the bot.
- Not implemented: bank sync, CSV import, external financial APIs.
