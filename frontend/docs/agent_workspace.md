# Frontend Agent Workspace

## Main Coordinator

- `frontend/src/features/agent/AgentPanel.tsx`
- used as the primary AI page via `frontend/src/pages/HomePage.tsx`
- the home route now adds the shared `PageHeader` plus the shared outer workspace card shell above the agent panel so the AI workspace sits inside the same route-level shell contract as the ledger pages
- acts as a render shell that wires the header, timeline, composer, thread rail, review modal, and delete confirmation together
- stateful coordination now lives in `frontend/src/features/agent/panel/useAgentPanelController.ts`, which composes `useAgentPanelQueries.ts` for thread/runtime queries, `useAgentThreadActions.ts` for thread/review mutations plus cache helpers, and `useAgentComposerRuntime.ts` for composer/panel coordination; stream hydration/state lives in `useAgentComposerStreamState.ts`, send-stop orchestration lives in `useAgentComposerActions.ts`, and pure panel helpers live in `frontend/src/features/agent/panel/helpers.ts`
- the header **New Thread** control clears selection into a client-only draft (no `POST /agent/threads`); the first outbound send calls `ensureThreadId()` in `useAgentComposerActions.ts`, which creates the server thread and selects it; `useAgentPanelQueries.ts` skips auto-selecting the newest/first listed thread while that draft is active so the rail does not snap back
- page header uses the static title `Bill Assistant`; model selection stays in the composer dropdown instead of the title row
- visual styling now follows the same compact neutral workspace system as the rest of the app: the agent panel is no longer a full-screen bespoke surface with separate page chrome
- the route-level border now comes from the same shared workspace shell used by the ledger pages; the agent panel renders borderless inside that shell
- the main conversation column stays width-capped for readability and centered within the shared workspace panel

Supporting modules include:

- `frontend/src/features/agent/panel/useAgentPanelController.ts`
- `frontend/src/features/agent/panel/useAgentPanelQueries.ts`
- `frontend/src/features/agent/panel/useAgentThreadActions.ts`
- `frontend/src/features/agent/panel/useAgentComposerRuntime.ts`
- `frontend/src/features/agent/panel/useAgentComposerStreamState.ts`
- `frontend/src/features/agent/panel/useAgentComposerActions.ts`
- `frontend/src/features/agent/panel/helpers.ts`
- `frontend/src/features/agent/AgentRunBlock.tsx`
- `frontend/src/features/agent/AgentRunActivity.tsx`
- `frontend/src/features/agent/AssistantMessageRunWork.tsx`
- `frontend/src/features/agent/activity.ts`
- `frontend/src/features/agent/panel/AgentThreadList.tsx`
- `frontend/src/features/agent/panel/AgentThreadPanel.tsx`
- `frontend/src/features/agent/panel/AgentTimeline.tsx`
- `frontend/src/features/agent/panel/AgentComposer.tsx`
- `frontend/src/features/agent/panel/AgentThreadUsageBar.tsx`
- `frontend/src/features/agent/panel/useAgentDraftAttachments.ts`
- `frontend/src/features/agent/panel/AgentMessageAttachmentImage.tsx`
- `frontend/src/features/agent/panel/useStickToBottom.ts`
- `frontend/src/hooks/useResizablePanel.ts`
- `frontend/src/features/agent/review/AgentThreadReviewModal.tsx`
- `frontend/src/features/review/ReviewPanel.tsx` (shared review shell consumed by the agent modal and the import job review)
- `frontend/src/features/agent/review/ReviewModalHeader.tsx`
- `frontend/src/features/agent/review/ReviewModalControls.tsx`
- `frontend/src/features/agent/review/useAgentThreadReviewController.ts`
- `frontend/src/features/agent/review/modalHelpers.ts`
- `frontend/src/features/agent/review/model.ts`
- `frontend/src/features/agent/review/diff/*`
- `frontend/src/features/review/ReviewItemCard.tsx`
- `frontend/src/features/review/ReviewFieldList.tsx`
- `frontend/src/features/review/proposalFields.ts`

## Timeline Behavior

