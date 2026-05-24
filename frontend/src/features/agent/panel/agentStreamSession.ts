/**
 * CALLING SPEC:
 * - Purpose: hold in-flight agent SSE buffers across thread switches and panel remounts within one browser session.
 * - Inputs: stream state hooks and send orchestration in the agent panel.
 * - Outputs: shared session store and abort-controller registry.
 * - Side effects: module-level mutable state; abort only via explicit Stop.
 */
import type { AgentRunEvent, AgentToolCall } from "../../../lib/types";

export interface AgentStreamSessionState {
  activeStreamRunIdsByThreadId: Record<string, string>;
  streamedReasoningTextByRunId: Record<string, string>;
  streamedTextByRunId: Record<string, string>;
  optimisticRunEventsByRunId: Record<string, AgentRunEvent[]>;
  optimisticToolCallsByRunId: Record<string, AgentToolCall[]>;
  reasoningSegmentStartedAtByRunId: Record<string, number>;
  lastSequenceIndexByRunId: Record<string, number>;
}

export const agentStreamSession: AgentStreamSessionState = {
  activeStreamRunIdsByThreadId: {},
  streamedReasoningTextByRunId: {},
  streamedTextByRunId: {},
  optimisticRunEventsByRunId: {},
  optimisticToolCallsByRunId: {},
  reasoningSegmentStartedAtByRunId: {},
  lastSequenceIndexByRunId: {}
};

export const agentStreamAbortControllers: Record<string, AbortController> = {};

export function clearAgentStreamSessionRun(runId: string): void {
  delete agentStreamSession.streamedReasoningTextByRunId[runId];
  delete agentStreamSession.streamedTextByRunId[runId];
  delete agentStreamSession.optimisticRunEventsByRunId[runId];
  delete agentStreamSession.optimisticToolCallsByRunId[runId];
  delete agentStreamSession.reasoningSegmentStartedAtByRunId[runId];
  delete agentStreamSession.lastSequenceIndexByRunId[runId];
}

export function clearAgentStreamSessionThread(threadId: string): void {
  const runId = agentStreamSession.activeStreamRunIdsByThreadId[threadId];
  delete agentStreamSession.activeStreamRunIdsByThreadId[threadId];
  if (runId) {
    clearAgentStreamSessionRun(runId);
  }
}

export function resetAgentStreamSession(): void {
  agentStreamSession.activeStreamRunIdsByThreadId = {};
  agentStreamSession.streamedReasoningTextByRunId = {};
  agentStreamSession.streamedTextByRunId = {};
  agentStreamSession.optimisticRunEventsByRunId = {};
  agentStreamSession.optimisticToolCallsByRunId = {};
  agentStreamSession.reasoningSegmentStartedAtByRunId = {};
  agentStreamSession.lastSequenceIndexByRunId = {};
}
