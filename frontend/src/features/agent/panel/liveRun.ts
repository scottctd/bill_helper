/**
 * CALLING SPEC:
 * - Purpose: resolve which run id should receive live SSE buffer rendering for a thread.
 * - Inputs: thread runs, SSE thread map, and in-memory stream buffers.
 * - Outputs: `resolveLiveRunIdForThread`, `findRunningRunForThread`.
 * - Side effects: none.
 */
import type { AgentRun } from "../../../lib/types";
import type { AgentStreamSessionState } from "./agentStreamSession";

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

export function resolveReconnectSequenceIndex(
  run: AgentRun,
  session: AgentStreamSessionState
): number {
  const persistedMax = run.last_event_sequence_index ?? 0;
  const sessionMax = session.lastSequenceIndexByRunId[run.id] ?? 0;
  return Math.max(persistedMax, sessionMax);
}
