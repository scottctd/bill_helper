# Agent Harness-First Radical Refactor

## Status

- Completed (2026-06-07)
- Harness-first agent runtime, schema, API, frontend, and benchmark cutover landed

## Priority

- High
- Complete before adding more agent transports, autonomous workflows, or advanced evaluation

## Summary

Replace the current chat/frontend-shaped agent runtime with a product-first execution harness.

The new harness is the canonical backend capability for running an agent turn. It owns:

- durable run state
- canonical model transcript
- model and tool execution
- interruption and bounded execution
- atomic persistence
- typed operational events
- usage, latency, and error accounting
- terminal results

Production chat, background execution, SSE, Telegram, benchmarks, and future workflows become
callers or projections around this harness. The frontend renders backend projections and does not
define execution semantics.

The primary product contract is:

```text
AgentHarness.run(RunRequest) -> RunResult
AgentHarness.resume(run_id) -> RunResult
```

Internally, the harness advances through explicit, durable execution steps:

```text
current RunState
  -> ModelGateway.complete(ModelRequest)
  -> ModelDecision
  -> append assistant transcript message
  -> execute requested tools
  -> append tool-result transcript messages
  -> commit step and publish typed events
  -> continue or finish
```

This is not an RL-first design. There are no rewards, Gym contracts, `reset()` / `step()` APIs,
or environment terminology in the production harness.

Future RL integration should remain small because the harness exposes clean state, decision,
transition, tool, and trace boundaries. A later RL adapter may provide actions instead of using
`ModelGateway`, call the same single-step transition executor, and compute rewards outside the
production runtime.

This is a radical replacement. Do not retain compatibility facades, dual writers, legacy event
replay, old message shapes, old API fields, or migration-time reconstruction of lossy historical
agent activity.

## Why

The current implementation has a reusable loop, but its contracts and persistence remain shaped
around chat UI behavior:

- the loop adapter emits serialized stream payload dictionaries
- benchmark execution must create `AgentThread`, `AgentMessage`, and `AgentRun` ORM rows
- the model-visible transcript is held in memory during a run
- later turns reconstruct model context from chat bubbles, run events, and tool-call records
- live append and historical replay are separate writers that must produce matching message shapes
- transport-specific `surface` behavior reaches prompt assembly and execution plumbing
- frontend timeline events are also inputs for rebuilding model context

This makes model context correctness dependent on presentation/audit records. It also makes
backend automation, evaluation, and future learning integrations unnecessarily expensive.

## Product-First Design Principles

### 1. The harness is a backend product capability

The harness exists to run reliable agent turns for Bill Helper. Its API should use product and
software concepts: requests, runs, steps, decisions, tool calls, results, errors, and events.

### 2. Canonical execution state is durable

The transcript and completed steps are persisted directly. A run can be inspected, resumed, or
replayed without reconstructing model context from UI records.

### 3. The harness owns behavior; surfaces own presentation

The harness decides whether to call the model again, execute tools, stop, fail, or complete.
Frontend, SSE, HTTP, and Telegram only translate inputs and project outputs.

### 4. Deterministic and probabilistic concerns are separated

- `ModelGateway` produces probabilistic model decisions.
- The step executor deterministically validates and applies a decision.
- `ToolExecutor` deterministically resolves and executes registered tools.
- Provider formatting remains at the model boundary.

### 5. Operational reliability is first-class

The design must make interruption, bounded execution, atomic step commits, reconnect, contextual
errors, observability, and usage accounting straightforward.

### 6. Future RL integration follows from clean seams

The production architecture must not contain RL concepts. It should expose enough clean contracts
that a later adapter can:

- inspect canonical state
- inject a model decision
- advance exactly one deterministic step
- isolate or simulate tools
- export complete traces
- calculate rewards externally

## Locked Decisions

1. `AgentHarness` is the source of truth for execution semantics.
2. The canonical transcript is provider-neutral, append-only, and persisted directly.
3. Model/provider formatting exists only at the `ModelGateway` boundary.
4. A model response is normalized into one typed `ModelDecision`.
5. A focused deterministic step executor validates and applies `ModelDecision`.
6. Tool execution uses a narrow registry/executor contract independent of HTTP and frontend code.
7. Persistence, SSE, API responses, frontend timelines, benchmarks, and observability consume
   typed harness events or canonical run state. They never drive harness behavior.
