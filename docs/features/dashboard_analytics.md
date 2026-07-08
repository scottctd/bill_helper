# Feature Map: Dashboard Analytics

This doc is the fast path for understanding dashboard category partitioning, lifecycle cross-cuts, and chart mapping.

## Scope

- `GET /api/v1/dashboard`
- `GET /api/v1/dashboard/timeline`
- `GET /api/v1/agent/dashboard`
- unified `/api/v1/groups` for saved rule groups (`source=rule`)
- dashboard-specific backend aggregations
- frontend dashboard tabs/charts and the unified groups workspace at `/groups` (`/filters` redirects here)

## Data Boundary Rules

- Dashboard analytics use the runtime-configured dashboard currency (`/settings.dashboard_currency_code`).
- Entries in other currencies are excluded from dashboard calculations.
- Entries whose `from_entity_id` and `to_entity_id` both resolve to account-backed entity roots (`accounts.id` membership) are treated as internal transfers and excluded from dashboard KPIs, expense charts, breakdowns, largest-expense ranking, and projection math.
- Entries tagged `cash_withdrawal` are excluded from expense analytics and reported separately as `kpis.cash_withdrawal_total_minor`.

## Category, Lifecycle, and Groups

Every expense is assigned to exactly one dashboard partition bucket:

- `entry_category` is a principal-owned single-cardinality taxonomy with at most one parent/child level.
- category assignments render as paths such as `food_drink/groceries`.
- entries without a category appear under `Uncategorized`.
- top-level category totals always sum to `kpis.expense_total_minor`.

`Entry.lifecycle` is nullable and accepts `fixed`, `day_to_day`, or `one_time`. Category leaves can define `metadata_json.default_lifecycle`; entry values remain explicit overrides. Lifecycle totals are disjoint and also sum to total expense.

Saved rule groups are optional user-created overlapping cross-cuts exposed in `dashboard.groups[]`. No built-in groups are provisioned. Group totals are never used as the dashboard partition.

Rule fields include:

- `entry_kind is ...`
- `tags has_any [...]`
- `tags has_none [...]`
- `category`, `from_entity`, `to_entity`, amount and date predicates
- `is_internal_transfer is true|false`
- nested `AND` / `OR` groups
- separate `include` and optional `exclude` trees

The `one_time` concept is lifecycle data, not a tag or rule group.

## Backend Flow

1. `backend/routers/dashboard.py` validates the `month` format, exposes both the month payload and a discrete expense-period timeline feed, and delegates to `backend/services/finance_dashboard.py`.
2. `backend/services/groups.py` loads the caller's saved rule groups and returns parsed rule definitions.
3. `backend/services/finance_dashboard.py` coordinates scoped reads and monthly trend queries; `backend/services/finance_dashboard_rollups.py` computes:
   - overall expense/income/net KPIs
   - cash-withdrawal total for the selected period
   - category partition and category/destination/entry drill-down
   - lifecycle totals and one-time/core-spend KPIs
   - auxiliary rule-group cross-cuts in `groups[]`
   - daily and monthly category totals
   - from/to/tag breakdowns
   - income-by-source breakdown (`income_by_from[]`)
   - weekday distribution
   - largest expenses with category path and lifecycle
   - current-month projection plus projected category totals
4. `backend/routers/agent_dashboard.py` exposes a separate principal-scoped agent usage read model backed by `backend/services/agent_dashboard.py`; it filters to finished runs, derives USD pricing from persisted token counters, and returns KPI cards, time buckets, token slices, model rows, surface rows, and top expensive runs.
5. `backend/routers/groups.py` exposes CRUD for both manual and rule groups.
6. `backend/routers/entries.py` can apply a saved group server-side via `group_id`, so the entries workspace can open the exact matching ledger rows for any group.

## Frontend Mapping

`frontend/src/pages/DashboardPage.tsx`:

