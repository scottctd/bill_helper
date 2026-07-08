# Backend Domain And HTTP

## Domain Models

- `backend/models_finance.py`: users, sessions, accounts, entities, tags, taxonomies, entries, and groups
- `backend/models_agent.py`: agent threads/sessions, session sources, messages, attachments, runs, tool calls, change items, and review actions
- `backend/models_settings.py`: runtime settings overrides
- `backend/contracts_groups.py`: shared group write contracts
- `backend/contracts_entries.py`: shared entry mutation commands and typed entity/user refs
- `backend/contracts_users.py`: shared user and password contracts

Important ownership rules:

- owned finance resources carry non-null `owner_user_id`
- `users` own accounts, entries, groups, entities, tags, taxonomies, agent threads, and sessions
- deleting a user cascades through owned resources
- account ids remain shared entity-root ids

## Auth Boundary

- `backend/auth/contracts.py`: bearer-auth and request-principal contracts
- `backend/auth/dependencies.py`: principal resolution from bearer session tokens
- `backend/services/passwords.py`: Argon2 password hashing and reset-required sentinel handling
- `backend/services/sessions.py`: opaque token creation, hashing, lookup, and revocation
- `backend/services/principals.py`: request-principal construction from a user row plus optional session row

Current behavior:

- `get_current_principal()` never auto-creates users
- protected routes require `Authorization: Bearer <token>`
- admin checks rely on persisted `users.is_admin`

## Schemas

- `backend/schemas_finance.py`: ledger, group, dashboard, and visible-user contracts
- `backend/schemas_agent.py`: thread, message, run, change-item, and review contracts
- `backend/schemas_agent_sessions.py`: external-agent session and source contracts
- `backend/schemas_settings.py`: runtime settings request/response contracts
- `backend/schemas_auth.py`: login, session, admin-user, and admin-session contracts

Important read models:

- `UserRead` for visible-user selectors and admin user lists
- `AccountRead` with computed `balance_minor`, `balance_as_of`, optional `latest_snapshot_at`, and non-null `owner_user_id`
- `EntryRead` with non-null `owner_user_id` (no legacy `account_id` field)
- `RuntimeSettingsRead` without identity fields
- `AuthSessionRead` / `AuthLoginResponse` for session-backed auth

## Core Services

- `backend/services/accounts.py`
- `backend/services/entries.py`: `create_entry_from_command`, `update_entry_from_command`, and HTTP adapters `entry_create_command_from_http` / `entry_update_command_from_http`; command models live in `backend/contracts_entries.py`; agent proposal payloads convert via `to_create_command` / `to_update_command` on their contract models
- `backend/services/entries_read.py`: entry list/detail queries, filter assembly, and `EntryRead` / `EntryDetailRead` builders; uses one `GroupMembershipContext` snapshot per request
- `backend/services/entities.py`
- `backend/services/currencies.py`: currency catalog reads from entry usage counts
- `backend/services/tags.py`
- `backend/services/taxonomy.py`: taxonomy definitions, two-level entry-category terms, lifecycle defaults, assignments, and guarded term deletion
- `backend/services/groups.py`
- `backend/services/account_balances.py`
- `backend/services/finance_reconciliation.py`
- `backend/services/users.py`
- `backend/services/access_scope.py`
- `backend/services/runtime_settings.py`
- `backend/services/agent/runtime_settings_view.py`: agent-aware settings read projection (`build_runtime_settings_view`)
- `backend/services/agent/runtime_settings_validation.py`: derived vision-capable model lists and LiteLLM credential checks
- `backend/services/agent/work_sessions.py`

Shared policy helpers:

- `crud_policy.py`: validation/conflict helpers and `PolicyViolation` (the only service-to-HTTP error channel for domain failures)
- `access_scope.py`: canonical owner/admin query filters and scoped loaders
- `finance_contracts.py`: service-owned account/entity/tag write commands

## Error contract

Services raise `PolicyViolation` from `backend/services/crud_policy.py` for domain validation,
conflict, not-found, and unprocessable-input failures. The global handler in `backend/main.py`
maps every `PolicyViolation` to `{"detail": "<message>"}` with the exception's HTTP status.

Constructor helpers:

- `bad_request` (400)
- `conflict` (409)
- `forbidden` (403)
- `not_found` (404)
- `unprocessable_content` (422)
- `service_unavailable` (503)

Routers do not catch domain errors or re-wrap them as `HTTPException`. Examples migrated in
Phase 3:

- import job ownership lookups (`load_job_for_owner`) raise `PolicyViolation.not_found`
- entry tag suggestions raise `PolicyViolation` instead of a parallel error type
- manual group membership races translate `IntegrityError` to `PolicyViolation.conflict` in
  `backend/services/groups.py`
- dashboard month parsing uses `parse_dashboard_month` / `normalize_dashboard_batch_months`

`HTTPException` remains only for transport-only router concerns (missing bearer session id on
logout, admin session revocation when the row is already gone, agent upload/streaming routes).
Read routes never call `db.commit()`.

Auth- and user-management services:

- `users.py`: authenticate, create/update/delete users, change/reset passwords, and visible-user reads
- `passwords.py`: password hash generation and verification
- `sessions.py`: session creation and revocation

## Routers

Mixed auth router:

- `backend/routers/auth.py`: `POST /auth/login` is public; `POST /auth/logout` and `GET /auth/me` require a bearer-authenticated principal

Protected routers:

- `backend/routers/admin.py`: admin user/session management and impersonation
- `backend/routers/users.py`: `GET /users` and `POST /users/me/change-password`
- `accounts.py`
- `entries.py`
- `groups.py`
- `dashboard.py`
- `entities.py`
- `tags.py`
- `taxonomies.py`
- `currencies.py`
- `settings.py`
- `agent_sessions.py`
- split agent routers under `backend/routers/agent_*`

Router behavior:

- routers own HTTP translation only
- read models and list queries are built in services (`list_*_for_principal`, `build_*_read`); routers do not issue `select()` or assemble DTO field-by-field
- most protected routers depend on `get_current_principal`
- finance, catalog, and agent lookups are owner-scoped through `access_scope.py`
- non-admin principals are restricted to their own owned resources
- admin principals can read and mutate all owned resources
- account and entry create/update flows default `owner_user_id` to the current principal unless an admin explicitly assigns another user on supported finance routes
- entity, tag, and taxonomy mutations are authenticated-user accessible and create records for the caller's own scope
- settings writes stay admin-only because runtime settings are app-global

## Agent HTTP Ownership

Agent routes are no longer admin-only.

Current rules:

- threads are owned by `agent_threads.owner_user_id`
- sessions are the external-agent-facing view over threads and may store a user-editable `summary`
- session source links are owner-scoped through the parent thread and canonical `user_files` owner
- runs, tool calls, change items, and attachments inherit access through the parent thread
- review apply uses the approving principal for scoped resolution and owner attribution

## Related Docs

- `docs/api/core_ledger.md`
- `docs/api/catalogs_and_settings.md`
- `docs/api/agent.md`
- `docs/data_model.md`
