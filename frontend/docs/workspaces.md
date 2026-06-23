# Frontend Workspaces

# Shared Page Chrome

- the main ledger workspaces share the same page vocabulary:
  - sidebar nav labels are the canonical route titles; visible page headers were removed to avoid repeating them
  - an sr-only route `<h1>` in the app shell preserves page landmarks for screen readers
  - `WorkspaceSection` for the primary table/form surface
  - `WorkspaceToolbar` with `workspace-table-toolbar` for filters, search, and compact actions
  - `StatBlock` for dense metric summaries where a card grid would be too decorative
- table workspaces use `workspace-table-body` on `WorkspaceSection` so toolbars sit flush to the card top and tables share the same inset padding
- list workspaces share a compact filter toolbar pattern: text search plus one or more fine-grained controls (`TagMultiSelect` with `displayMode="compact"` for enum-like dimensions, or `NativeSelect` for small fixed sets); shared helpers live in `frontend/src/lib/workspaceFilters.ts`
- the shared app scroll container reserves vertical scrollbar gutter space even when a page does not overflow, so route-level content edges stay aligned across pages like `Agent`, `Filters`, and `Entries`; the route scrollbar thumb stays visually hidden at rest and only appears during active page scrolling
- settings remains the exception in structure because its sticky toolbar is still the primary page header pattern

## Entries

### `frontend/src/pages/EntriesPage.tsx`

- lists, filters, edits, and deletes entries
- route shell uses one primary workspace section without a redundant route title above the card
- filter toolbar is a deliberate two-row layout in `frontend/src/features/entries/EntriesFilterToolbar.tsx`:
  - row 1: `From date` / `To date`, compact `From entity` / `To entity`, and searchable `Category`
  - row 2: `Kind`, `Source text`, compact `Tags`, compact `Currencies`, and the compact `+` add action
- `From date` / `To date` map to the backend `start_date` / `end_date` query params and sync to the URL for shareable links
- `From entity` / `To entity` map to repeated `from_entity` / `to_entity` query params and filter server-side on the preserved entry labels
- invalid date ranges (`From` after `To`) show an inline error and skip the entries fetch until corrected
- `Tag` and `Currency` filters use compact multi-select triggers (`displayMode="compact"`) so selected values stay on one line; chip selection happens inside the floating menu
- tag and currency filtering still happens client-side on loaded rows only; the toolbar status line calls out active filters and offers `Clear filters`
- the category selector includes top-level and full-path child categories plus `uncategorized`, syncs with the `category` URL search param, and filters server-side
- `filter_group_id` deep links remain supported for the Filters workspace even though filter groups are no longer exposed in the entries toolbar
- entry rows are loaded incrementally in backend-sized pages; reaching the bottom of the table auto-loads the next slice and a fallback `Load more` button remains visible while more rows exist
- date column is fixed-width and no-wrap
- name cells show the primary name plus a compact `from -> to` secondary line
- amount cells combine the kind marker with the numeric value, reusing the existing `+ / - / ~` tone colors on the symbol itself with tight inline spacing
- tag cells render colored chips using configured tag colors or the shared deterministic fallback color
- the name and tags columns use balanced preferred widths so tags can expand when there is room, while still yielding space before the name column on tighter layouts
- row delete actions use compact trash-can icon buttons with accessible labels instead of inline `Delete` text, and their icon-only action headers are visually hidden to keep the column minimal
- rows show a `Missing entity` badge when preserved labels remain after entity or account deletion
- entry create modal resolves default currency from runtime settings
- entry create/edit modal supports multi-select manual group assignment; rule groups appear as read-only badges
- entry create/edit modal keeps the markdown notes editor inside the shared field grid with a labeled `Notes` row instead of a detached full-width block
- entry create/edit modal includes a compact swap icon control between the `from` and `to` selectors to swap both field values in one click
- entry create/edit modal tag picking supports fuzzy search and ranks the strongest matches first before falling back to create-new
- entry create/edit modal treats re-selecting a same-name existing entity as a real relink, so preserved missing labels can be restored without renaming the field
- entry create/edit modal does not expose owner controls; submitted entries stay bound to the authenticated user's current scope
- entry create/edit modal adds an inline AI tag-suggestion button beside the tag picker; it uses the current draft plus similar tagged entries, replaces the current modal tag selection on success, and aborts cleanly on second click or modal close without entering the agent workspace/history