- thread rail is on the right, collapsible, resizable, and independently scrollable
- thread rail now reads as a secondary navigation panel inside the shared workspace instead of a floating side app
- thread rows expose hover/focus delete controls, route deletion through the shared in-app confirmation dialog instead of a browser-native alert, support double-click inline rename with a visible active single-line field that preserves native selection and horizontal scrolling for long titles, render the full normalized title text before CSS truncation, and reuse one trailing action slot so hover/focus swaps delete in over the running spinner instead of reserving separate dead space
- running state is thread-scoped rather than panel-global, so a background stream keeps its spinner in the rail without forcing other selected idle threads into a stop-oriented composer state
- delete stays unavailable only for the specific running or deleting thread; idle sibling threads keep their delete affordance even while another thread is active
- inline rename remains available per thread unless that same thread already has a rename mutation in flight
- assistant turns and user bubbles share the same centered readable column; assistant content drops the outer bubble shell, while user bubbles stay right-aligned within that column and only go edge-to-edge when the panel is narrow
- user and assistant message footers sit below the bubble/reply and expose a hover/focus copy button plus timestamp; fenced markdown code blocks inside assistant replies also expose their own copy button in the block corner
- threads started by an external agent via `bh` expose `thread.initiated_by_external_agent`; the timeline shows a compact hint banner and hides the persisted system marker from the message list
- timeline is event-driven from persisted `run.events`
- tool rows appear as queued, then update in place through running, completed, failed, or cancelled
- backend tool-call payloads now include a high-signal `display_label`; the timeline uses that summary for both compact SSE snapshots and hydrated rows instead of rendering raw tool names
- streamed `rename_thread` calls hydrate immediately so the thread rail relabels before the assistant finishes the turn
- reasoning updates and interleaved assistant text render as plain markdown at `text-xs` / `font-medium` / foreground in the same **Public Sans** UI stack as the rest of the app (smaller than the final `text-sm` reply); tool-call rows use matching `font-medium` / muted summary labels, no chevron—click the row to expand details; live SSE `reasoning_delta` feeds that list, while `text_delta` streams the main assistant answer as normal markdown below the activity list in the same turn
- `model_reasoning` segments collapse per step once streaming finishes: the summary reads `Thought for {seconds}s · {tokens} tokens` (seconds come from persisted `reasoning_duration_ms` on the `reasoning_update` event; token counts are estimated client-side from the stored reasoning text); click the row to expand the full reasoning markdown; `assistant_content` reasoning notes stay as flat interleaved markdown and do not collapse; legacy `tool_call`-sourced progress notes from removed `send_intermediate_update` runs behave the same way (see `../../backend/docs/agent_legacy_compat.md`)
- live `reasoning_delta` / `text_delta` buffers stay in a same-tab session store while the SSE connection remains open, so thread switches and panel close/reopen within one browser session can resume incremental streaming without waiting for the next persisted `run_event`
- after a full page refresh or when opening the app in another tab, `useAgentStreamReconnect.ts` detects server-side `running` runs and opens `GET /api/v1/agent/runs/{run_id}/stream?after_sequence=N` so token deltas and tool lifecycle events resume through the same stream handlers (single backend process only; server restart while a run is still `running` remains a pre-existing stuck-run edge case)
- while model reasoning is still streaming, the live `Thinking` row summary updates every ~750ms with elapsed seconds and an estimated token count (`Thinking for {seconds}s · {tokens} tokens`) from the in-flight buffer and `reasoningSegmentStartedAtByRunId`; the expanded body shows only the trailing 9 lines (`text-xs` / `leading-5`) with overflow hidden and a top fade so long hidden reasoning does not scroll inside the expanded row; completed/persisted reasoning segments still expand to the full markdown
- completed turns collapse that activity behind a centered separator (work duration plus tool/update counts); clicking the separator expands the full timeline above it; the persisted assistant message body remains the primary visible reply when collapsed
- failed model or internal errors surface once in the persisted assistant reply; technical error text and tracebacks render inside a markdown fenced code block with soft-wrapped lines, while the composer bar no longer repeats the same run-failure message and run activity rows no longer add a separate red error line above the reply; interrupted runs without an assistant message still show their failure text once as markdown in the timeline activity column
- compact tool-call snapshots are hydrated on demand from `GET /agent/tool-calls/{tool_call_id}`
- manually expanding or collapsing activity/tool-call details detaches the timeline from auto-follow so the clicked location stays stable until the reviewer scrolls back to bottom
- optimistic user and assistant placeholders reconcile against persisted timeline messages; when the assistant placeholder is replaced by a persisted row while the run is still active, `text_delta` / `reasoning_delta` buffers stay live so the same turn keeps streaming on that message (buffers clear when the stream finishes or the run stops); per-run SSE buffers are keyed by run id and survive thread switches, and pending run cards resolve buffered reasoning through the same helper as persisted assistant turns
- persisted image attachments render through authenticated blob fetches so previews survive thread reloads even though the API uses bearer-token auth instead of cookie-backed file URLs
- user-message attachments render as compact file rows above the message text and open in a browser-native tab instead of embedding inline previews inside the bubble
- composer pending attachments, user attachment rows, and assistant inline attachment grids each cap height with internal vertical scroll when the list is long (`scroll-surface` plus classes in `frontend/src/styles/agent.css`) so the composer and bubbles do not grow unbounded and the scrollbar matches the app’s styled scrollbars; those strips share a bordered, muted background “tray” with tighter gaps and padding than the main bubble chrome
- assistant-message inline attachment cards stay bounded: images preserve their aspect ratio up to a larger capped size and open in a browser-native tab when clicked, while PDFs use a small scrollable browser preview plus filename label and an explicit `Open` action
- `useAgentComposerStreamState.ts` owns stream-event accumulation, tool-call hydration, rename-thread reconciliation, and the optimistic run timeline cache

