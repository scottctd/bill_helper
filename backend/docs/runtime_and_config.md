# Backend Runtime And Config

## Stack

- FastAPI
- SQLAlchemy 2.x
- Pydantic v2
- Alembic
- SQLite
- LiteLLM for model-provider routing
- PyMuPDF for high-resolution PDF page rendering in agent vision attachments
- Docling/EasyOCR code retained only for archived historical bundle support

## Entry Points

- app factory + ASGI app: `backend/main.py`
- backend run command: `uv run bill-helper-api`
- health endpoint: `GET /healthz`
- admin bootstrap CLI: `uv run python scripts/bootstrap_admin.py --name <user> --password <pass>`
- Telegram polling entry point: `uv run python -m telegram.polling`
- Telegram webhook entry point: `uv run python -m telegram.webhook`

## Configuration (`backend/config.py`)

Settings use the `BILL_HELPER_` prefix.

Env files load in cascade order:

1. `.env` in the working directory
2. `~/.config/bill-helper/.env`
3. real environment variables override both

Core settings:

- `APP_NAME`
- `API_PREFIX` (default `/api/v1`)
- `DATA_DIR` (default `~/.local/share/bill_helper`)
- `DATABASE_URL` (derived from `DATA_DIR` unless explicitly set)
- `CORS_ORIGINS` (default `http://localhost:5173`)
- `CURRENT_USER_TIMEZONE` / `BILL_HELPER_CURRENT_USER_TIMEZONE`
- `DEFAULT_CURRENCY_CODE`
- `DASHBOARD_CURRENCY_CODE`

Agent settings:

- `AGENT_MODEL`
- `AGENT_MAX_STEPS`
- `AGENT_BULK_MAX_CONCURRENT_THREADS`
- retry policy fields
- image and attachment limit fields
- `AGENT_MAX_PDF_PAGES`
- `AGENT_CLI_BASE_URL` / `BILL_HELPER_AGENT_CLI_BASE_URL`
- `AGENT_BASE_URL` / `BILL_HELPER_AGENT_BASE_URL`
- `AGENT_API_KEY` / `BILL_HELPER_AGENT_API_KEY`

Optional Langfuse LLM observability (read by LiteLLM’s `langfuse_otel` callback; not under `BILL_HELPER_`):

- `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` (enables tracing when both are set)
- `LANGFUSE_OTEL_HOST` (optional; **LiteLLM defaults to US** `https://us.cloud.langfuse.com`. EU projects must set `https://cloud.langfuse.com` or exports never land in the project you are viewing.)
- `LANGFUSE_HOST` (optional fallback LiteLLM reads if `LANGFUSE_OTEL_HOST` is unset)

