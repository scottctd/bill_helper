# Agent CLI Sessions

This feature doc describes the current agent execution model built around `bh` and external-agent-friendly sessions.

## Why This Exists

The older model-visible tool catalog kept growing across reads, proposals, and review actions. The current design keeps model tools small and moves Bill Helper operations behind `bh`, so hosted and external agents share one narrow operational contract.

## Current Model-Visible Tool Surface

The runtime catalog exposed to the hosted model contains only:

- `run_bh`
- `send_intermediate_update`
- `rename_thread`
- `add_user_memory`

`run_bh` is not a general shell. It accepts only commands that start with `bh` and rejects all other commands.

The old read/proposal/review handler modules still exist in backend code, but they are internal building blocks behind backend APIs and `bh`.

## `run_bh` Contract

`run_bh` executes the local `bh` CLI module in a subprocess.

Behavior:

- command parsing uses shell-style tokenization, but only `bh ...` is allowed
- stdout and stderr are returned separately
- duration and exit code are reported
- injected auth secrets are scrubbed from tool output
- legacy `cwd` arguments are ignored because there is no hosted workspace filesystem

Injected env per invocation:

- `BH_API_BASE_URL`
- `BH_AUTH_TOKEN`
- `BH_SESSION_ID`
- `BH_THREAD_ID`
- `BH_RUN_ID`

The auth token is a short-lived backend session created for the thread owner and revoked after the command finishes.

## What `bh` Does

`bh` is a thin HTTP client.

It does not mutate the DB directly. All authoritative state changes still go through backend routes and review/apply workflows.

Current command groups:

- `login`
- `instruction`
- `status`
- `sessions list|create|use|get|update`
- `sessions sources list|add-text|add-file`
- `entries list|get|create|update|remove`
- `accounts list|create|update|remove`
- `snapshots list|reconciliation|create|remove`
- `groups list|get|create|update|remove|add-member|remove-member`
- `entities list|create|update|remove`
- `tags list|create|update|remove`
- `proposals list|get|update|remove`

`bh login` creates a password-backed bearer session and saves the CLI API base URL plus token in the per-user CLI config. Environment variables still override saved config, so hosted internal runs can keep injecting short-lived credentials.

`bh instruction` prints the domain rules and CLI reference so external agents can load Bill Helper operating policy without depending on the hosted system prompt.

## Installing `bh`

For a repository checkout, no global install is required:

```bash
uv sync
uv run bh --help
```

For an external agent that should be able to run `bh` from any cwd, install the checkout as a uv tool:

```bash
uv tool install --editable .
bh --help
```

If the `bh` executable is not on `PATH`, add uv's tool bin directory to the shell environment:

```bash
export PATH="$(uv tool dir --bin):$PATH"
```

After install, configure the target Bill Helper backend and select a working session:

```bash
printf '%s\n' '<password>' | bh login --api-base-url http://localhost:8000/api/v1 --username admin --password-stdin
bh instruction
bh sessions list
bh sessions create --title "May receipts" --use
```

## Sessions And Sources

External agents own their cwd and local files. Bill Helper stores only what the agent explicitly attaches:

- named session rows, backed by `agent_threads`
- editable session summaries
- session-level source links to canonical `user_files` rows
- proposals and human review history
- a persisted system marker message when the session is created, exposed to the frontend as `initiated_by_external_agent` and included in hosted-agent LLM history when the user continues the thread in Bill Helper

Creating a session via `bh sessions create` or `POST /api/v1/agent/sessions` seeds that marker immediately, even before the first proposal. The frontend timeline shows a short hint banner instead of rendering the marker as chat.

`bh sessions sources add-file` uploads text, image, or PDF sources. The backend deduplicates canonical files per owner by content hash. Uploading the same file again returns the same stored source id, and attaching the same stored source to the same session is idempotent.

The external agent remains responsible for deciding how to parse, OCR, summarize, or inspect source files before proposing ledger changes.

## Proposal And Review Flow

Proposal lifecycle is thread/session-scoped in the CLI:

1. the agent runs `bh login` once for the target backend
2. the agent lists sessions with `bh sessions list` or creates one with `bh sessions create --use`
3. the agent optionally attaches sources and updates the session summary
4. the agent runs a resource-scoped `bh ... create|update|remove|add-member|remove-member ...` command
5. backend stores a pending `AgentChangeItem`
6. pending proposals can be inspected, updated, or removed with `bh proposals ...`
7. the review UI approves, rejects, or reopens the remaining proposals
8. approval applies the change through existing backend apply handlers

Hosted runs pass `BH_RUN_ID`, so proposals attach to the invoking run. External agents can omit a run id; the backend creates or reuses a completed synthetic CLI run for the session.

## API Surface Behind The CLI

Session routes:

- `GET /api/v1/agent/sessions`
- `POST /api/v1/agent/sessions`
- `GET /api/v1/agent/sessions/{session_id}`
- `PATCH /api/v1/agent/sessions/{session_id}`
- `GET /api/v1/agent/sessions/{session_id}/sources`
- `POST /api/v1/agent/sessions/{session_id}/sources/text`
- `POST /api/v1/agent/sessions/{session_id}/sources`

Proposal routes:

- `GET /api/v1/agent/threads/{thread_id}/proposals`
- `GET /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`
- `POST /api/v1/agent/threads/{thread_id}/proposals`
- `PATCH /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`
- `DELETE /api/v1/agent/threads/{thread_id}/proposals/{proposal_id}`

Review routes remain frontend-driven human review endpoints:

- `POST /api/v1/agent/change-items/{item_id}/approve`
- `POST /api/v1/agent/change-items/{item_id}/reject`
- `POST /api/v1/agent/change-items/{item_id}/reopen`

## Legacy Workspace

The Docker workspace/IDE implementation is retained as a legacy opt-in surface behind `BILL_HELPER_AGENT_WORKSPACE_ENABLED=1`, but the default hosted agent path no longer provisions Docker resources and no longer executes inside a workspace container.

## Verification Expectations

When this surface changes, useful checks include:

- `bh login`
- `bh instruction`
- `bh sessions create|list|use|get|update`
- `bh sessions sources add-text|add-file|list`
- proposal create/list/get through `bh`
- browser review/apply flow on a disposable backend

## Related Files

- [backend/cli/support.py](../../backend/cli/support.py)
- [backend/cli/main.py](../../backend/cli/main.py)
- [backend/cli/session_commands.py](../../backend/cli/session_commands.py)
- [backend/services/agent/terminal.py](../../backend/services/agent/terminal.py)
- [backend/services/agent/work_sessions.py](../../backend/services/agent/work_sessions.py)
- [backend/services/agent/tool_runtime_support/catalog.py](../../backend/services/agent/tool_runtime_support/catalog.py)
- [backend/services/agent/tool_runtime_support/catalog_terminal.py](../../backend/services/agent/tool_runtime_support/catalog_terminal.py)
- [backend/routers/agent_sessions.py](../../backend/routers/agent_sessions.py)
- [backend/routers/agent_proposals.py](../../backend/routers/agent_proposals.py)
- [backend/services/agent/proposal_http.py](../../backend/services/agent/proposal_http.py)
