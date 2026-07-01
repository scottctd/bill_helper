/**
 * CALLING SPEC:
 * - Purpose: pure state transitions for agent SSE events against the session store shape.
 * - Inputs: AgentStreamSessionState, AgentStreamEvent, and optional reducer clock/thread context.
 * - Outputs: next session state plus side-effect descriptors for the hook to execute.
 * - Side effects: none; callers run returned effects.
 */
import type {
  AgentRunStep,
  AgentStreamEvent,
  AgentStreamRunUsage,
  AgentToolCall,
  AgentToolCallStatus
} from "../../../lib/types";
import {
  appendLiveActivityLedgerItem,
  mergeRunSteps,
  mergeRunToolCalls,
  type RunActivityItem
} from "../activity";
import type { AgentStreamSessionState } from "./agentStreamSession";
import { warnUnknownAgentStreamEvent } from "./warnUnknownStreamEvent";

export interface StreamReducerContext {
  threadId: string;
  nowMs?: () => number;
  nowIso?: () => string;
}

export type StreamEffect =
  | {
      type: "patch_thread_cache";
      threadId: string;
      event: AgentStreamEvent;
      reasoningText?: string;
    }
  | {
      type: "patch_run_usage";
      threadId: string;
      runId: string;
      runUsage: AgentStreamRunUsage;
    }
  | {
      type: "hydrate_tool_call";
      threadId: string;
      runId: string;
      toolCallId: string;
      force?: boolean;
    }
  | {
      type: "invalidate_thread";
      threadId: string;
    };

export interface StreamReducerResult {
  state: AgentStreamSessionState;
  effects: StreamEffect[];
}