### `frontend/src/pages/EntryDetailPage.tsx`

- shows entry detail, direct-group context, and the direct-group graph when the entry is assigned
- uses `direct_group` and `group_path` from `GET /entries/{entry_id}` instead of rendering raw link rows
- popup editing includes the same direct-group and split-role controls as the entries page modal
- routes structural edits into the groups workspace via a dedicated `Open groups workspace` action
- editing uses the shared popup editor and the same runtime-settings defaults as create flow
- custom entity, tag, category, and group menus share a dialog-owned floating layer so their option lists remain scrollable inside modal scroll-lock; searchable single-select menus keep a fixed search field above independently scrollable results, entry-category menus use a viewport-clamped 320px minimum width for readable paths, and lifecycle remains a basic non-searchable single select
- entry-category management stores and displays descriptions for both parent and sub-categories; descriptions are searchable and editable from the same create/edit dialogs
- detail cards show `Missing entity` badges when preserved `from` or `to` labels no longer have linked entity records
- the entries table promotes `Category` and `Lifecycle` to first-class columns; category pills show only the leaf/sub-category while retaining the full path as a tooltip, entry detail shows the full `parent/sub_category` path, and lifecycle labels use lowercase `fixed`, `day-to-day`, and `one-time`
- category and lifecycle selects use plain colored dots with text inside the select controls and menus; category colors are stable by parent family and sub-categories use related variations

## Entities

### `frontend/src/pages/EntitiesPage.tsx`

- dedicated first-class entity workspace at `/entities`
- page is a thin orchestrator over `frontend/src/features/entities/*`
- route shell now uses the shared page header plus one primary workspace section
- generic entity management stays focused on non-account counterparties; account-backed entity roots remain managed from `Accounts`
- table shows `Name`, `Category`, a net-money aggregate column, and icon-only row actions
- toolbar includes name search plus compact category multi-select filtering
- rows open the edit dialog on double-click and keep delete isolated behind the compact trash action
- create and edit dialogs reuse entity-category taxonomy terms plus existing category values as suggestions
- net-money values only render as an amount when the entity's visible entries share one currency; mixed-currency entities show a fallback label instead of a misleading sum
- delete confirmation warns when preserved entry labels will show a missing-entity marker

## Groups

### `frontend/src/pages/GroupsPage.tsx`

- dedicated first-class group workspace at `/groups`
- `/filters` redirects to `/groups`
- route shell uses the shared page header plus one primary workspace section
- organized around a searchable groups table; each row opens a group-detail modal on double-click and a fallback `View` action
- toolbar includes name search plus compact group-source multi-select filtering (`manual` / `rule`)
- browser table data comes from `GET /groups`
- group detail modal content comes from `GET /groups/{group_id}`
- supports create, rename, delete, add-entry membership, pin/exclude overrides on rule groups, and remove-member flows
- manual groups store direct entry membership; rule groups compute effective membership from saved rules plus optional include/exclude overrides
- group detail modal uses a sticky header with summary chips, compact statistics, and a date-first member table; rule groups embed the rule editor below members
- entry editor assigns manual groups via multi-select; rule groups appear read-only on entries

## Accounts

### `frontend/src/pages/AccountsPage.tsx`