- Persistent finance chrome (hidden on the `Agent` tab):
  - unified Income / Expense / Net summary hero with color-coded values
  - secondary summary row with `Expense excluding one-time` derived from lifecycle totals, plus cash withdrawn for the selected month or year
  - `Income vs Expense Trend` chart using total income and total expense with compact values above each bar
  - explicit `Month` / `Year` mode toggle and timeline strip in the dashboard workspace toolbar
- `Spending` tab:
  - ranked expense-by-category partition with stable muted parent colors and related sub-category color variations
  - lifecycle and auxiliary rule-group cross-cut cards from `dashboard.groups[]`
  - spending-by-destination horizontal bar chart in two columns (up to twenty destinations, shared sqrt scale)
  - monthly mode: daily total-expense bars plus category projection for the current month
  - yearly mode: average/median expense-month metrics and monthly total expense vs income
- `Breakdown` tab:
  - expense breakdown tree: category → sub-category → destination with inline entry rows
  - month mode uses the selected month payload
  - year mode aggregates tag/destination/entry drill-down data across the selected year
- `Income` tab:
  - horizontal bar chart for `income_by_from[]` (payer/source breakdown)
  - year mode aggregates `income_by_from[]` across the selected year and shows a scope note
- `Agent` tab:
  - separate agent spend controls for `7d` / `30d` / `90d` / `all`
  - model and surface toggle filters backed by `GET /api/v1/agent/dashboard`
  - KPI cards for cost, token volume, average spend, cache hit rate, dominant model, and failure rate
  - cost-over-time area chart, input/output token pie, surface comparison bars, model breakdown table, and top expensive-run table
- `frontend/src/pages/GroupsPage.tsx`:
  - unified `/groups` workspace for manual and rule groups (`/filters` redirects here)
  - rule groups embed the guided include/exclude editor via `GroupRuleEditorSection`
  - backed by `/api/v1/groups`
  - nested logic remains available through an `Advanced` mode that opens automatically for already-nested rules
  - tag conditions reuse the shared `TagMultiSelect` instead of a comma-separated text field
  - per-group deep links into `/entries?group_id=...`

Interactive charting is powered by Recharts.
`frontend/src/features/groupRules/` renders the guided and advanced rule editors embedded in the group detail modal.

## Tests

- `backend/tests/test_finance.py` validates category/lifecycle partition sums, custom rule-group overlap, path rendering, lifecycle overrides, and exclusion of internal account-to-account transfers.
- `backend/tests/test_migrations_core.py` validates category/lifecycle backfill, the canonical category-schedule replacement, removal of persisted built-in filter groups, and unified-group migration `0049_unified_groups`.
- `backend/tests/test_entry_category_backfill_script.py` validates guarded dry-run and apply behavior for audited ambiguous classifications.
- `backend/tests/test_cli_dashboard.py` and `backend/tests/test_cli_dashboard_support.py` validate `bh dashboard` scope, section filtering, and API wiring.

## Agent CLI

Agents can read dashboard analytics without re-aggregating entries manually:

- `bh dashboard timeline` lists expense-active months.
- `bh dashboard finance get` wraps `GET /dashboard` and `GET /dashboard/batch` with section filters.
- `bh dashboard agent get` wraps `GET /agent/dashboard` with range/model/surface filters.

Use `--format json --sections categories` when the agent needs the category → destination → entry tree. See `backend/cli_reference/specs.py` and `bh dashboard finance get --help` for the full section list.

## Operational Notes

- Projection fields are null for non-current months, so the overview projection card shows an unavailable message outside the current month.
- Shares in `dashboard.groups[*].share` are calculated against total monthly expense; overlapping rule groups can make the summed shares exceed `1.0`.
- The yearly dashboard view is assembled on the frontend from repeated month-scoped `GET /api/v1/dashboard` reads for the selected year and its previous year; no separate yearly endpoint exists yet.
- `GET /api/v1/dashboard/timeline` returns the discrete month list with visible expense or cash-withdrawal activity; the frontend derives the visible year list from that month feed.
- Agent usage analytics are range-based rather than month/year-based; the `Agent` tab keeps its own filters and does not reuse the finance dashboard period selection state for queries.