function defaultNowMs(): number {
  return Date.now();
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function mapHarnessToolStatus(status: string): AgentToolCallStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "ok":
      return "ok";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function streamStepId(runId: string, stepIndex: number): string {
  return `stream-step-${runId}-${stepIndex}`;
}

function buildOptimisticToolCallFromStarted(
  event: Extract<AgentStreamEvent, { type: "tool_started" }>,
  startedAt: string
): AgentToolCall {
  return {
    id: event.tool_call_id,
    run_id: event.run_id,
    step_id: streamStepId(event.run_id, event.step_index),
    call_index: 0,
    tool_request_id: event.tool_call_id,
    tool_name: event.tool_name,
    display_label: event.display_label ?? event.tool_name,
    display_detail: event.display_detail ?? null,
    arguments_json: null,
    result_content_json: null,
    output_text: null,
    has_full_payload: false,
    status: "running",
    error_code: null,
    started_at: startedAt,
    completed_at: null
  };
}

function buildOptimisticStepFromCommit(
  event: Extract<AgentStreamEvent, { type: "model_decision_committed" }>,
  reasoningText: string,
  state: AgentStreamSessionState,
  nowMs: () => number,
  nowIso: () => string
): AgentRunStep {
  const startedAt = state.reasoningSegmentStartedAtByRunId[event.run_id];
  const reasoningDurationMs =
    startedAt && reasoningText.trim().length > 0 ? Math.max(1, nowMs() - startedAt) : null;
  return {
    id: event.assistant_message_id,
    run_id: event.run_id,
    step_index: event.step_index,
    status: "committed",
    reasoning_text: reasoningText.trim().length > 0 ? reasoningText : null,
    progress_note: null,
    reasoning_duration_ms: reasoningDurationMs,
    latency_ms: null,
    created_at: nowIso()
  };
}

function trackActiveRunForThread(
  state: AgentStreamSessionState,
  threadId: string,
  runId: string
): AgentStreamSessionState {
  if (state.activeStreamRunIdsByThreadId[threadId] === runId) {
    return state;
  }
  return {
    ...state,
    activeStreamRunIdsByThreadId: {
      ...state.activeStreamRunIdsByThreadId,
      [threadId]: runId
    }
  };
}

function trackSequenceIndex(state: AgentStreamSessionState, event: AgentStreamEvent): AgentStreamSessionState {
  const sequenceIndex = "sequence_index" in event ? event.sequence_index : undefined;
  if (typeof sequenceIndex !== "number") {
    return state;
  }
  const runId = event.run_id;
  const previous = state.lastSequenceIndexByRunId[runId] ?? 0;
  if (sequenceIndex <= previous) {
    return state;
  }
  return {
    ...state,
    lastSequenceIndexByRunId: {
      ...state.lastSequenceIndexByRunId,
      [runId]: sequenceIndex
    }
  };
}

function appendLedgerItem(
  state: AgentStreamSessionState,
  runId: string,
  item: RunActivityItem
): AgentStreamSessionState {
  const existing = state.liveActivityLedgerByRunId[runId] ?? [];
  return {
    ...state,
    liveActivityLedgerByRunId: {
      ...state.liveActivityLedgerByRunId,
      [runId]: appendLiveActivityLedgerItem(existing, item)
    }
  };
}

function runUsageEffectIfPresent(
  effects: StreamEffect[],
  threadId: string,
  event: AgentStreamEvent & { run_usage?: AgentStreamRunUsage }
): void {
  if (event.run_usage) {
    effects.push({
      type: "patch_run_usage",
      threadId,
      runId: event.run_id,
      runUsage: event.run_usage
    });
  }
}

export function applyStreamEvent(
  inputState: AgentStreamSessionState,
  event: AgentStreamEvent,
  context: StreamReducerContext
): StreamReducerResult {
  const nowMs = context.nowMs ?? defaultNowMs;
  const nowIso = context.nowIso ?? defaultNowIso;
  const effects: StreamEffect[] = [];
  let state = trackSequenceIndex(inputState, event);
  state = trackActiveRunForThread(state, context.threadId, event.run_id);

  if (event.type === "reasoning_delta") {
    if (!state.reasoningSegmentStartedAtByRunId[event.run_id]) {
      state = {
        ...state,
        reasoningSegmentStartedAtByRunId: {
          ...state.reasoningSegmentStartedAtByRunId,
          [event.run_id]: nowMs()
        }
      };
    }
    const nextText = `${state.streamedReasoningTextByRunId[event.run_id] ?? ""}${event.delta}`;
    return {
      state: {
        ...state,
        streamedReasoningTextByRunId: {
          ...state.streamedReasoningTextByRunId,
          [event.run_id]: nextText
        }
      },
      effects
    };
  }

  if (event.type === "text_delta") {
    const nextText = `${state.streamedTextByRunId[event.run_id] ?? ""}${event.delta}`;
    return {
      state: {
        ...state,
        streamedTextByRunId: {
          ...state.streamedTextByRunId,
          [event.run_id]: nextText
        }
      },
      effects
    };
  }

  if (event.type === "model_delta") {
    if (event.delta_type === "reasoning") {
      if (!state.reasoningSegmentStartedAtByRunId[event.run_id]) {
        state = {
          ...state,
          reasoningSegmentStartedAtByRunId: {
            ...state.reasoningSegmentStartedAtByRunId,
            [event.run_id]: nowMs()
          }
        };
      }
      const nextText = `${state.streamedReasoningTextByRunId[event.run_id] ?? ""}${event.text}`;
      return {
        state: {
          ...state,
          streamedReasoningTextByRunId: {
            ...state.streamedReasoningTextByRunId,
            [event.run_id]: nextText
          }
        },
        effects
      };
    }
    const nextText = `${state.streamedTextByRunId[event.run_id] ?? ""}${event.text}`;
    return {
      state: {
        ...state,
        streamedTextByRunId: {
          ...state.streamedTextByRunId,
          [event.run_id]: nextText
        }
      },
      effects
    };
  }

  if (event.type === "run_started" || event.type === "model_request_started" || event.type === "step_committed") {
    runUsageEffectIfPresent(effects, context.threadId, event);
    return { state, effects };
  }

  if (event.type === "model_decision_committed") {
    runUsageEffectIfPresent(effects, context.threadId, event);
    const streamedReasoning = state.streamedReasoningTextByRunId[event.run_id] ?? "";
    const committedReasoning = (event.reasoning_text ?? "").trim();
    const reasoningText =
      streamedReasoning.trim().length > 0 ? streamedReasoning : committedReasoning;
    const optimisticStep = buildOptimisticStepFromCommit(event, reasoningText, state, nowMs, nowIso);
    if (reasoningText.trim().length > 0) {
      state = appendLedgerItem(state, event.run_id, {
        type: "reasoning_step",
        key: `${event.assistant_message_id}:reasoning`,
        runId: event.run_id,
        stepId: event.assistant_message_id,
        message: reasoningText.trim(),
        durationMs: optimisticStep.reasoning_duration_ms ?? null,
        createdAt: optimisticStep.created_at
      });
    }
    const streamedAssistantText = state.streamedTextByRunId[event.run_id] ?? "";
    const shouldAnchorAssistantText = event.has_tool_requests && streamedAssistantText.trim().length > 0;
    if (shouldAnchorAssistantText) {
      state = appendLedgerItem(state, event.run_id, {
        type: "assistant_message",
        key: `${event.assistant_message_id}:assistant`,
        runId: event.run_id,
        stepId: event.assistant_message_id,
        message: streamedAssistantText.trim(),
        createdAt: optimisticStep.created_at
      });
    }
    effects.push({
      type: "patch_thread_cache",
      threadId: context.threadId,
      event,
      reasoningText
    });
    const existingSteps = state.optimisticStepsByRunId[event.run_id] ?? [];
    const nextSteps = mergeRunSteps(existingSteps, [optimisticStep]);
    const nextReasoningByRunId = { ...state.streamedReasoningTextByRunId };
    delete nextReasoningByRunId[event.run_id];
    const nextReasoningStartedAt = { ...state.reasoningSegmentStartedAtByRunId };
    delete nextReasoningStartedAt[event.run_id];
    let nextTextByRunId = state.streamedTextByRunId;
    if (event.has_tool_requests && event.run_id in nextTextByRunId) {
      nextTextByRunId = { ...nextTextByRunId };
      delete nextTextByRunId[event.run_id];
    }
    return {
      state: {
        ...state,
        optimisticStepsByRunId: {
          ...state.optimisticStepsByRunId,
          [event.run_id]: nextSteps
        },
        streamedReasoningTextByRunId: nextReasoningByRunId,
        reasoningSegmentStartedAtByRunId: nextReasoningStartedAt,
        streamedTextByRunId: nextTextByRunId
      },
      effects
    };
  }

  if (event.type === "tool_started") {
    runUsageEffectIfPresent(effects, context.threadId, event);
    const startedAt = nowIso();
    const optimisticToolCall = buildOptimisticToolCallFromStarted(event, startedAt);
    state = appendLedgerItem(state, event.run_id, {
      type: "tool_call",
      key: event.tool_call_id,
      runId: event.run_id,
      toolCallId: event.tool_call_id,
      toolCall: optimisticToolCall,
      createdAt: optimisticToolCall.started_at ?? startedAt
    });
    effects.push({ type: "patch_thread_cache", threadId: context.threadId, event });
    if (event.tool_name === "rename_thread") {
      effects.push({
        type: "hydrate_tool_call",
        threadId: context.threadId,
        runId: event.run_id,
        toolCallId: event.tool_call_id
      });
    }
    const existing = state.optimisticToolCallsByRunId[event.run_id] ?? [];
    return {
      state: {
        ...state,
        optimisticToolCallsByRunId: {
          ...state.optimisticToolCallsByRunId,
          [event.run_id]: mergeRunToolCalls(existing, [optimisticToolCall])
        }
      },
      effects
    };
  }

  if (event.type === "tool_finished") {
    runUsageEffectIfPresent(effects, context.threadId, event);
    const status = mapHarnessToolStatus(event.status);
    const completedAt = nowIso();
    const existingToolCalls = state.optimisticToolCallsByRunId[event.run_id] ?? [];
    const matched = existingToolCalls.find((toolCall) => toolCall.id === event.tool_call_id);
    const patch: AgentToolCall = matched
      ? {
          ...matched,
          display_label: event.display_label ?? matched.display_label,
          display_detail: event.display_detail ?? matched.display_detail,
          status,
          completed_at: completedAt
        }
      : {
          ...buildOptimisticToolCallFromStarted(
            {
              type: "tool_started",
              run_id: event.run_id,
              step_index: event.step_index,
              tool_call_id: event.tool_call_id,
              tool_name: event.tool_name,
              display_label: event.display_label,
              display_detail: event.display_detail
            },
            completedAt
          ),
          status,
          completed_at: completedAt
        };
    state = appendLedgerItem(state, event.run_id, {
      type: "tool_call",
      key: event.tool_call_id,
      runId: event.run_id,
      toolCallId: event.tool_call_id,
      toolCall: patch,
      createdAt: patch.started_at ?? patch.completed_at ?? completedAt
    });
    effects.push({ type: "patch_thread_cache", threadId: context.threadId, event });
    if (event.tool_name === "rename_thread") {
      effects.push({
        type: "hydrate_tool_call",
        threadId: context.threadId,
        runId: event.run_id,
        toolCallId: event.tool_call_id,
        force: true
      });
    }
    if (status === "error" && event.tool_name === "rename_thread") {
      effects.push({ type: "invalidate_thread", threadId: context.threadId });
    }
    const existing = state.optimisticToolCallsByRunId[event.run_id] ?? [];
    return {
      state: {
        ...state,
        optimisticToolCallsByRunId: {
          ...state.optimisticToolCallsByRunId,
          [event.run_id]: mergeRunToolCalls(existing, [patch])
        }
      },
      effects
    };
  }

  if (event.type === "run_finished") {
    runUsageEffectIfPresent(effects, context.threadId, event);
    effects.push({ type: "patch_thread_cache", threadId: context.threadId, event });
    const streamed = state.streamedTextByRunId[event.run_id] ?? "";
    const finalContent = (event.final_assistant_content ?? "").trim();
    if (!streamed && !finalContent) {
      return { state, effects };
    }
    if (streamed && finalContent && streamed.trim() === finalContent) {
      const nextTextByRunId = { ...state.streamedTextByRunId };
      delete nextTextByRunId[event.run_id];
      return {
        state: {
          ...state,
          streamedTextByRunId: nextTextByRunId
        },
        effects
      };
    }
    if (finalContent) {
      const nextTextByRunId = { ...state.streamedTextByRunId };
      delete nextTextByRunId[event.run_id];
      return {
        state: {
          ...state,
          streamedTextByRunId: nextTextByRunId
        },
        effects
      };
    }
    return { state, effects };
  }

  warnUnknownAgentStreamEvent(event);
  return { state, effects };
}

export function createEmptyAgentStreamSessionState(): AgentStreamSessionState {
  return {
    activeStreamRunIdsByThreadId: {},
    streamedReasoningTextByRunId: {},
    streamedTextByRunId: {},
    optimisticStepsByRunId: {},
    optimisticToolCallsByRunId: {},
    liveActivityLedgerByRunId: {},
    reasoningSegmentStartedAtByRunId: {},
    lastSequenceIndexByRunId: {}
  };
}
