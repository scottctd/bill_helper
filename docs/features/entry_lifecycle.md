# Feature Map: Entry Lifecycle

This doc is the fast path for understanding how entries are created, edited, grouped, and reviewed.

## Scope

- manual entry CRUD
- unified groups (manual membership and rule-derived membership)
- agent-proposed entry CRUD (review-gated)

## Contract Summary

- Entry domain fields are defined in `backend/models_finance.py` and `backend/schemas_finance.py`.
- Entry-level `status` is removed from the current model/API.
- Review status exists only on `agent_change_items`.
- Entry read models expose effective group memberships through `groups[]`.

## Manual Entry Flow

1. UI submit from `frontend/src/components/EntryEditorModal.tsx`.
   - the modal exposes a compact swap icon control that swaps the `from` and `to` entity fields in place before submit
   - the shared tag picker supports ranked fuzzy search, so partial abbreviations surface the closest existing tags before the create-new action
2. Optional manual-group assignment is chosen in the same modal through `group_ids`.
3. Request via `frontend/src/lib/api.ts` (`createEntry` or `updateEntry`).
4. HTTP boundary in `backend/routers/entries.py` parses request models and maps service policy failures to HTTP responses.
5. Typed entry workflow orchestration in `backend/services/entries.py`:
   - entry create/update commands with typed `EntityRef` / `UserRef` service refs
   - principal-scoped account/user/group loading
   - tag/entity/user normalization
   - manual-group membership assignment through `set_entry_manual_group_ids`
6. Supporting service helpers:
   - `backend/services/entities.py`
   - `backend/services/users.py`
   - `backend/services/groups.py` and `backend/services/group_membership.py` for membership resolution
7. Serialization in `backend/services/serializers.py` via `build_entry_groups`.
8. Query invalidation in `frontend/src/lib/queryInvalidation.ts`.

## Group Flow

1. Manual group create, rename, delete, and membership edits come from:
   - `frontend/src/pages/GroupsPage.tsx`
   - `frontend/src/components/GroupDetailModal.tsx`
   - `frontend/src/components/GroupEditorModal.tsx`
   - `frontend/src/components/GroupMemberEditorModal.tsx`
2. Rule group create and edit come from:
   - `frontend/src/pages/GroupsPage.tsx`
   - `frontend/src/features/groups/GroupRuleEditorSection.tsx`
   - `frontend/src/features/groupRules/*` (shared rule editor widgets)
3. Requests go through the unified `/groups` API:
   - `POST /groups`
   - `PATCH /groups/{group_id}`
   - `DELETE /groups/{group_id}`
   - `POST /groups/{group_id}/members`
   - `DELETE /groups/{group_id}/members/{membership_id}`
4. Group validation and effective membership resolution live in `backend/services/groups.py`, `backend/services/group_membership.py`, and `backend/services/group_rules.py`.
5. Group read models from `backend/routers/groups.py`:
   - `GET /groups` for summaries
   - `GET /groups/{group_id}` for member and rule detail
6. Entry detail and list surfaces show `groups[]` for the entry's effective memberships.
7. Entry create/edit can assign many manual groups without leaving the entry workflow; the dedicated groups workspace remains the place for broader manual-group management, and `/filters` remains the rule-group editor backed by the same API with `source=rule`.

## Agent-Proposed Entry Flow

1. Agent proposes entries via:
   - single create: `bh entries create` / `create_entry`
   - batch create: `bh entries import --payload-json ...` / `POST .../proposals/batch-entries`
   - update/delete: `update_entry` / `delete_entry`
   Handlers live in `backend/services/agent/proposals/entries.py` (+ normalization helpers), exposed through `run_bh` and thread-scoped proposal HTTP routes.
2. Proposal persisted as `agent_change_items` (`PENDING_REVIEW`).
3. Human reviews from the thread-scoped frontend review UI opened by the agent header `Review` button:
   - `frontend/src/features/agent/review/AgentThreadReviewModal.tsx`
   - `frontend/src/features/agent/review/drafts/entries.ts`
4. Apply handler:
   - `backend/services/agent/reviews/workflow.py`
   - `backend/services/agent/apply/`
5. Apply handler resolves target by selector for update/delete:
   - `date + amount_minor + from_entity + to_entity + name`
   - scoped to the approving reviewer principal the same way normal entry routes scope visibility
6. Entry mutation is applied directly to `entries` (no entry status field); newly created agent entries are owned by the approving reviewer principal, and agent-created entries remain ungrouped until a user assigns manual groups or saved rules match them.

## Tests

- `backend/tests/test_entries.py`
- `backend/tests/test_entries_service.py`
- `backend/tests/test_agent.py` (approval/apply entry path)
- `backend/tests/test_migrations_core.py`

## Operational Notes

- Currency normalization occurs server-side (`currency_code.upper()`).
- Agent create-entry proposals can omit `currency_code`; backend defaults to resolved runtime default currency (`/settings` override, else `BILL_HELPER_DEFAULT_CURRENCY_CODE`).
- Thread review aggregates proposals across all runs in the selected thread; pending items are reviewed first while applied, rejected, and failed items remain visible for audit.
- Reviewer edit-before-approve uses structured entry/tag/entity forms and serializes any approved edits back through `payload_override`.
- Soft-delete removes all `group_members` rows for the deleted entry.
- Empty manual groups are allowed so users can create a group shell before adding members.
- Rule groups require `include` / `exclude` overrides when adding or removing membership rows through the group API.
- Entries list date cells are rendered as no-wrap with a compact fixed width so `YYYY-MM-DD` values stay on one line.
- Entries list reads `GET /entries` in incremental pages, auto-fetching the next page as the user nears the bottom of the workspace and exposing a fallback `Load more` control while additional rows remain.
- Entries list name cells now render a compact secondary `from -> to` line under the primary name; long entity names are trimmed per side in `frontend/src/pages/EntriesPage.tsx` and styled by the `.entries-name-*` classes in `frontend/src/styles.css`.
