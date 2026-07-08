/**
 * CALLING SPEC:
 * - Purpose: resolve which run id should receive live SSE buffer rendering for a thread.
 * - Inputs: thread runs, SSE thread map, and in-memory stream buffers.
 * - Outputs: live-run resolution helpers plus stream-active and summary-visibility gates.
 * - Side effects: none.
 */
import type { AgentRun } from "../../../lib/types";
import { listOrEmpty } from "../../../lib/collections";
import type { AgentStreamSessionState } from "./agentStreamSession";

export interface RunStreamActivityContext {
  activeStreamRunId?: string | null;
  streamedReasoningTextByRunId?: Record<string, string>;
  streamedTextByRunId?: Record<string, string>;
}

export function findRunningRunForThread(runs: AgentRun[]): AgentRun | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index].status === "running") {
      return runs[index];
    }
  }
  return null;
}

function runHasLiveStreamBuffers(runId: string, session: AgentStreamSessionState): boolean {
  return (
    (session.streamedReasoningTextByRunId[runId]?.length ?? 0) > 0 ||
    (session.streamedTextByRunId[runId]?.length ?? 0) > 0 ||
    (session.optimisticStepsByRunId[runId]?.length ?? 0) > 0 ||
    (session.optimisticToolCallsByRunId[runId]?.length ?? 0) > 0
  );
}

export function resolveLiveRunIdForThread(
  threadId: string,
  runs: AgentRun[],
  session: AgentStreamSessionState
): string | null {
  const mappedRunId = session.activeStreamRunIdsByThreadId[threadId];
  if (mappedRunId) {
    return mappedRunId;
  }
  const runningRun = findRunningRunForThread(runs);
  if (!runningRun) {
    return null;
  }
  if (runHasLiveStreamBuffers(runningRun.id, session)) {
    return runningRun.id;
  }
  return runningRun.status === "running" ? runningRun.id : null;
}

export function isRunStreamActive(run: AgentRun, context: RunStreamActivityContext = {}): boolean {
  if (run.status === "running") {
    return true;
  }
  if (context.activeStreamRunId === run.id) {
    return true;
  }
  if ((context.streamedReasoningTextByRunId?.[run.id]?.length ?? 0) > 0) {
    return true;
  }
  if ((context.streamedTextByRunId?.[run.id]?.length ?? 0) > 0) {
    return true;
  }
  return false;
}

export function shouldShowRunChangeSummary(
  run: AgentRun,
  changeItemCount: number,
  options: {
    isStreamActive: boolean;
    hasVisibleAssistantMessage?: boolean;
  }
): boolean {
  if (changeItemCount === 0 || options.isStreamActive) {
    return false;
  }
  const persistedReply = (run.final_assistant_reply ?? "").trim();
  if (run.status === "completed" && !options.hasVisibleAssistantMessage && !persistedReply) {
    return false;
  }
  return true;
}

export function resolveReconnectSequenceIndex(
  run: AgentRun,
  session: AgentStreamSessionState
): number {
  const persistedMax = listOrEmpty(run.events).reduce(
    (max, event) => Math.max(max, event.sequence_index ?? 0),
    0
  );
  const sessionMax = session.lastSequenceIndexByRunId[run.id] ?? 0;
  return Math.max(persistedMax, sessionMax);
}
