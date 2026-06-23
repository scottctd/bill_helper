# ADR 0009: Unified Groups

- Status: accepted
- Date: 2026-06-22
- Deciders: Bill Helper maintainers

## Context

Entry groups and filter groups duplicated overlapping concepts: principal-owned named collections of entries with optional rule definitions. Typed group graphs (`BUNDLE`, `SPLIT`, `RECURRING`) and nested child groups added complexity that did not match how the product uses groups today. Dashboard analytics and manual entry organization both needed the same rule engine and membership model.

## Decision

- Replace `entry_groups`, `entry_group_members`, and `filter_groups` with unified `groups` and `group_members` tables (migration `0049_unified_groups`).
- Model groups with `source`: `manual` (explicit membership) or `rule` (recursive include/exclude definitions in `definition_json`).
- Allow many-to-many entry membership for manual groups; rule groups derive membership from rules plus optional per-entry `include` / `exclude` overrides in `group_members`.
- Expose one `/groups` API for create, list, detail, update, delete, and membership mutation.
- Remove `GroupType`, graph read models, child-group nesting, and the separate `/filter-groups` route family.
- Keep dashboard auxiliary cross-cuts on saved rule groups, now served from the unified groups table.

## Consequences

- `0005-filter_group_analytics.md` is superseded for persistence and API shape; saved rule groups remain the dashboard cross-cut concept under unified storage.
- Historical typed-group and nested-group data are flattened during migration; nested manual groups become single-level names such as `Parent / Child`.
- Entry reads expose `groups[]` instead of `direct_group` / `group_path`; entry list filtering uses `group_id`.
- Clients that managed filter groups must call `/groups` with `source=rule` instead of `/filter-groups`.
