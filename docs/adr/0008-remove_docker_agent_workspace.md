# ADR 0008: Remove Docker Agent Workspace

- Status: accepted
- Date: 2026-06-22
- Deciders: Bill Helper maintainers

## Context

ADR 0007 introduced canonical per-user `user_files` storage plus an opt-in Docker workspace with `code-server`, lifecycle APIs, and IDE proxy routes. The hosted agent path had already moved to harness-first `run_bh` execution on the host, and the Docker workspace added operational complexity (image rebuilds, host Docker socket access, sandbox lifecycle) without serving the default product path.

## Decision

- Remove Docker workspace provisioning, lifecycle helpers, IDE proxy routes, and related backend/frontend surfaces.
- Remove workspace-specific env vars, verification gates, and API docs for `/api/v1/workspace/*`.
- Keep canonical per-user upload storage under `{data_dir}/user_files/{user_id}/uploads` and migration `0035_add_user_files_and_agent_workspace` unchanged.
- Keep frontend layout "workspace" components (`WorkspaceSection`, entries workspace, etc.) as a separate UI namespace unrelated to Docker sandboxes.

## Consequences

- External agents continue to work from their own machines via `bh`; hosted agents continue through `run_bh`.
- Docs and ADR 0007 are superseded for Docker workspace behavior but remain historical context for the `user_files` decision.
- Any future in-browser IDE or sandbox work starts fresh rather than reviving the removed implementation.