8. Production sync, background, and streaming execution use the same harness.
9. The current agent persistence model is replaced with one porting Alembic migration.
10. Existing conversations, attachments, session sources, proposals, and review actions are
    transformed into the new schema before legacy tables are removed.
11. The migration must refuse to run while an agent run is active.
12. Reconstruct historical canonical transcripts from legacy messages, tool calls, and events, and
    abort before dropping tables if any conversation message or attachment cannot be ported.
13. Do not retain legacy tables, fields, enums, serializers, endpoints, replay helpers, or tests.
14. Frontend and Telegram behavior must be rewritten against the new API contract in the same
    work item.
15. Keep proposal writes review-gated. The harness may create proposals through tools, but only
    review/apply services mutate finance-domain records.

## Non-Goals

- Preserving old agent conversation history or pending proposals
- Supporting old agent API response shapes or SSE event names
- Retaining the current `AgentRunLoopAdapter` interface
- Retaining provider-specific fields in canonical transcript records
- Building a distributed execution scheduler
- Building an RL environment, training algorithm, reward model, replay buffer, or vectorized runner
- Introducing RL vocabulary or Gym-style contracts into production code
- Making arbitrary finance-domain mutations directly from the harness

## Target Mental Model

```text
Product caller
  |
  | RunRequest
  v
+------------------+       +------------------+
| AgentHarness     +------>+ ModelGateway     |
| run / resume     |       | LiteLLM adapter  |
+--------+---------+       +------------------+
         |
         | ModelDecision
         v
+--------+---------+       +------------------+
| StepExecutor     +------>+ ToolExecutor     |
| deterministic    |       | tool registry    |
+--------+---------+       +------------------+
         |
         | committed state + typed events
         v
+--------+---------+       +------------------+
| RunRepository    |       | Event subscribers|
| canonical state  |       | SSE / audit / log|
+------------------+       +------------------+
```

Future RL support is an outer adapter, not a core runtime concept:

```text
Future RL adapter
  -> builds isolated RunState
  -> supplies ModelDecision directly
  -> calls the same deterministic StepExecutor
  -> maps StepResult to observation/reward/termination externally
```

## Core Contracts

Create framework-independent contracts under `backend/services/agent/harness/`. These contracts
must not import FastAPI, SQLAlchemy ORM models, SSE serializers, frontend schemas, Telegram, or
LiteLLM.

All request/config contracts use Pydantic with `extra="forbid"`.

### `RunRequest`

Inputs needed to create one product agent run:

- `run_id`
- `thread_id` nullable for non-chat callers
- `principal`
- `initial_transcript`
- `model_config`
- `tool_catalog`
- `max_steps`
- `approval_policy`
- `origin`
- `metadata`

`origin` and `metadata` are audit/tool-context inputs. They must not alter generic loop behavior.
Transport-specific prompt instructions must already be represented in `initial_transcript`.

### `TranscriptMessage`

Provider-neutral canonical message union:

- `SystemMessage`
- `UserMessage`
- `AssistantMessage`
- `ToolResultMessage`

Requirements:

- text and multimodal content use typed content parts
- assistant reasoning is an optional canonical field
- assistant tool requests use typed `ToolRequest` values
- tool results reference a canonical tool request id
- no `reasoning_content`, LiteLLM objects, SQLAlchemy rows, or frontend display fields
- serialization round-trips exactly

### `ModelRequest`

The exact provider-neutral input to one model call:

- canonical transcript snapshot
- available tool definitions
- model configuration
- request metadata for tracing

### `ModelDecision`

Normalized result of one complete model call:

- assistant content
- optional reasoning
- zero or more typed tool requests
- usage
- provider/model metadata
- finish reason

Rules:

- provider adapters must normalize all provider response variants into this contract
- malformed tool arguments remain explicit decode errors; never silently become `{}` 
- a decision with tool requests is an intermediate decision
- a decision without tool requests is terminal assistant output

### `RunState`

Canonical state needed to continue a run:

- run identity and configuration
- ordered transcript
- completed step count
- current status
- stop request state
- accumulated usage
- terminal result or error

