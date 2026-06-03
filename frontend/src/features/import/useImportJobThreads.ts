/**
 * CALLING SPEC:
 * - Purpose: load agent thread details for all tasks in an import job.
 * - Inputs: task thread ids and whether queries should run.
 * - Outputs: per-thread runs map and aggregate pending proposal counts.
 * - Side effects: authenticated agent thread GET requests.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { getAgentThread } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { AgentRun, ImportTask } from "../../lib/types";
import { countPendingProposalsInRuns } from "./importHelpers";

export function useImportJobThreads(tasks: ImportTask[], enabled: boolean) {
  const threadIds = useMemo(
    () => [...new Set(tasks.map((task) => task.thread_id).filter(Boolean))],
    [tasks]
  );

  const threadQueries = useQueries({
    queries: threadIds.map((threadId) => ({
      queryKey: queryKeys.agent.thread(threadId),
      queryFn: () => getAgentThread(threadId),
      enabled: enabled && Boolean(threadId)
    }))
  });

  const runsByThreadId = useMemo(() => {
    const map: Record<string, AgentRun[]> = {};
    threadIds.forEach((threadId, index) => {
      map[threadId] = threadQueries[index]?.data?.runs ?? [];
    });
    return map;
  }, [threadIds, threadQueries]);

  const pendingByThreadId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const threadId of threadIds) {
      map[threadId] = countPendingProposalsInRuns(runsByThreadId[threadId]);
    }
    return map;
  }, [runsByThreadId, threadIds]);

  const totalPendingCount = useMemo(
    () => Object.values(pendingByThreadId).reduce((sum, count) => sum + count, 0),
    [pendingByThreadId]
  );

  const isLoading = threadQueries.some((query) => query.isLoading);

  return {
    threadIds,
    runsByThreadId,
    pendingByThreadId,
    totalPendingCount,
    isLoading
  };
}
