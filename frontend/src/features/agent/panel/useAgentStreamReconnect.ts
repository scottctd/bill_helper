/**
 * CALLING SPEC:
 * - Purpose: reconnect live agent SSE streams after refresh or when another tab owns the run worker.
 * - Inputs: selected thread detail, stream event handler, and thread stream health callbacks.
 * - Outputs: side-effect hook that subscribes to `GET /agent/runs/{run_id}/stream` for running runs.
 * - Side effects: opens SSE fetch connections; abort only via explicit Stop.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentThread, streamAgentRun } from "../../../lib/api";
import { queryKeys } from "../../../lib/queryKeys";
import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import type { AgentStreamEvent, AgentThreadDetail } from "../../../lib/types";
import { agentStreamAbortControllers } from "./agentStreamSession";
import { findRunningRunForThread } from "./liveRun";

interface UseAgentStreamReconnectArgs {
  clearOptimisticThreadTitle: (threadId: string) => void;
  getReconnectSequenceIndex: (runId: string) => number;
  handleAgentStreamEvent: (threadId: string, event: AgentStreamEvent) => void;
  removeOptimisticRunningThreadId: (threadId: string) => void;
  resetOptimisticRunState: (threadId?: string) => void;
  selectedThreadId: string;
  setThreadStreamHealthy: (threadId: string, isHealthy: boolean) => void;
  threadDetail: AgentThreadDetail | undefined;
}

export function useAgentStreamReconnect({
  clearOptimisticThreadTitle,
  getReconnectSequenceIndex,
  handleAgentStreamEvent,
  removeOptimisticRunningThreadId,
  resetOptimisticRunState,
  selectedThreadId,
  setThreadStreamHealthy,
  threadDetail
}: UseAgentStreamReconnectArgs) {
  const queryClient = useQueryClient();
  const reconnectRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    reconnectRunIdRef.current = null;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !threadDetail) {
      return;
    }
    if (agentStreamAbortControllers[selectedThreadId]) {
      return;
    }

    const runningRun = findRunningRunForThread(threadDetail.runs ?? []);
    if (!runningRun) {
      return;
    }
    if (reconnectRunIdRef.current === runningRun.id) {
      return;
    }

    reconnectRunIdRef.current = runningRun.id;
    const abortController = new AbortController();
    agentStreamAbortControllers[selectedThreadId] = abortController;
    setThreadStreamHealthy(selectedThreadId, true);

    void (async () => {
      try {
        await streamAgentRun({
          runId: runningRun.id,
          afterSequence: getReconnectSequenceIndex(runningRun.id),
          signal: abortController.signal,
          onEvent: (streamEvent) => handleAgentStreamEvent(selectedThreadId, streamEvent)
        });
        delete agentStreamAbortControllers[selectedThreadId];
        setThreadStreamHealthy(selectedThreadId, false);
        const detail = await getAgentThread(selectedThreadId);
        queryClient.setQueryData(queryKeys.agent.thread(selectedThreadId), detail);
        clearOptimisticThreadTitle(selectedThreadId);
        invalidateAgentThreadData(queryClient, selectedThreadId);
        removeOptimisticRunningThreadId(selectedThreadId);
        resetOptimisticRunState(selectedThreadId);
      } catch (error) {
        delete agentStreamAbortControllers[selectedThreadId];
        setThreadStreamHealthy(selectedThreadId, false);
        if ((error as Error).name !== "AbortError") {
          reconnectRunIdRef.current = null;
        }
      }
    })();
  }, [
    clearOptimisticThreadTitle,
    getReconnectSequenceIndex,
    handleAgentStreamEvent,
    queryClient,
    removeOptimisticRunningThreadId,
    resetOptimisticRunState,
    selectedThreadId,
    setThreadStreamHealthy,
    threadDetail
  ]);
}