The state must be usable without frontend or HTTP context.

### `StepResult`

Result of applying one `ModelDecision`:

- updated `RunState`
- committed assistant message
- committed tool calls and results
- typed events
- `should_continue`
- terminal result or error when finished

This is an internal software transition contract. It contains no reward or Gym semantics.

### `RunResult`

Terminal product result:

- run id and terminal status
- final assistant content
- canonical transcript
- completed steps and tool calls
- accumulated usage and latency
- typed terminal error when failed or interrupted

### `HarnessEvent`

Typed internal event union:

- `run_started`
- `model_request_started`
- `model_delta` - ephemeral
- `model_decision_committed`
- `tool_started`
- `tool_finished`
- `step_committed`
- `run_finished`

Rules:

- events describe harness facts, not UI instructions
- subscribers may persist or serialize events
- model context is never reconstructed from events
- ephemeral deltas are not required for deterministic replay
- committed transcript/state must be stored before the matching committed event is published

### Protocols

Define narrow protocols:

- `ModelGateway.complete(request) -> ModelDecision`
- `StreamingModelGateway.complete_stream(request, event_sink) -> ModelDecision`
- `ToolExecutor.execute(request, context) -> ToolExecutionResult`
- `RunRepository.create(request) -> RunState`
- `RunRepository.load(run_id) -> RunState`
- `RunRepository.commit_step(previous_state, step_result) -> RunState`
- `RunRepository.finish(run_result) -> None`
- `EventSink.publish(event) -> None`
- `StopSignal.is_stop_requested(run_id) -> bool`

Use simple concrete defaults and dict registries. Do not create inheritance-heavy strategy or
factory layers.

## Harness Execution Semantics

### `AgentHarness.run(request)`

1. Validate the request.
2. Create and persist initial `RunState`.
3. Publish `run_started`.
4. Execute model/tool steps until completion, failure, interruption, or step limit.
5. Persist and return `RunResult`.

### `AgentHarness.resume(run_id)`

1. Load canonical `RunState`.
2. Return the existing result if already terminal.
3. Validate that the transcript and completed steps are internally consistent.
4. Continue from the next model request.
5. Never rebuild state from UI/audit events.

### One model/tool step

1. Check stop signal before opening a model request.
2. Build `ModelRequest` from canonical `RunState`.
3. Publish `model_request_started`.
4. Call `ModelGateway`; streaming gateways may publish ephemeral `model_delta` events.
5. Normalize the completed provider response into `ModelDecision`.
6. Pass the decision to the deterministic step executor.
7. The step executor:
   - validates the decision and requested tools
   - appends one canonical assistant message
   - executes requested tools sequentially
   - appends one canonical result message per tool request
   - determines whether another model call is required
   - builds typed committed events
8. Atomically commit the step state, transcript additions, tool records, and usage.
9. Publish committed events after persistence succeeds.
10. Stop on terminal assistant output, interruption, failure, or max steps.

Tool execution order is deterministic. Keep sequential execution initially. Parallel tool
execution can be added later only if result ordering and atomic commit semantics remain explicit.

### Failure and interruption semantics

- Provider failures become typed run failures with contextual metadata.
- Tool failures normally become tool result messages so the model may recover.
- Unexpected deterministic transition or persistence failures fail the run.
- User interruption stops before the next model/tool boundary when possible.
- Interrupted and max-step runs use explicit terminal statuses, not string-matched error text.
- Incomplete tool calls receive explicit terminal records.
- No broad exception is silently swallowed.

## Persistence Model

Replace the current agent operational schema. Keep finance-domain proposal/apply semantics, but
reattach them to the new runs.

### Keep and redefine

#### `agent_threads`

Product-level conversation/session grouping only:

- `id`
- `owner_user_id`
- `title`
- `summary`
- timestamps

Threads do not own execution semantics.

#### `agent_runs`

One product harness run:

- `id`
- `thread_id` nullable for non-chat/evaluation callers
- `turn_index` nullable; unique within a thread when present
- `status`: `running | completed | interrupted | max_steps | failed`
- `model_name`
- durable `principal_user_id`, optional `principal_user_name`, and `metadata_json`
- `origin`
- `approval_policy`
- `max_steps`
- `final_transcript_message_id` nullable
- usage and cost totals
- `error_code` and `error_detail` nullable
- timestamps

