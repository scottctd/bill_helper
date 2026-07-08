# Unified groups

## Status

Completed and archived on 2026-06-22.

## Problem

Entry groups and filter groups duplicated the same product idea: a named collection of entries. The split added maintenance cost without matching how the product used groups:

- **Entry groups** were typed (`BUNDLE`, `SPLIT`, `RECURRING`), nested, exclusive per entry, and exposed graph read models.
- **Filter groups** were rule-based, overlapping analytics cross-cuts with a separate `/filter-groups` API and workspace.

Graph topology, member roles, and child-group nesting drove validation and UI complexity but did not feed financial calculations.

## Implemented model

- One `groups` table with `source`: `manual` or `rule`.
- One `group_members` table for explicit manual membership and rule-group `include` / `exclude` overrides.
- Many-to-many manual membership; rule groups derive membership from `definition_json` plus optional overrides.
- Flat groups only: no `GroupType`, no nested child groups, no graph edges or `direct_group` / `group_path` read models.
- Unified `/api/v1/groups` API for create, list, detail, update, delete, and membership mutation.
- Dashboard auxiliary cross-cuts read from `dashboard.groups[]` (`DashboardGroupSummary`).
- Entry reads expose effective memberships through `groups[]`; entry list filtering uses `group_id`.

## Migration and data handling

- Migration `0049_unified_groups` merges legacy `entry_groups`, `entry_group_members`, and `filter_groups` into unified storage.
- Nested manual groups flatten to single-level names such as `Parent / Child`.
- Built-in filter groups were already removed by `0048_remove_builtin_filter_groups`; custom saved groups migrate forward as `source=rule` rows.

## Frontend and CLI changes

- `/groups` is the single groups workspace for manual and rule groups.
- `/filters` redirects to `/groups`; the separate Filters nav item was removed.
- Entry detail shows a flat `groups[]` badge list instead of a graph view.
- Entry editor supports multi-select manual group assignment; rule groups appear read-only.
- Rule editing lives in `frontend/src/features/groupRules/` and is embedded in the group detail modal.
- Group deep links use `/entries?group_id=...`.
- Agent proposals, CLI reference, and dashboard rendering were aligned to the unified model.

## Removed legacy surfaces

- `entry_groups`, `entry_group_members`, and `filter_groups` tables
- `/filter-groups` route family and `FilterGroupsPage`
- `GroupGraphView`, `GroupType`, `GroupMemberRole`, and graph APIs
- `direct_group` and `group_path` entry read-model fields

## Out of scope / follow-ups

- **Telegram** still references legacy `dashboard.filter_groups` response keys; update when that transport is revived.
- **iOS** still carries pre-unification group shapes; deferred per `AGENTS.md`.

## Verification

- migration regression: `backend/tests/test_migrations_core.py` covers `0048` and `0049`
- backend suite passed at implementation time
- frontend tests and production build passed at implementation time
- ADR: `docs/adr/0009-unified_groups.md`
- documentation sync check passed after doc updates in this archive pass

## Canonical references

- `docs/adr/0009-unified_groups.md`
- `docs/data_model.md` (`groups`, `group_members`)
- `docs/api/core_ledger.md` (Groups section)
- `docs/high_level_data_flow.md` (Unified Group Model)
- `docs/features/entry_lifecycle.md`
- `docs/features/dashboard_analytics.md`
- `frontend/docs/workspaces.md` (Groups, Entry detail)
