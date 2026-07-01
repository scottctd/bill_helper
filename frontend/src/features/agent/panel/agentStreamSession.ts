/**
 * CALLING SPEC:
 * - Purpose: hold in-flight agent SSE buffers across thread switches and panel remounts within one browser session.
 * - Inputs: stream reducer updates, stream state hooks, and send orchestration in the agent panel.
 * - Outputs: subscribe/getSnapshot store API, shared session state, and abort-controller registry.
 * - Side effects: module-level mutable state; abort only via explicit Stop.
 */
import type { AgentRunStep, AgentStreamEvent, AgentToolCall } from "../../../lib/types";
import type { RunActivityItem } from "../activity";
import { applyStreamEvent, createEmptyAgentStreamSessionState, type StreamEffect } from "./streamReducer";

export interface AgentStreamSessionState {
  activeStreamRunIdsByThreadId: Record<string, string>;
  streamedReasoningTextByRunId: Record<string, string>;
  streamedTextByRunId: Record<string, string>;
  optimisticStepsByRunId: Record<string, AgentRunStep[]>;
  optimisticToolCallsByRunId: Record<string, AgentToolCall[]>;
  liveActivityLedgerByRunId: Record<string, RunActivityItem[]>;
  reasoningSegmentStartedAtByRunId: Record<string, number>;
  lastSequenceIndexByRunId: Record<string, number>;
}

type StreamListener = () => void;

/** Stable reference for direct reads (liveRun, AgentTimeline timing helpers). */
export const agentStreamSession: AgentStreamSessionState = createEmptyAgentStreamSessionState();

const listeners = new Set<StreamListener>();
let snapshotRevision = 0;

function assignSessionState(nextState: AgentStreamSessionState): void {
  agentStreamSession.activeStreamRunIdsByThreadId = nextState.activeStreamRunIdsByThreadId;
  agentStreamSession.streamedReasoningTextByRunId = nextState.streamedReasoningTextByRunId;
  agentStreamSession.streamedTextByRunId = nextState.streamedTextByRunId;
  agentStreamSession.optimisticStepsByRunId = nextState.optimisticStepsByRunId;
  agentStreamSession.optimisticToolCallsByRunId = nextState.optimisticToolCallsByRunId;
  agentStreamSession.liveActivityLedgerByRunId = nextState.liveActivityLedgerByRunId;
  agentStreamSession.reasoningSegmentStartedAtByRunId = nextState.reasoningSegmentStartedAtByRunId;
  agentStreamSession.lastSequenceIndexByRunId = nextState.lastSequenceIndexByRunId;
}

function notifyListeners(): void {
  snapshotRevision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeAgentStreamSession(listener: StreamListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAgentStreamSessionSnapshot(): AgentStreamSessionState {
  return agentStreamSession;
}

export function getAgentStreamSessionRevision(): number {
  return snapshotRevision;
}

export function setAgentStreamSessionState(nextState: AgentStreamSessionState): void {
  assignSessionState(nextState);
  notifyListeners();
}

export interface ApplyAgentStreamEventResult {
  effects: StreamEffect[];
}

export function applyAgentStreamEventToStore(
  threadId: string,
  event: AgentStreamEvent
): ApplyAgentStreamEventResult {
  const { state, effects } = applyStreamEvent(agentStreamSession, event, { threadId });
  assignSessionState(state);
  notifyListeners();
  return { effects };
}

export function setActiveStreamRunForThread(threadId: string, runId: string): void {
  if (agentStreamSession.activeStreamRunIdsByThreadId[threadId] === runId) {
    return;
  }
  setAgentStreamSessionState({
    ...agentStreamSession,
    activeStreamRunIdsByThreadId: {
      ...agentStreamSession.activeStreamRunIdsByThreadId,
      [threadId]: runId
    }
  });
}

export function setAgentStreamSessionOptimisticToolCalls(runId: string, toolCalls: AgentToolCall[]): void {
  setAgentStreamSessionState({
    ...agentStreamSession,
    optimisticToolCallsByRunId: {
      ...agentStreamSession.optimisticToolCallsByRunId,
      [runId]: toolCalls
    }
  });
}

export const agentStreamAbortControllers: Record<string, AbortController> = {};

export function clearAgentStreamSessionRun(runId: string): void {
  const nextState = {
    ...agentStreamSession,
    streamedReasoningTextByRunId: { ...agentStreamSession.streamedReasoningTextByRunId },
    streamedTextByRunId: { ...agentStreamSession.streamedTextByRunId },
    optimisticStepsByRunId: { ...agentStreamSession.optimisticStepsByRunId },
    optimisticToolCallsByRunId: { ...agentStreamSession.optimisticToolCallsByRunId },
    liveActivityLedgerByRunId: { ...agentStreamSession.liveActivityLedgerByRunId },
    reasoningSegmentStartedAtByRunId: { ...agentStreamSession.reasoningSegmentStartedAtByRunId },
    lastSequenceIndexByRunId: { ...agentStreamSession.lastSequenceIndexByRunId }
  };
  delete nextState.streamedReasoningTextByRunId[runId];
  delete nextState.streamedTextByRunId[runId];
  delete nextState.optimisticStepsByRunId[runId];
  delete nextState.optimisticToolCallsByRunId[runId];
  delete nextState.liveActivityLedgerByRunId[runId];
  delete nextState.reasoningSegmentStartedAtByRunId[runId];
  delete nextState.lastSequenceIndexByRunId[runId];
  setAgentStreamSessionState(nextState);
}

export function clearAgentStreamSessionThread(threadId: string): void {
  const runId = agentStreamSession.activeStreamRunIdsByThreadId[threadId];
  const nextActive = { ...agentStreamSession.activeStreamRunIdsByThreadId };
  delete nextActive[threadId];
  setAgentStreamSessionState({
    ...agentStreamSession,
    activeStreamRunIdsByThreadId: nextActive
  });
  if (runId) {
    clearAgentStreamSessionRun(runId);
  }
}

export function resetAgentStreamSession(): void {
  setAgentStreamSessionState(createEmptyAgentStreamSessionState());
}