Remove `user_message_id`, `assistant_message_id`, raw `surface`, and fields whose only purpose was
the old chat-message model.

### New canonical tables

#### `agent_transcript_messages`

Source of truth for model-visible conversation state:

- `id`
- `run_id`
- `sequence_index`
- `role`
- `content_json`
- `reasoning_text` nullable
- `tool_request_id` nullable for tool-result messages
- `tool_name` nullable for tool-result messages
- `created_at`

Constraints:

- unique `(run_id, sequence_index)`
- role-specific field validation in service contracts
- canonical content only; no provider payloads or display labels

Each chat run stores only messages introduced by that turn:

- the current system prompt snapshot
- the current user input
- model decisions
- tool results

Context for a new turn is built from:

- the new turn's stored system prompt snapshot
- prior runs' user, assistant, and tool messages in thread/turn order
- the new user message

Prior system prompt snapshots are excluded from new-turn model context but remain available for
historical reproducibility.

#### `agent_steps`

One durable model/tool execution step:

- `id`
- `run_id`
- `step_index`
- `assistant_transcript_message_id`
- `status`: `running | committed | failed`
- model usage and latency fields
- `finish_reason` nullable
- diagnostic metadata JSON
- timestamps

Constraints:

- unique `(run_id, step_index)`
- assistant message belongs to the same run

Do not add reward fields to product persistence.

#### `agent_tool_calls`

Canonical tool request and result record:

- `id`
- `run_id`
- `step_id`
- `call_index`
- `tool_request_id`
- `tool_name`
- `arguments_json`
- `status`
- `result_content_json`
- `error_code` nullable
- timing fields

Constraints:

- unique `(step_id, call_index)`
- unique `(run_id, tool_request_id)`

Tool result transcript messages reference `tool_request_id`. Provider-facing tool-call ids are
generated/mapped only in the provider adapter when necessary.

#### `agent_run_events`

Durable ordered operational event journal for audit, reconnect, and trace export:

- `id`
- `run_id`
- `sequence_index`
- `event_type`
- `payload_json`
- `created_at`

This table is not a model-context source. It may omit ephemeral `model_delta` events.

### Attachments and sources

- Replace message attachment ownership with transcript-message attachment ownership.
- Rename/recreate the table as `agent_transcript_attachments`.
- Keep canonical `user_files` rows and payloads.
- Session sources may be recreated only if still required by the external `bh` session API.
- Attachment content assembly produces canonical user content before `AgentHarness.run()`.

### Proposals and reviews

- Keep the proposal, review, and apply domain behavior.
- Recreate `agent_change_items` and `agent_review_actions` with FKs to the new `agent_runs`.
- Tools receive run/principal context through `ToolExecutionContext`.
- Evaluation and future learning integrations may supply isolated tool executors.
- Proposal records and review state never become generic harness transition logic.

## Destructive Migration

Create one new Alembic revision after the current head.

Upgrade behavior:

1. Abort with a clear error if any current `agent_runs` row is running.
2. Export and validate all legacy conversation, attachment, source, proposal, and review rows.
3. Delete/drop all current agent operational tables in FK-safe order, including:
   - agent review actions and change items
   - agent run events
   - agent tool calls
   - agent message attachments
   - agent session sources
   - agent runs
   - agent messages
   - agent threads
4. Recreate the new harness-first agent tables and indexes.
5. Port the validated snapshot into canonical transcript, synthetic committed steps, structured tool calls, canonical event rows retaining the raw legacy payload, and related rows.
6. Leave finance tables, users, runtime settings, and `user_files` untouched.
7. Remove obsolete agent enum values and columns from ORM/API contracts.

Downgrade behavior:

- destructive only
- drop the new agent tables
- recreate the immediately previous schema empty
- do not attempt to reconstruct deleted agent history

Add migration tests that prove:

- upgrade refuses active runs
- upgrade ports existing conversations without loss or aborts before dropping legacy tables
- finance and user-file data remain intact
- new constraints and indexes exist
- upgrade-to-head works on a fresh database