## Thread Review Surface

- review actions are coordinated by `frontend/src/features/agent/review/useAgentThreadReviewController.ts`; `AgentThreadReviewModal.tsx` composes the shared `frontend/src/features/review/ReviewPanel.tsx` slot shell (header/controls/sidebar/card) and passes its agent-specific chrome, while `review.css` owns the shared `agent-review-*` styling
- `useAgentThreadReviewController.ts` owns item navigation plus approve/reject/reopen/batch actions only; review is read-only and does not send `payload_override`
- review modal presentation is split across `ReviewModalHeader.tsx` and `ReviewModalControls.tsx` (batch/action feedback renders under the controls bar when present); the active proposal card is the shared read-only `frontend/src/features/review/ReviewItemCard.tsx`
- the header `Review` button is the only review entry point and opens one thread-scoped dialog for all proposal items across the selected thread
- the dialog uses responsive width rules, lets reviewers collapse the left TOC, and resize the TOC sidebar via a drag handle (width persisted in `localStorage` under `agent-review-sidebar-width`, default `340px`); renders a three-level tree (`Pending` / `Reviewed / Failed` → proposal type → entry `to` destination), keeps non-entry proposal types as flat leaves under their type node, sorts entry leaves by `name` inside each destination group, sorts the flat proposal list the same way for navigation and batch actions, and surfaces batch plus per-item review controls in a full-width bar above the denser review surface
- the review modal now follows the same compact border-first styling as the rest of the app instead of relying on pill-heavy special-case chrome
- proposals render four card sections when relevant: highlighted natural-language `Summary` (`proposalSummary.ts`, `ReviewSummary.tsx`), `Context` (`proposalContext.ts`, `ReviewContextList.tsx`), `Details` (`proposalFields.ts`, `fieldDisplay.ts`, `ReviewFieldList.tsx`), and resolved-only `Outcome` (`proposalOutcome.ts`, `ReviewOutcomeList.tsx`); summary highlights key values (date, from/to, amount, names), details use title-cased labels with currency-formatted amounts, and update rows show `before → after`
- shared TOC navigation lives in `frontend/src/features/review/ReviewToc.tsx` with tree building in `frontend/src/features/review/tocTree.ts` (status → proposal type → entry destination); agent-specific modal helpers live in `frontend/src/features/agent/review/modalHelpers.ts`
- payload record-shaping helpers still live in `frontend/src/features/agent/review/diff/` (`core.ts`, `domains.ts`) and are consumed by `buildProposalFields`
- non-applied items remain actionable after rejection or apply failure, so reviewers can move them back to `PENDING_REVIEW` or approve/reject directly from the reviewed section; `APPLIED` items stay read-only
- `Approve All` and `Reject All` call the thread-scoped batch review endpoints once, optimistically clear the pending TOC while the request runs, and invalidate agent/entry read models only after the batch completes
- TOC leaf buttons use unified titles (entry name or resource name only), left-border color for create/update/delete, trailing status icons for resolved rows, and shared payload-based subtitles (`-`/`+`/`~` kind sign plus date/amount for entries; entity category, account currency, etc. for other types) in both import and agent review
- detail cards share `review/ReviewCardHeader.tsx`: resource-name title plus key-value `cardMetadata` rows (`Type`, `Status`, then source-specific rows); import adds `Source` and `Duplicates`, agent supplies only the base rows for now
- apply failures surface inline on the affected item

