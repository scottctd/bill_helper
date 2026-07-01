/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentPanelQueries` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentPanelQueries.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `useAgentPanelQueries`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAgentThread, getRuntimeSettings, listAgentThreads } from "../../../lib/api";
import { listOrEmpty } from "../../../lib/collections";
import { queryKeys } from "../../../lib/queryKeys";
import type { AgentThreadDetail, AgentThreadSummary } from "../../../lib/types";
import {
  buildThreadUsageTotals,
  pendingRuns,
  runById,
  visibleTurns
} from "../activity";

interface UseAgentPanelQueriesArgs {
  isOpen: boolean;
  selectedThreadId: string;
  setSelectedThreadId: (threadId: string) => void;
  /** When true, user chose "New Thread" and we must not auto-select the first listed thread. */
  isNewThreadDraft: boolean;
  optimisticRunningThreadIds: string[];
  optimisticThreadTitlesById: Record<string, string>;
  isStreamHealthy: boolean;
  pruneOptimisticRunningThreadIds: (threads: AgentThreadSummary[]) => void;
}

export function useAgentPanelQueries({
  isOpen,
  selectedThreadId,
  setSelectedThreadId,
  isNewThreadDraft,
  optimisticRunningThreadIds,
  optimisticThreadTitlesById,
  isStreamHealthy,
  pruneOptimisticRunningThreadIds
}: UseAgentPanelQueriesArgs) {
  const threadsQuery = useQuery({
    queryKey: queryKeys.agent.threads,
    queryFn: listAgentThreads,
    enabled: isOpen,
    refetchInterval: (query) => {
      const threads = query.state.data as AgentThreadSummary[] | undefined;
      const hasRunningThread = (threads ?? []).some((thread) => thread.has_running_run);
      return hasRunningThread || optimisticRunningThreadIds.length > 0 ? 5000 : false;
    },
    refetchIntervalInBackground: true
  });
  const runtimeSettingsQuery = useQuery({
    queryKey: queryKeys.settings.runtime,
    queryFn: getRuntimeSettings,
    enabled: isOpen
  });
  const threadQuery = useQuery({
    queryKey: queryKeys.agent.thread(selectedThreadId),
    queryFn: () => getAgentThread(selectedThreadId),
    enabled: isOpen && Boolean(selectedThreadId),
    refetchInterval: (query) => {
      const detail = query.state.data as AgentThreadDetail | undefined;
      const hasRunningRun = (detail?.runs ?? []).some((run) => run.status === "running");
      return hasRunningRun && !isStreamHealthy ? 5000 : false;
    },
    refetchIntervalInBackground: true
  });

  const displayedThreads = useMemo(() => {
    if (!threadsQuery.data) {
      return threadsQuery.data;
    }
    return threadsQuery.data.map((thread) => {
      const optimisticTitle = optimisticThreadTitlesById[thread.id];
      return optimisticTitle ? { ...thread, title: optimisticTitle } : thread;
    });
  }, [optimisticThreadTitlesById, threadsQuery.data]);

  useEffect(() => {
    if (!isOpen || selectedThreadId || isNewThreadDraft) {
      return;
    }
    const firstId = threadsQuery.data?.[0]?.id;
    if (firstId) {
      setSelectedThreadId(firstId);
    }
  }, [isOpen, isNewThreadDraft, selectedThreadId, setSelectedThreadId, threadsQuery.data]);

  useEffect(() => {
    if (!threadsQuery.data) {
      return;
    }
    pruneOptimisticRunningThreadIds(threadsQuery.data);
  }, [pruneOptimisticRunningThreadIds, threadsQuery.data]);

  const runsById = useMemo(() => runById(threadQuery.data), [threadQuery.data]);
  const pendingAssistantRuns = useMemo(() => pendingRuns(threadQuery.data), [threadQuery.data]);
  const reviewProposalCount = useMemo(
    () => (threadQuery.data?.runs ?? []).reduce((total, run) => total + listOrEmpty(run.change_items).length, 0),
    [threadQuery.data?.runs]
  );
  const pendingReviewCount = useMemo(
    () =>
      (threadQuery.data?.runs ?? []).reduce(
        (total, run) => total + listOrEmpty(run.change_items).filter((item) => item.status === "PENDING_REVIEW").length,
        0
      ),
    [threadQuery.data?.runs]
  );
  const threadUsageTotals = useMemo(() => buildThreadUsageTotals(threadQuery.data), [threadQuery.data]);
  const initiatedByExternalAgent = threadQuery.data?.thread.initiated_by_external_agent ?? false;
  const visibleTurnList = useMemo(() => visibleTurns(threadQuery.data), [threadQuery.data]);

  return {
    displayedThreads,
    initiatedByExternalAgent,
    pendingAssistantRuns,
    pendingReviewCount,
    reviewProposalCount,
    runsById,
    runtimeSettingsQuery,
    threadQuery,
    threadUsageTotals,
    threadsQuery,
    visibleTurns: visibleTurnList
  };
}