- page is a thin orchestrator; domain state lives in `frontend/src/features/accounts/useAccountsPageModel.ts`
- route shell now uses the shared page header plus one primary workspace section
- toolbar includes name search plus compact currency and owner multi-select filters and an active/inactive status select
- UI is split into `AccountsTableSection`, `ReconciliationSection`, `SnapshotHistoryTable`, `SnapshotCreatePanel`, and `AccountDialogs`
- create, edit, and delete flows are dialog-driven
- account rows single-select on click and open edit on double-click; delete remains the only explicit row action and is rendered as a compact icon button
- the accounts table shows a computed `Balance` column from `Account.balance_minor` (tracked balance as of `balance_as_of`)
- account ids are shared entity-root ids; generic entity management does not expose them as editable entity rows
- account creation edits `Name`, `Currency`, and `Notes`; owner is implicit from the authenticated user's current scope
- the account edit modal is untabbed and fixed-height: a pinned footer holds `Save changes` / `Cancel`, while a scrollable body carries account details plus reconciliation and snapshot history
- on large screens the lower workspace is two-column: reconciliation and snapshot history scroll inside the left column while snapshot creation stays fixed at the top of the right column; below `lg`, the same snapshot panel stacks as its own card beneath the history column inside the scroll body, separated from the pinned modal footer
- legacy `institution` and `type` fields are removed
- reconciliation and snapshot history inside the edit modal are driven by the selected row that opened it
- snapshot history rows expose per-snapshot delete actions with confirmation
- delete confirmation warns that snapshots are removed and preserved entry labels will surface missing-entity markers

## Properties

### `frontend/src/pages/PropertiesPage.tsx`

- page is a thin orchestrator over `frontend/src/features/properties/*`
- route shell now uses the shared page header plus one primary workspace section
- section navigation and content rendering are split into dedicated components
- section state, form state, queries, and filtered data live in focused hooks
- tags toolbar includes search plus compact tag-type multi-select filtering; currencies toolbar includes search plus built-in/placeholder status filtering
- editable sections use modal-driven create and edit flows
- editable sections now cover tags plus taxonomy term tables; user CRUD moved to `/admin`
- taxonomy term tables expose `Entity Categories` and `Tag Types`
- tags have destructive confirmation dialogs
- tag row delete controls use compact icon buttons with subdued shared table action styling; destructive emphasis is reserved for confirmation
- tag delete warns when existing entry-tag associations will be removed
- currencies remain read-only

## Auth And Admin

### `frontend/src/pages/LoginPage.tsx`

- password-only sign-in surface
- stores the opaque session token in `bill-helper.session-token`
- redirects back to the originally requested protected route after success

### `frontend/src/pages/AdminPage.tsx`

- admin-only workspace for user and session management
- supports create, rename, role changes, password reset, delete, and `Log in as`
- session table can revoke bearer tokens without deleting the owning user

## Dashboard

### `frontend/src/pages/DashboardPage.tsx`

- tabbed analytics surface with `Spending`, `Breakdown`, `Income`, and `Agent`; tab buttons have no secondary description line under the row
- persistent finance chrome above the tabs (hidden on `Agent`): unified Income / Expense / Net summary hero plus the `Income vs Expense Trend` chart
- route shell uses the shared page header, a shared control surface, and the summary hero instead of separate top-line KPI stat blocks
- includes an explicit `Month` / `Year` mode toggle
- month and year scope use separate horizontal strips in the workspace toolbar: **View** (Month/Year toggle), **Year** (scrollable year chips), and **Month** (Jan–Dec for the selected year, scrollable, disabled in year view); on small screens those stack full-width; year chips are oldest-to-newest left-to-right with the newest toward the trailing edge; month chips always show all twelve calendar months for the selected year and disable months without ledger data; vertical wheel on a strip maps to horizontal scrolling; click to select; arrow keys step selection when a strip is focused
- only expense-bearing months/years appear in the timeline feed from the API
- yearly mode moves annual trend charts into the active dashboard view instead of hiding them only inside `Insights`
- uses Recharts with measured containers so charts render only after non-zero dimensions are available
- dashboard totals and charts exclude internal transfers when both endpoints resolve to account-backed entity roots
- monthly expense partitioning is driven by the single-select entry-category taxonomy; lifecycle and saved filter groups are disjoint and overlapping cross-cuts respectively
- the canonical category tree separates internet from phone, fuel from parking, entertainment from software tools, and uses the auxiliary `travel` tag for travel context
- year mode loads month-scoped dashboard reads through `GET /api/v1/dashboard/batch` for the selected and previous calendar years instead of fanning out per-month requests on initial page load
- month view loads only the timeline, the selected month, and (when the Breakdowns tab is active) the previous month for month-over-month comparison; year mode is deferred until the user selects `Year`, with optional prefetch on hover/focus of the year toggle
- initial dashboard paint uses a progressive skeleton shell (header, toolbar placeholders, stat/chart blocks) instead of a full-page loading gate; the sidebar prefetches the dashboard route chunk plus timeline/current-month queries on hover/focus
- heavy tabs (`Agent`) are lazy-loaded on first activation
- the monthly and yearly `Income vs Expense Trend` charts compare total income and expense; month view fixes the trend window to the last six months ending at the client's current calendar month
- `Spending` shows the ranked category partition, lifecycle and filter-group cross-cuts, spending-by-destination bars, daily total expense, and category projection
- the current-month projection area uses category totals with projected growth
- `Breakdown` shows the category → sub-category → destination drill-down tree; year mode aggregates the category tree across the selected year