## Composer

- pinned composer surface with stacked attachment prep cards; the bottom control row is compact (icon-first attach, model and approval-policy selects, send/stop)
- composer now stays docked against the bottom edge of the agent workspace instead of leaving dead space below the input row; the agent route caps workspace height to the viewport so the timeline scrolls internally and the composer does not fall below the fold
- textarea and control row share one card surface instead of reading as separate color bands
- supports picker, paste, and drag-drop for images, PDFs, and common plain-text files such as CSV
- composer attachments upload immediately on selection, then continue through server-side preparation before send; each draft card stays on one line with the filename, a live status label, and a compact inline progress bar beside the filename
- composer draft attachments stay removable while they are uploading or otherwise preparing so the user can drop a file before sending
- single-send waits for all draft attachments to finish upload/parsing before the streamed message request starts; once ready, the send request references persisted `attachment_ids` instead of re-uploading the same files
- draft status labels map directly to the active preparation mode: `Preparing pages…` means a PDF is being converted into page images for vision, `Saving…` means an image upload is finishing server-side, and `Ready` means the persisted draft attachment can be sent immediately
- attachment sends always use the backend's vision-prepared path; the composer no longer exposes an OCR toggle
- message attachments use browser-native large-view behavior instead of an app modal: user-message attachments stay compact file rows, assistant images open in a native tab on click, and assistant PDFs expose an `Open` action beside the inline preview
- multi-file imports moved to the dedicated **Import** tab (`frontend/src/features/import/*`); the Agent composer no longer exposes Bulk mode
- shows an **Approval policy** select (`Default` vs `Yolo`) next to the model picker; `Default` keeps the existing review workflow, `Yolo` sends `approval_policy=yolo` on the next message so the backend auto-applies this run’s pending proposals after a successful completion (same dependency rules as manual approval)
- shows an `Agent model` dropdown beside the policy control and sources options from runtime settings `available_agent_models` in the same order; option text uses `agent_model_display_names` when set, otherwise the raw model id
- initializes the picker from the latest run model when a thread has history, otherwise falls back through the thread's configured model and runtime default `agent_model`
- changing the picker only affects the next `POST /api/v1/agent/threads/{thread_id}/messages` or `/messages/stream` request; existing thread history is still sent unchanged
- `Cmd/Ctrl+Enter` always submits; plain `Enter` submits only for a single-line draft
- idle primary action is `Send`; active-run primary action is `Stop`
- switching to an idle thread restores that thread's own composer state immediately, even if another thread continues streaming in the background
- stop actions are selected-thread scoped: the composer only shows `Stop` when the selected thread itself is running, and interrupt requests target that selected thread's current run only
- agent messages stream over SSE from `POST /api/v1/agent/threads/{thread_id}/messages/stream`
- `useAgentPanelController.ts` now stays on panel composition, while `useAgentPanelQueries.ts` owns query polling/derived read models and `useAgentThreadActions.ts` owns thread lifecycle mutations plus cache reconciliation
- `useAgentComposerRuntime.ts` now stays focused on composer UI state, while `useAgentComposerActions.ts` owns stream sends and stop-run orchestration

## Usage And Activity

- cumulative usage bar shows `Context`, `Total input`, `Output`, `Cache read`, `Cache hit rate`, and total cost
- `Context` comes from backend persisted run snapshots; during live SSE, `run_usage` on each `run_event` patches the cached thread detail so the bar updates after each emitted event (including tool lifecycle), not only on refetch
- live activity is driven by `run_event`; usage totals remain authoritative on the run rows backing `GET /agent/threads/{id}`
- run summary cards count pending change types across entries, accounts, groups, tags, and entities
