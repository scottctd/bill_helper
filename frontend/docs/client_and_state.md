# Frontend Client And State

## Shared Client Layer

### Generated API contracts

Backend HTTP contracts are generated, not hand-copied:

1. `uv run python scripts/dump_openapi.py` writes `frontend/openapi.json` from the live FastAPI app.
2. `cd frontend && npm run gen:api` writes `frontend/src/lib/api-types.gen.ts` via `openapi-typescript`.

`scripts/check_api_types_sync.py` fails CI when either artifact is stale. Regenerate both files after backend schema or route annotation changes.

### `frontend/src/lib/types/`

Domain-specific TypeScript modules under `frontend/src/lib/types/` alias generated OpenAPI
schemas (via `types/schemas.ts` and `api-types.gen.ts`) and re-export through the
compatibility barrel `frontend/src/lib/types.ts`. Hand-written types remain only for
frontend-local view models (SSE wire unions, stream session state, form/editor state).

Current contract highlights:

- `Account.owner_user_id` and `Entry.owner_user_id` are non-null
- `RuntimeSettings.vision_capable_agent_models` is required (generated from backend)
- auth payloads include impersonation metadata
- `AgentStreamEvent` stays hand-written because SSE payloads are not OpenAPI response models

### `frontend/src/lib/api/`

Per-domain API modules plus the shared request layer in `frontend/src/lib/api/core.ts`.
The compatibility barrel `frontend/src/lib/api.ts` re-exports all domain modules.

`core.ts` responsibilities:

- generic `request<T>` / `requestBlob` helpers
- JSON and FormData request handling
- `buildApiHeaders` and `getAuthTokenOrThrow` for auth header injection
- `ApiError` with `.status`; clears the stored token on `401`
- `getApiErrorMessage(error)` for user-facing error text (status-aware prefixes for
  403/404/409/5xx; 422 detail pass-through)
- SSE and XHR upload paths in `lib/api/agent.ts` reuse these helpers

Domain modules expose typed endpoint functions (auth, admin, entries, groups, accounts,
catalogs, settings, agent, import, dashboard).

### `frontend/src/lib/queryKeys.ts`

Responsibilities:

- centralized TanStack Query key factory
- stable domains for admin, settings, ledger, properties, dashboard, agent, and import data

Current admin keys:

- `admin.users`
- `admin.sessions`

### `frontend/src/lib/queryInvalidation.ts`

Responsibilities:

- the only place that calls `queryClient.invalidateQueries`
- domain helpers such as `invalidateEntryReadModels`, `invalidateGroupReadModels`,
  `invalidateAdminReadModels`, `invalidateImportReadModels`, and `invalidateAgentThreadData`

`invalidateAdminReadModels(queryClient, scope?)` refreshes admin list queries; pass
`"sessions"` or `"usersAndSessions"` when session rows change. Pair with
`invalidateUserReadModels` when admin user mutations affect ledger owner lists.

`invalidateImportReadModels(queryClient, options?)` refreshes import job lists; pass
`jobId`, `threadIds`, and `invalidateEntries: true` when import job mutations also affect
agent threads or ledger entries.

## State Strategy

- TanStack Query owns remote server state
- feature hooks under `frontend/src/features/*` own screen-level derived state and mutations
- auth session state lives outside Query in the auth provider because it must survive redirects and global `401` handling
- error display uses `getApiErrorMessage`; do not cast unknown errors to `Error` for UI text
- mutations call the matching `queryInvalidation.ts` helper in `onSuccess`/`onSettled`; do not call `queryClient.invalidateQueries` elsewhere

## Auth State

- `frontend/src/features/auth/storage.ts`
  - `localStorage` helpers around `bill-helper.session-token`
- `frontend/src/features/auth/AuthProvider.tsx`
  - app-wide auth context for loading `/auth/me`, logging in, logging out, and adopting impersonation sessions
- `frontend/src/features/auth/AuthSessionCard.tsx`
  - sidebar logout item that includes the signed-in username in expanded mode
- `frontend/src/components/Sidebar.tsx`
  - renders the dedicated admin footer button separately from the logout item

Current behavior:

- app startup validates any stored token with `GET /auth/me`
- invalid or expired tokens are cleared automatically
- successful admin impersonation swaps the stored token and refreshes the whole app scope via `queryClient.clear()`
