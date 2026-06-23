# API Core Ledger

## Accounts

### `POST /accounts`

Create an account.

Body:

- `owner_user_id` (optional)
- `name` (required)
- `markdown_body` (optional)
- `currency_code` (required)
- `is_active` (optional, default `true`)

Response: `AccountRead` (includes computed `balance_minor`, `balance_as_of`, and optional `latest_snapshot_at`)

Behavior:

- account id is the shared entity-root id
- use `/accounts`, not `/entities`, for all new account-like records
- response no longer includes `entity_id`
- `balance_minor` is tracked balance as of `balance_as_of` (server date when omitted elsewhere):
  - with a latest snapshot: `snapshot.balance_minor + net entry effects since that snapshot date`
  - without a snapshot: net entry effects from the beginning through `balance_as_of`

### `GET /accounts`

List accounts. Response: `AccountRead[]`

Behavior: results are principal-scoped by account owner; each row includes the computed balance fields above.

### `PATCH /accounts/{account_id}`

Partial update.

Body fields:

- `owner_user_id`
- `name`
- `markdown_body`
- `currency_code`
- `is_active`

Response: `AccountRead`

Behavior: account lookup and update are principal-scoped.

Errors:

- `422` when no updatable fields are provided

### `DELETE /accounts/{account_id}`

Delete an account root. Response: `204`

Behavior:

- account lookup and delete are principal-scoped
- deletes account snapshots
- clears `from` or `to` account FKs while preserving visible label text

### Snapshot And Reconciliation Endpoints

- `POST /accounts/{account_id}/snapshots` -> `SnapshotRead`
- `GET /accounts/{account_id}/snapshots` -> `SnapshotRead[]`
- `DELETE /accounts/{account_id}/snapshots/{snapshot_id}` -> `204`
- `GET /accounts/{account_id}/reconciliation` -> `ReconciliationRead`

Behavior:

- snapshot create/list/delete are principal-scoped through the parent account lookup
- deleting a snapshot removes only that stored checkpoint; the account and ledger entries remain unchanged
- reconciliation returns full interval history, not one absolute ledger-vs-balance delta
- interval boundaries are `(start_snapshot_date, end_snapshot_date]`, so entries on a snapshot date belong to the interval ending at that snapshot
- `tracked_change_minor` is the net balance effect for the account in that interval:
  - `from_entity_id == account.id` subtracts `amount_minor`
  - `to_entity_id == account.id` adds `amount_minor`
- each response includes:
  - `intervals[]`
  - `start_snapshot`
  - `end_snapshot` or `null` for the open interval
  - `tracked_change_minor`
  - `bank_change_minor` for closed intervals only
  - `delta_minor` for closed intervals only
  - `entry_count`

## Entries

### `POST /entries`

Create entry.

Body:

- `kind` (`EXPENSE` | `INCOME` | `TRANSFER`)
- `occurred_at`
- `name`
- `amount_minor`
- `currency_code`
- `from_entity_id` / `to_entity_id` (optional)
- `owner_user_id` (optional)
- `from_entity` / `to_entity` / `owner` (optional name fallbacks)
- `group_ids` (optional string array of manual group ids)
- `markdown_body` (optional)
- `tags` (optional string array)

Response: `EntryRead`

Behavior:

- new entries start with no group memberships until manual groups are assigned or rule groups match
- tag names are normalized to lowercase
- missing tags are auto-created with random colors
- owner defaults to the authenticated principal if omitted
- ownership is scoped to the requesting principal
- create flow can assign many manual groups inline through `group_ids`
- embedded `tags` use the lightweight `TagSummaryRead` shape (`id`, `name`, `color`, `description`, `type`) and do not include catalog usage counts
- read models include `from_entity_missing` / `to_entity_missing` when preserved labels remain after entity/account deletion
- read models expose effective group memberships through `groups[]` (`id`, `name`, `source`, optional `color`)

### `GET /entries`

List entries with filters.

Query params:

