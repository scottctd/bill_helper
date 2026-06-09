/**
 * CALLING SPEC:
 * - Purpose: load an import task thread with live SSE reconnect, timeline, and follow-up composer.
 * - Inputs: thread id and whether the dialog is open.
 * - Outputs: thread query data, composer props, and stream state props for AgentTimeline.
 * - Side effects: agent thread queries, runtime settings query, and SSE subscription.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getAgentThread, getRuntimeSettings, interruptAgentRun } from "../../lib/api";
import { invalidateAgentThreadData } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import type { AgentThreadDetail, AgentThreadSummary } from "../../lib/types";
import { pendingRuns, runById } from "../agent/activity";
import { useAgentComposerRuntime } from "../agent/panel/useAgentComposerRuntime";

export function useImportTaskTimeline(threadId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
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

  const runtimeSettingsQuery = useQuery({
    queryKey: queryKeys.settings.runtime,
    queryFn: getRuntimeSettings,
    enabled
  });

  const interruptRunMutation = useMutation({
    mutationFn: (payload: { runId: string; threadId: string }) => interruptAgentRun(payload.runId),
    onSuccess: (_, payload) => {
      invalidateAgentThreadData(queryClient, payload.threadId || undefined);
      setActionError(null);
    },
    onError: (error) => {
      setActionError((error as Error).message);
    }
  });

  const addOptimisticRunningThreadId = useCallback((_id: string) => undefined, []);
  const removeOptimisticRunningThreadId = useCallback((_id: string) => undefined, []);
  const clearOptimisticThreadTitle = useCallback((_id: string) => undefined, []);

  const setThreadStreamHealthy = useCallback((id: string, isHealthy: boolean) => {
    setStreamHealthyByThreadId((current) => ({ ...current, [id]: isHealthy }));
  }, []);

  const applyThreadTitleToCaches = useCallback(
    (id: string, title: string | null, updatedAt: string = new Date().toISOString()) => {
      if (!title) {
        return;
      }
      queryClient.setQueryData(queryKeys.agent.thread(id), (current: AgentThreadDetail | undefined) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          thread: {
            ...current.thread,
            title,
            updated_at: updatedAt
          }
        };
      });
      queryClient.setQueryData(queryKeys.agent.threads, (current: AgentThreadSummary[] | undefined) => {
        if (!current) {
          return current;
        }
        return [...current]
          .map((thread) => (thread.id === id ? { ...thread, title, updated_at: updatedAt } : thread))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
      });
    },
    [queryClient]
  );

  const ensureThreadId = useCallback(async () => {
    if (!threadId) {
      throw new Error("Import task thread is unavailable.");
    }
    return threadId;
  }, [threadId]);

  const runtime = useAgentComposerRuntime({
    actionError,
    addOptimisticRunningThreadId,
    applyThreadTitleToCaches,
    availableComposerModels: runtimeSettingsQuery.data?.available_agent_models ?? [],
    clearOptimisticThreadTitle,
    ensureThreadId,
    async interruptRun(payload: { runId: string; threadId: string }) {
      await interruptRunMutation.mutateAsync(payload);
    },
    isInterruptPending: interruptRunMutation.isPending && interruptRunMutation.variables?.threadId === threadId,
    isMutating: interruptRunMutation.isPending,
    removeOptimisticRunningThreadId,
    runtimeSettings: runtimeSettingsQuery.data,
    selectedThreadId: threadId,
    setActionError,
    setThreadStreamHealthy,
    threadDetail: threadQuery.data
  });

  const runsById = useMemo(() => runById(threadQuery.data), [threadQuery.data]);
  const pendingAssistantRuns = useMemo(() => pendingRuns(threadQuery.data), [threadQuery.data]);

  return {
    threadQuery,
    runsById,
    pendingAssistantRuns,
    composer: runtime.composer,
    timeline: runtime.timeline
  };
}