## Import

### `frontend/src/pages/ImportPage.tsx`

- dedicated multi-file import workspace at `/import` with job list, create flow, and job detail tabs
- feature modules under `frontend/src/features/import/*`:
  - `ImportWorkspace.tsx`: list/create/detail tab shell
  - `ImportCreatePanel.tsx`: attachment upload, sha256 preflight re-import chooser, segmented Import/Skip per-file control, and job start form
  - `ImportJobDetailView.tsx`: progress, task table with Conversation/Review actions, cancel/retry; the Review button reuses the shared `agent-panel-review-button` treatment and opens `ImportJobReviewModal.tsx`
  - `ImportJobReviewModal.tsx`: renders the shared `ReviewPanel` shell (`frontend/src/features/review/*`) with a TOC of canonical proposals, read-only `ReviewItemCard` (summary/context/details/outcome sections), and batch + per-item approve/reject; aggregated proposals are mapped via `review/mapImportProposal.ts` with shared payload-based TOC subtitles, clickable `Source` metadata links that open the import-task conversation, and duplicate-merge warnings in `Context`
  - `ImportTaskDialog.tsx`: fixed-height conversation dialog with header meta, an `AgentThreadUsageBar` cost/usage strip, internal timeline scroll, and the shared `AgentComposer` for follow-up messages (`useImportTaskTimeline.ts`)
- API client lives in `frontend/src/lib/api/import.ts` with types in `frontend/src/lib/types/import.ts`
- default job concurrency comes from runtime setting `agent_bulk_max_concurrent_threads` (settings UI: import concurrent workers)
- import task threads are hidden from the Agent thread list but stream through the standard agent run SSE endpoint

## Settings

### `frontend/src/pages/SettingsPage.tsx`

- thin route shell over `frontend/src/features/settings/*`
- tabbed runtime settings workspace with `General` and `Agent` tabs, each rendering focused section cards
- uses a compact sticky top toolbar as the first page element, including the `Settings` title, section tabs, save action, and reset-to-server-default from a dedicated `General` tab reset section
- settings changes invalidate dependent query surfaces
- query, mutation, and form orchestration live in `frontend/src/features/settings/useSettingsPageModel.ts`
- reusable runtime-settings parsing and payload validation live in `frontend/src/features/settings/formState.ts`
- `General` groups ledger default currencies and the reset-to-server-default action
- `Agent` groups memory/models, provider overrides, run limits, import concurrency and attachment limits, and reliability into separate sections
- section UI is split across `SettingsToolbar.tsx`, `SettingsGeneralSection.tsx`, `SettingsAgentSection.tsx`, and `ResetSettingsDialog.tsx`
- `Agent memory` lives under the `Agent` tab, is edited as one item per line, persists as a list of strings, and is sent to every backend agent system prompt
- `Available models` is a single table-style editor (model id + optional display label per row, add/remove, drag reorder via grip handle) that persists ordered ids and labels together; `Default model` and `Default tagging model` sit below it and list the same ids with display labels when set (including server default labels for the built-in catalog)
- `Default tagging model` is a separate optional dropdown sourced from the same available model list; leaving it blank disables inline entry tag suggestion, and removing the selected model from the list auto-clears it back to blank
- import concurrency defaults the Import tab worker pool (`agent_bulk_max_concurrent_threads`); the per-message attachment limit applies only to single Agent composer sends
- agent provider overrides use a compact toggle; when off the custom endpoint/key fields are hidden and saving falls back to server env values from `.env` or process env
