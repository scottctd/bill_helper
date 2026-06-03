/**
 * CALLING SPEC:
 * - Purpose: load an import task thread with live SSE reconnect for AgentTimeline.
 * - Inputs: thread id and whether the dialog is open.
 * - Outputs: thread query data and stream state props for AgentTimeline.
 * - Side effects: agent thread queries and SSE subscription.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAgentThread } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import { runsByAssistantMessage, runsWithoutAssistantMessage, runsWithoutAssistantMessageByUserMessage } from "../agent/activity";
import { useAgentComposerStreamState } from "../agent/panel/useAgentComposerStreamState";
import { useAgentStreamReconnect } from "../agent/panel/useAgentStreamReconnect";

export function useImportTaskTimeline(threadId: string, enabled: boolean) {
  const [streamHealthyByThreadId, setStreamHealthyByThreadId] = useState<Record<string, boolean>>({});

  const threadQuery = useQuery({
    queryKey: queryKeys.agent.thread(threadId),
    queryFn: () => getAgentThread(threadId),
    enabled: enabled && Boolean(threadId),
    refetchInterval: (query) => {
      const detail = query.state.data;
      const running = (detail?.runs ?? []).some((run) => run.status === "running");
      const streamHealthy = streamHealthyByThreadId[threadId] ?? false;
      return running && !streamHealthy ? 2000 : false;
    }
  });

  const noop = useCallback(() => undefined, []);
  const applyThreadTitleToCaches = useCallback((_threadId: string, _title: string | null) => undefined, []);
  const setThreadStreamHealthy = useCallback((id: string, isHealthy: boolean) => {
    setStreamHealthyByThreadId((current) => ({ ...current, [id]: isHealthy }));
  }, []);

  const streamState = useAgentComposerStreamState({
    applyThreadTitleToCaches,
    pendingAssistantMessage: null,
    selectedThreadId: threadId,
    setActionError: noop,
    threadDetail: threadQuery.data
  });

  useAgentStreamReconnect({
    clearOptimisticThreadTitle: noop,
    getReconnectSequenceIndex: streamState.getReconnectSequenceIndex,
    handleAgentStreamEvent: streamState.handleAgentStreamEvent,
    removeOptimisticRunningThreadId: noop,
    resetOptimisticRunState: streamState.resetOptimisticRunState,
    selectedThreadId: threadId,
    setThreadStreamHealthy,
    threadDetail: threadQuery.data
  });

  const runsByAssistantMessageId = useMemo(
    () => runsByAssistantMessage(threadQuery.data),
    [threadQuery.data]
  );
  const pendingAssistantRuns = useMemo(
    () => runsWithoutAssistantMessage(threadQuery.data),
    [threadQuery.data]
  );
  const pendingAssistantRunsByUserMessageId = useMemo(
    () => runsWithoutAssistantMessageByUserMessage(threadQuery.data),
    [threadQuery.data]
  );

  return {
    threadQuery,
    runsByAssistantMessageId,
    pendingAssistantRuns,
    pendingAssistantRunsByUserMessageId,
    ...streamState
  };
}