## Backend Module Layout

Create a real subpackage because the harness has multiple durable siblings:

```text
backend/services/agent/harness/
|-- contracts.py          # canonical requests, state, decisions, results, events
|-- harness.py            # run/resume recipe-style coordinator
|-- step_executor.py      # deterministic decision/tool transition
|-- transcript.py         # pure transcript validation and assembly helpers
|-- tools.py              # tool executor contracts and registry helpers
|-- repository.py         # run repository protocol and in-memory implementation
|-- events.py             # event sink protocol and fan-out
`-- errors.py             # typed harness errors
```

Production adapters:

```text
backend/services/agent/
|-- production_runtime.py       # composes production harness dependencies
|-- production_repository.py    # SQLAlchemy RunRepository
|-- production_events.py        # DB journal, usage, stream publication
|-- production_tools.py         # existing tool runtime adapter
|-- thread_context.py           # builds new-turn transcript from canonical rows
|-- model_gateway.py            # LiteLLM gateway adapter
|-- model_gateway_support/      # provider formatting, streaming, retries, usage
`-- api_projection.py           # thread/run/timeline read models
```

Evaluation and future integration adapters:

```text
backend/services/agent/
|-- evaluation_runner.py        # direct harness evaluation and benchmark caller
|-- trace_export.py             # canonical run/step/decision/tool trace export
`-- decision_injection.py       # test/eval seam for supplying model decisions
```

Module names may change during implementation when a clearer ownership boundary is discovered,
but responsibilities must remain separated.

## Future RL Integration Boundary

Do not implement an RL environment in this refactor.

The refactor must leave a small, explicit future integration path:

1. Build an isolated `RunState` through the in-memory repository.
2. Convert that state into the learning system's observation format.
3. Convert a learning action into canonical `ModelDecision`.
4. Call the same deterministic `step_executor`.
5. Convert `StepResult` into next observation, reward, and terminal flags outside the harness.
6. Use an isolated or simulated `ToolExecutor`.
7. Export canonical traces for offline scoring or training.

This boundary is considered successful when a focused test can inject decisions and advance a
tool-using run one step at a time without production DB, HTTP, SSE, frontend, or LiteLLM
dependencies.

No production module should import an RL framework or mention rewards, observations, actions,
episodes, Gym, `reset()`, or RL termination semantics.

## Code To Delete

Delete or replace, rather than wrapping:

- `backend/services/agent/run_orchestrator.py`
- `backend/services/agent/runtime_loop.py`
- `backend/services/agent/runtime_support/tool_turns.py`
- `backend/services/agent/message_history_turn_context.py`
- old event-to-message replay helpers and tests
- old `AgentRunLoopAdapter` benchmark adapter
- old stream-payload-producing runtime hooks
- old `agent_messages`-based context assembly
- old serializers that expose run events as the primary timeline model
- old frontend event merge logic tied to `reasoning_update` and tool lifecycle event names
- legacy reasoning/tool-call compatibility branches and documentation
- old API/SSE types and tests

After cutover, repository search must find no references to:

- `AgentRunLoopAdapter`
- `build_turn_llm_messages`
- `message_history_turn_context`
- `reasoning_update`
- old tool lifecycle event names
- `assistant_message_id`
- `user_message_id`
- old `surface` execution plumbing

Allow references only inside the destructive migration when needed to address old table names.

## API And Transport Adaptation

### HTTP API

Rewrite the agent API around projections from canonical run state.

Thread detail should return:

- thread metadata
- ordered turns derived from runs and transcript messages
- per-run status/usage
- steps and tool calls as inspectable work records
- proposal/review projections

Do not expose raw canonical transcript internals unless an explicit debug/trace endpoint requests
them.

### SSE

Define a new public SSE union derived from `HarnessEvent`:

- `model_delta`
- `model_decision_committed`
- `tool_started`
- `tool_finished`
- `run_finished`

The SSE serializer is an adapter. Public event names may be presentation-friendly, but they must
not leak back into harness contracts.

Reconnect uses durable `agent_run_events` sequence indexes plus any active ephemeral model deltas
held by the stream hub.

### Telegram and other transports

- transport-specific prompt additions are applied while constructing `RunRequest`
- terminal response formatting occurs after `RunResult`
- origin metadata is persisted for audit only
- no raw transport string is threaded through harness or step-executor logic

## Frontend Adaptation

Rewrite the frontend against the new projection API and SSE contract.

Frontend responsibilities:

- render ordered turns
- render steps/tool calls from projection records
- apply incremental SSE updates to cached projections
- present review-gated proposals
- format transport-independent statuses for users

Frontend non-responsibilities:

- reconstructing model transcript semantics
- merging audit events into a canonical execution transcript
- deciding whether the harness should continue
- interpreting provider-specific reasoning/tool message fields

Delete old event timeline merge code once the new projection is live. Prefer backend-computed
step/tool-call projection records over frontend reconstruction from lifecycle events.

## Benchmark And Evaluation Adaptation

Replace `benchmark_interface.py` ORM-driven setup with a direct harness/evaluation caller.

The benchmark must be able to:

- create an in-memory or isolated repository
- construct `RunRequest`
- supply the production model gateway or a controlled decision source
- supply the production tool catalog or a controlled test catalog
- run the harness to completion or inject decisions one step at a time
- consume `RunResult`, canonical transcript, steps, tool calls, and typed trace events
- avoid creating product chat threads or calling frontend/API serializers

This direct evaluation seam is also the intended foundation for future RL integration.

## Implementation Phases

### Phase 1 - Seal product-native harness contracts

1. Add canonical requests, transcript messages, decisions, run state, step results, and events.
2. Add pure transcript assembly and validation.
3. Implement deterministic `step_executor` with in-memory repository and fake tools.
4. Implement decision-injection test helpers.
5. Cover final response, tool success/error, malformed decision, stop request, and max steps.

Exit gate:

- a complete tool-using run can execute through product-native harness contracts without
  SQLAlchemy, LiteLLM, FastAPI, or frontend imports

### Phase 2 - Production model and tool adapters

1. Implement LiteLLM `ModelGateway` and provider-boundary canonical message conversion.
2. Move reasoning field normalization entirely into provider formatting.
3. Adapt the existing tool registry/execution behavior to `ToolExecutor`.
4. Implement thin `AgentHarness.run()` and `resume()` coordinators.
5. Verify non-stream and stream gateways produce identical committed `ModelDecision`.

Exit gate:

- a production-like run completes through the harness with fake persistence and existing tool
  behavior

### Phase 3 - Destructive schema replacement

1. Add new ORM models and enums.
2. Add the destructive Alembic migration.
3. Implement SQLAlchemy `RunRepository` and persistence event sink.
4. Implement canonical thread-context assembly from transcript rows.
5. Remove old message/event replay persistence paths.

Exit gate:

- a multi-turn production run rebuilds context solely from canonical transcript rows

### Phase 4 - Production API, SSE, and background execution

1. Replace runtime entrypoints with production harness composition.
2. Adapt interruption and max-step behavior to explicit run statuses.
3. Rewrite stream hub publication around harness events.
4. Rewrite API schemas, projections, and routers.
5. Rewrite Telegram integration against `RunResult` and origin adapters.
6. Remove old API/runtime serializers.

Exit gate:

- app and Telegram turns use the same harness and differ only at request/result adapters

### Phase 5 - Frontend replacement

1. Replace frontend agent contracts.
2. Render backend-projected turns, steps, and tool calls.
3. Replace SSE handling.
4. Preserve attachment, interrupt, proposal review, usage, and model-selection workflows.
5. Delete old timeline reconstruction and compatibility code.

Exit gate:

- frontend contains no logic for reconstructing canonical transcript state from run events

### Phase 6 - Benchmark, trace export, and future-integration proof

1. Replace benchmark execution with direct harness calls.
2. Add canonical trace export.
3. Add decision-injection helpers for evaluation.
4. Add isolated tool-executor fixtures.
5. Prove one-step decision injection and run-to-completion execution share the exact same
   deterministic step executor.

Exit gate:

- a focused test advances a tool-using run one step at a time without product chat/API setup,
  proving future RL adaptation does not require a runtime redesign

### Phase 7 - Delete leftovers and synchronize docs

1. Delete all old runtime, replay, schema, frontend, and test code.
2. Remove old enums and obsolete settings.
3. Search for forbidden legacy symbols and accidental RL concepts in production harness code.
4. Update all affected docs and generated system prompt snapshot.
5. Run the complete verification suite.

## Required Tests

### Pure harness tests

- canonical contract round trips and unknown-field rejection
- transcript ordering and validation
- run initialization
- terminal assistant decision
- tool decision transition
- multiple sequential tools
- tool error returned to model context
- malformed or unknown tool request
- stop request
- max-step terminal status
- event ordering
- atomic step result composition
- deterministic decision-injection fixtures

### Production adapter tests

- canonical-to-provider and provider-to-canonical conversion
- Fireworks reasoning conversion at provider boundary
- streamed and non-streamed committed decision equality
- production tool context and proposal creation
- repository atomicity: committed transcript precedes committed event publication
- multi-turn context assembly from canonical transcript only
- interruption and background continuation
- usage/cost aggregation
- resume from last committed step

### API/frontend tests

- thread detail projections
- new SSE event contract and reconnect
- attachment sends
- model selection
- Telegram terminal formatting
- frontend live tool/reasoning/final response rendering
- proposal review/apply flows

### Benchmark and future-integration tests

- benchmark executes without product thread/message ORM setup
- direct decision injection advances exactly one step
- isolated tool executor
- canonical trace export
- injected-decision and production-gateway paths share transition outcomes for identical decisions
- no production harness imports from an RL framework

### Migration tests

- active-run refusal
- destructive agent reset
- finance/user-file preservation
- fresh upgrade to head
- downgrade/re-upgrade smoke

## Documentation Updates

Update in the same work item:

- `README.md` if setup or operational reset steps change
- `docs/architecture.md`
- `docs/data_model.md`
- `docs/backend_index.md`
- `docs/repository_structure.md`
- `docs/api.md` if route-family mapping changes
- `docs/api/agent.md`
- `docs/development.md`
- `backend/docs/agent_subsystem.md`
- relevant frontend and Telegram docs
- affected feature docs

Delete obsolete legacy-compat documentation rather than updating it.

If prompt templates or `bh` reference behavior changes, regenerate:

```bash
uv run python scripts/render_agent_system_prompt_snapshot.py
```

## Verification Gates

Run targeted tests throughout each phase, then run all required gates:

```bash
uv run python -m py_compile <all touched Python modules>
OPENROUTER_API_KEY=test uv run pytest backend/tests -q -m "not workspace_docker"
OPENROUTER_API_KEY=test uv run pytest backend/tests/test_agent_workspace.py -q -m workspace_docker
uv run python scripts/check_llm_design.py
uv run python scripts/check_docs_sync.py
```

Also run:

```bash
uv run pytest benchmark -q
cd frontend && npm test
cd frontend && npm run build
```

Rebuild the agent workspace image and recreate sandbox containers because backend and prompt
behavior change.

## Forbidden End State

The refactor is incomplete if any of these remain:

- model context reconstructed from UI/audit events
- separate live-append and replay message-shaping implementations
- benchmark execution requiring product chat ORM records
- harness contracts returning SSE/frontend payload dictionaries
- provider-specific message fields stored as canonical transcript fields
- frontend events controlling loop continuation or context semantics
- compatibility facades or fallback branches for the old agent architecture
- old agent operational tables retained alongside the new schema
- RL terminology or Gym-style APIs embedded in the production harness
- future decision injection requiring a separate transition implementation

## Exit Criteria

1. One product-native `AgentHarness` powers production, background, streaming, and benchmark
   execution.
2. One deterministic step executor applies both production gateway decisions and injected test or
   evaluation decisions.
3. The harness runs without database, HTTP, SSE, frontend, or LiteLLM dependencies when supplied
   in-memory adapters and injected decisions.
4. Production context is loaded only from canonical transcript rows.
5. The frontend renders projections and never reconstructs model context.
6. Provider formatting is isolated to the model gateway boundary.
7. Future RL integration can be implemented as an outer adapter without changing production
   harness contracts or transition logic.
8. The old agent architecture and compatibility code are deleted.
9. Existing finance data survives the destructive agent migration.
10. All verification gates pass.
