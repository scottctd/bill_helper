# Agent Legacy Run Compatibility

This doc records compatibility behavior for agent runs created before `send_intermediate_update` was removed from the model-visible tool catalog.

Current runs no longer expose or execute that tool. Old persisted rows may still reference it indirectly through run events.

## Removed Tool

`send_intermediate_update` was a session-scoped progress-note tool. The model called it before other tools to emit short user-visible status text.

Removal scope:

- deleted handler: `backend/services/agent/session_tools/progress.py`
- removed from `EXPOSED_RUNTIME_TOOL_NAMES` and the runtime tool registry
- removed special runtime branches that skipped `agent_tool_calls` persistence and emitted a standalone `reasoning_update` event instead of a normal tool row

The hosted system prompt and tool catalog no longer mention this tool.

## What Old Runs Still Persist

Runs that invoked `send_intermediate_update` before removal typically have:

- one or more `agent_run_events` rows with:
  - `event_type = reasoning_update`
  - `source = tool_call`
  - `message` = the progress note text (up to 400 chars when originally written)
- **no** matching `agent_tool_calls` row for that progress note

New runs may still emit `reasoning_update` events, but only from:

- `source = model_reasoning` — provider/model reasoning streamed during a step
- `source = assistant_content` — non-empty assistant text on the same step as tool calls (converted at persistence time)

Nothing new writes `source = tool_call`.

## Backend: Follow-Up Turn Context

File: `backend/services/agent/message_history_turn_context.py`

When rebuilding append-only LLM history from persisted run activity, `reasoning_update` handling is source-aware:

| Source | Restored into LLM messages as |
| --- | --- |
| `model_reasoning` | `assistant` message `reasoning` field |
| `assistant_content` | `assistant` message `content` |
| `tool_call` (legacy) | `assistant` message `content` (merged via `_append_assistant_content`) |

Legacy `tool_call` notes are **not** replayed as synthetic `send_intermediate_update` tool calls. That fake tool-call synthesis was removed with the tool itself.

Implication: follow-up turns after an old run still see the progress text in model context, but as plain assistant content rather than as a tool invocation/result pair.

## Frontend: Timeline Display

Files:

- `frontend/src/features/agent/activity.ts`
- `frontend/src/features/agent/reasoning_segment.ts`

Timeline behavior for `reasoning_update` events:

- `model_reasoning` — collapsible "Thought for …" segment after the step finishes
- `assistant_content` — flat interleaved markdown (not collapsed)
- `tool_call` (legacy) — flat interleaved markdown (not collapsed), same as `assistant_content`
- missing `source` — defaults to `tool_call` in `activity.ts` for older payloads that omitted the field

This keeps old progress notes visible in the run timeline without treating them as model reasoning.

## Schema Enum Retained

`AgentRunEventSource.TOOL_CALL` remains in `backend/enums_agent.py` so historical rows deserialize and replay correctly. Do not reuse this source for new writes.

## Cleanup Guidance

Do not reintroduce:

- the `send_intermediate_update` tool or prompt instructions requiring it
- runtime special-casing that skips `agent_tool_calls` for progress notes
- turn-context synthesis that fabricates intermediate tool call/result pairs from legacy events

Safe to delete this compatibility layer only after:

- production/historical data no longer needs `source = tool_call` reasoning rows for correct follow-up context or timeline replay, **or**
- a one-time migration rewrites those events to `source = assistant_content` (or drops them explicitly)

Until then, keep the source-aware branches in `message_history_turn_context.py` and the flat-markdown timeline path for `tool_call` sources.