- `start_date`, `end_date`
- `kind`, `tag`, `currency`
- `category` (entry-category leaf or top-level parent name; `uncategorized` matches entries without a category)
- `source`
- `from_entity` (repeatable; case-insensitive exact match on the entry's preserved `from_entity` label)
- `to_entity` (repeatable; case-insensitive exact match on the entry's preserved `to_entity` label)
- `account_id`
- `group_id` (matches entries in the group, including rule-derived membership and overrides)
- `limit` (default `50`, max `200`)
- `offset`

Response: `EntryListResponse`

Behavior:

- list results are principal-scoped by `owner_user_id`
- category filtering matches one leaf exactly or all assigned child categories under a selected top-level parent
- when `group_id` is provided, results are reduced to entries whose effective membership includes that group
- each row includes `from_entity_missing` / `to_entity_missing`
- each row includes `groups[]`
- each row's `tags` list uses `TagSummaryRead`, not the `/tags` catalog contract

### `GET /entries/{entry_id}`

Get entry detail. Response: `EntryDetailRead`

Behavior:

- lookup is principal-scoped
- response includes missing-entity flags
- response includes `groups[]`
- response `tags` remain lightweight summaries without `entry_count`

### `POST /entries/tag-suggestion`

Request AI tag suggestions for an entry draft.

Body:

- `entry_id` (optional, for edit-mode self-exclusion)
- `kind`
- `occurred_at`
- `currency_code`
- `amount_minor` (optional)
- `name` (optional)
- `from_entity_id` / `from_entity` (optional)
- `to_entity_id` / `to_entity` (optional)
- `owner_user_id` (optional)
- `markdown_body` (optional)
- `current_tags` (required string array, used only as weak context)

Response: `{ "suggested_tags": string[] }`

Behavior:

- request is principal-scoped and does not create an agent thread or persisted run
- the route accepts partial drafts so the shared entry editor can use it in both create and edit flows
- suggestions can only return names from the existing tag catalog; unknown tags are rejected as errors
- prompt context includes the current draft, current tag descriptions, and up to 9 similar tagged entries
- if `entry_tagging_model` is blank or invalid in runtime settings, the route returns `400`
- provider/runtime failures return `503`

### `PATCH /entries/{entry_id}`

Partial update. Response: `EntryRead`

Body fields may include any editable entry fields plus:

- `group_ids` (replaces manual group memberships for the entry)

Behavior:

- update is principal-scoped
- update can add or remove manual group memberships through `group_ids`
- rule-group membership is not edited through entry payloads; use group member overrides instead

### `DELETE /entries/{entry_id}`

Soft-delete entry and remove group memberships. Response: `204`

Behavior: delete is principal-scoped.

## Groups

Unified groups cover both manual entry collections and saved rule-based analytics cross-cuts.

### `POST /groups`

Create a group.

Body:

- `name` (required)
- `description` (optional)
- `color` (optional)
- `source` (`manual` | `rule`, default `manual`)
- `rule` (required when `source=rule`)
  - `include` (`group`)
  - `exclude` (`group`, optional)

Response: `GroupRead`

Behavior:

- group ownership is scoped to the requesting principal
- manual groups cannot include a rule
- rule groups require a recursive include/exclude rule tree

### `GET /groups`

List group summaries. Response: `GroupSummaryRead[]`

Behavior:

- responses are principal-scoped
- each row includes `source`, optional `rule_summary`, member counts, date range summary, and display order

### `GET /groups/{group_id}`

Fetch one group. Response: `GroupRead`

Behavior:

- lookup is principal-scoped
- manual groups return explicit member rows
- rule groups return parsed `rule`, member override rows, and derived member counts

### `PATCH /groups/{group_id}`

Update one group. Response: `GroupRead`

Body fields:

- `name`
- `description`
- `color`
- `rule` (rule groups only)

Behavior:

- manual groups may update name, description, and color only
- rule groups may also update `rule`
- `422` when no updatable fields are provided

### `DELETE /groups/{group_id}`

Delete a group. Response: `204`

Behavior:

- group lookup is principal-scoped
- deleting a group removes its `group_members` rows; entries are unchanged

### `POST /groups/{group_id}/members`

Add one membership row.

Body:

- `entry_id`
- `override` (`include` | `exclude`, required for rule groups; omitted for manual groups)

Response: `GroupRead`

Errors:

- `400` invalid payload or domain-rule violation
- `404` target entry not visible to the principal
- `409` duplicate membership

### `DELETE /groups/{group_id}/members/{membership_id}`

Remove one membership row. Response: `204`

Behavior:

- manual groups remove explicit member rows
- rule groups only allow removing override rows, not rule-derived implicit membership

## Group Rules

- manual groups store explicit many-to-many entry membership
- rule groups evaluate recursive include/exclude trees over entry kind, tags, category, entities, amounts, dates, and internal-transfer status
- rule groups support per-entry `include` and `exclude` overrides through `group_members`
- overlapping rule groups are allowed and are auxiliary dashboard cross-cuts

## Dashboard

### `GET /dashboard/timeline`

Response: `{ months: string[] }`

Behavior:

- returns the ascending list of visible `YYYY-MM` periods that have expense or cash-withdrawal activity in the dashboard currency
- excludes internal account-to-account transfers from expense activity using the same rules as the main dashboard analytics
- results are principal-scoped and drive the frontend's discrete month/year timeline picker

### `GET /dashboard`

Query params:

- `month` (`YYYY-MM`, optional)

Response: `DashboardRead`

Current sections include:

- `month`
- `currency_code`
- `kpis`
- `groups[]` (saved rule-group cross-cuts with totals and shares)
- `daily_spending[]`
- `monthly_trend[]`
- `spending_by_from[]`
- `spending_by_to[]`
- `spending_by_tag[]`
- `income_by_from[]`
- `weekday_spending[]`
- `largest_expenses[]`
- `projection`
- `reconciliation[]`

Behavior:

- dashboard expense classification uses the entry-category partition and lifecycle axis
- user-created rule groups appear only as optional overlapping cross-cuts in `groups[]`
- totals and reconciliation are principal-scoped
- analytics exclude internal transfers when both endpoints resolve to account-backed entity roots
- entries tagged `cash_withdrawal` are excluded from spending analytics and exposed as `kpis.cash_withdrawal_total_minor`

### `GET /dashboard/batch`

Query params:

- `months` (repeatable `YYYY-MM`, required, min 1, max 24)

Response: `{ dashboards: DashboardRead[] }`

Behavior:

- returns one `DashboardRead` per requested month, sorted ascending by month key
- duplicate month keys in the query are ignored
- invalid month formats return `422`
- each dashboard payload matches the single-month `GET /dashboard` contract and is principal-scoped
- `monthly_trend[]` continues to include `income_total_minor` plus category and lifecycle expense buckets