**If the UI stays empty:** (1) Confirm region — EU vs US above. (2) In [Langfuse v4](https://langfuse.com/changelog/2026-03-10-simplify-for-scale), the primary table is **Observations**, not only the legacy traces view; filter by `trace_id` or your run id. (3) Restart the API after changing `.env`. (4) Trigger at least one **successful agent LLM call** (traces are sent after completions). (5) On startup, check logs: if you see `Langfuse OTEL callback did not initialize`, LiteLLM failed to construct the exporter (often missing `opentelemetry-exporter-otlp-proto-http` or bad keys). (6) The backend **force-flushes** the Langfuse-bound TracerProvider after each completion so batches are not stuck behind the default multi-second delay. (7) For export errors, run with `LITELLM_LOG=DEBUG` and watch for OTLP HTTP failures. (8) **Langfuse Cloud “Fast (Preview)”** can delay how soon new observations appear; toggling Fast Preview or refreshing the page often forces the list to catch up—this is a Langfuse UI/product behavior, not the app failing to export.

Runtime override behavior:

- `runtime_settings` stores optional per-field overrides managed by `GET/PATCH /api/v1/settings`, including ordered `user_memory` and `available_agent_models`
- effective runtime settings resolve as `override -> env default` where applicable in `backend/services/runtime_settings.py`
- agent-aware read projection (`vision_capable_agent_models`, `agent_api_key_configured`) lives in `backend/services/agent/runtime_settings_view.py` and `runtime_settings_validation.py`
- `user_memory` is DB-backed only, normalized as an ordered `list[str]`, and injected into every agent system prompt as a markdown unordered list when set
- `available_agent_models` is DB-backed only, normalized as an ordered `list[str]`, and always resolved to include the effective `agent_model`
- `agent_model_reasoning_efforts` is a DB-backed model-id map; configured values are passed to LiteLLM as `reasoning_effort`, while omitted models keep the provider default
- `vision_capable_agent_models` is derived from the effective `available_agent_models` list using the same vision-capability helper the agent runtime uses for attachment handling
- `agent_max_pdf_pages` defaults to `10`, is persisted as an override, and rejects oversized PDFs before page rendering
- `entry_tagging_model` is DB-backed only, may be blank, and must stay inside the effective `available_agent_models` list; blank disables inline entry tag suggestion
- identity is request-principal-based at API boundaries and is not persisted in runtime settings
- protected HTTP routes require `Authorization: Bearer <token>` backed by the `sessions` table; the web app uses the same bearer-session flow
- `agent_base_url` overrides allow only `http` and `https` and block localhost domains and non-public IP literals
Behavior notes:

- protected routes expect bearer tokens backed by the `sessions` table
- the web app uses the same bearer-session flow
- app startup succeeds even when provider credentials are missing
- only agent execution is blocked (`503`) when LiteLLM cannot resolve credentials for the configured model
- env-file variables are mirrored into `os.environ` so provider SDKs and LiteLLM can see shared secrets
- `get_settings()` caches environment settings with `lru_cache`

## Agent Files And CLI

Relevant modules:

- `backend/services/user_files.py`
- `backend/services/agent/work_sessions.py`
- `backend/services/agent/terminal.py`

Current behavior:

- user creation and admin bootstrap eagerly create `{data_dir}/user_files/{user_id}/uploads`
- internal agent `run_bh` execution accepts only `bh ...` commands, runs the local CLI module in a subprocess, injects a short-lived bearer token plus `BH_SESSION_ID`/`BH_THREAD_ID`/`BH_RUN_ID`, and scrubs the token from output
- external agents use `bh login` for saved CLI auth and `bh sessions list|create --use|use|update` to select named sessions, update summaries, attach source text/files, and create review proposals without requiring a hosted run id
- `bh entry-categories list|get|create|update|remove` directly manages the authenticated user's two-level entry-category taxonomy; references accept names, paths, full ids, or unique id prefixes, and lifecycle defaults use `fixed`, `day_to_day`, or `one_time`
- canonical user source uploads are stored once per owner by content hash; attaching the same source to the same session returns the existing link

## Session Auth Runtime

Relevant modules:

- `backend/auth/dependencies.py`
- `backend/services/passwords.py`
- `backend/services/sessions.py`
- `backend/services/principals.py`
- `backend/routers/auth.py`
- `backend/routers/admin.py`

Current behavior:

- password hashes are stored on `users.password_hash`
- bearer tokens are generated as opaque random strings
- only `SHA-256(token)` is persisted in `sessions.token_hash`
- logout or admin session deletion revokes access by deleting the row
- session expiry is nullable in the current prototype
- impersonation sessions set `is_admin_impersonation=true`

## Runtime Settings

`runtime_settings` stores optional app-wide overrides managed by `GET/PATCH /api/v1/settings`.

Supported persisted overrides include:

- `user_memory`
- `default_currency_code`
- `dashboard_currency_code`
- `agent_model`
- `entry_tagging_model`
- `available_agent_models`
- `agent_model_display_names`
- `agent_model_reasoning_efforts`
- `vision_capable_agent_models` (derived read-only response field, not persisted)
- run-limit and retry fields
- attachment limits
  - `agent_max_pdf_pages`
- `agent_base_url`
- `agent_api_key`

Important constraints:

- identity is not stored in runtime settings
- `available_agent_models` is normalized to always include the effective `agent_model`
- per-model reasoning efforts are limited to `none`, `low`, `medium`, `high`, `xhigh`, and `max`, and entries for removed models are pruned
- `vision_capable_agent_models` is derived from the effective `available_agent_models` list using the same vision-capability helper the agent runtime uses for attachment handling
- `entry_tagging_model` must be blank or included in the effective `available_agent_models`
- `agent_base_url` only allows public `http` / `https` endpoints
- `agent_api_key` is never returned from the API

## Telegram Transport Config (`telegram/config.py`)

Telegram settings use `TELEGRAM_*` env names with `BILL_HELPER_TELEGRAM_*` aliases accepted.

Key settings:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_BACKEND_BASE_URL`
- `TELEGRAM_BACKEND_AUTH_TOKEN`
- `TELEGRAM_BACKEND_AUTH_HEADERS`
- `TELEGRAM_DATA_DIR`
- `TELEGRAM_STATE_PATH`

Auth guidance:

- use `TELEGRAM_BACKEND_AUTH_TOKEN` for normal backend authentication
- use `TELEGRAM_BACKEND_AUTH_HEADERS` only when you need extra custom headers, such as proxy headers
- if `Authorization` is already present in `TELEGRAM_BACKEND_AUTH_HEADERS`, Telegram preserves it instead of synthesizing one from `TELEGRAM_BACKEND_AUTH_TOKEN`

## Database Layer (`backend/database.py`)

- `backend/db_meta.py` holds side-effect-free SQLAlchemy metadata
- `backend/database.py` exposes:
  - `build_engine_for_url(database_url)`
  - `build_engine(settings)`
  - `build_session_maker(engine)`
  - cached runtime accessors `get_engine()` and `get_session_maker()`
  - request dependency `get_db()` and helper `open_session()`, both of which now resolve the current cached sessionmaker instead of a stale import-time alias
- SQLite engines use `check_same_thread=False`
- scripts, tests, and migrations should construct dedicated engines/sessions instead of relying on runtime globals when isolation matters
