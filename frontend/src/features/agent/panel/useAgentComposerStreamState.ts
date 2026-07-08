/**
 * CALLING SPEC:
 * - Purpose: subscribe React to the module agent stream store and execute stream side effects.
 * - Inputs: thread detail, pending assistant message, and thread cache title helpers.
 * - Outputs: derived live-run view data, stream event handler, and reconnect sequence helper.
 * - Side effects: query-cache patches, tool-call hydration fetches, and thread invalidation via effects.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentToolCall } from "../../../lib/api";
import { listOrEmpty } from "../../../lib/collections";
import type { AgentRun, AgentThreadDetail, AgentToolCall } from "../../../lib/types";
import { mergeRunToolCalls, pendingRuns } from "../activity";
import { patchAgentThreadCachedToolCall } from "../threadDetailCache";
import {
  applyAgentStreamEventToStore,
  clearAgentStreamSessionRun,
  clearAgentStreamSessionThread,
  getAgentStreamSessionRevision,
  getAgentStreamSessionSnapshot,
  resetAgentStreamSession,
  setActiveStreamRunForThread,
  setAgentStreamSessionOptimisticToolCalls,
  subscribeAgentStreamSession
} from "./agentStreamSession";
import { extractRenameThreadTitle } from "./helpers";
import { findRunningRunForThread, resolveLiveRunIdForThread, resolveReconnectSequenceIndex } from "./liveRun";
import { runAgentStreamEffects } from "./runAgentStreamEffects";
import type { PendingAssistantMessage } from "./types";

interface UseAgentComposerStreamStateArgs {
  applyThreadTitleToCaches: (threadId: string, title: string | null, updatedAt?: string) => void;
  pendingAssistantMessage: PendingAssistantMessage | null;
  selectedThreadId: string;
  threadDetail: AgentThreadDetail | undefined;
}

function toolCallHasRenderablePayload(toolCall: AgentToolCall | undefined): boolean {
  if (!toolCall?.has_full_payload) {
    return false;
  }
  return (
    toolCall.arguments_json != null ||
    toolCall.result_content_json != null ||
    Boolean(toolCall.output_text?.trim())
  );
}

export function useAgentComposerStreamState({
  applyThreadTitleToCaches,
  pendingAssistantMessage,
  selectedThreadId,
  threadDetail
}: UseAgentComposerStreamStateArgs) {
  const queryClient = useQueryClient();
  const sessionRevision = useSyncExternalStore(
    subscribeAgentStreamSession,
    getAgentStreamSessionRevision,
    getAgentStreamSessionRevision
  );
  const session = getAgentStreamSessionSnapshot();
  const [hydratingToolCallIds, setHydratingToolCallIds] = useState<Set<string>>(new Set());
  const hydratingToolCallIdsRef = useRef<Set<string>>(new Set());
  const threadRunsRef = useRef<AgentRun[]>([]);
  const optimisticToolCallsRef = useRef<Record<string, AgentToolCall[]>>(session.optimisticToolCallsByRunId);

  useEffect(() => {
    threadRunsRef.current = threadDetail?.runs ?? [];
  }, [threadDetail?.runs]);

  useEffect(() => {
    optimisticToolCallsRef.current = session.optimisticToolCallsByRunId;
  }, [session.optimisticToolCallsByRunId]);

  const threadRuns = threadDetail?.runs ?? [];
  const pendingAssistantRuns = useMemo(() => pendingRuns(threadDetail), [threadDetail]);
  const liveRunId = useMemo(
    () =>
      selectedThreadId
        ? resolveLiveRunIdForThread(selectedThreadId, threadRuns, getAgentStreamSessionSnapshot())
        : null,
    [selectedThreadId, threadRuns, sessionRevision]
  );

  useEffect(() => {
    if (!selectedThreadId || !liveRunId) {
      return;
    }
    const snapshot = getAgentStreamSessionSnapshot();
    if (snapshot.activeStreamRunIdsByThreadId[selectedThreadId] === liveRunId) {
      return;
    }
    setActiveStreamRunForThread(selectedThreadId, liveRunId);
  }, [liveRunId, selectedThreadId, sessionRevision]);

  const pendingRunAttachedToOptimisticMessage = useMemo(() => {
    if (!pendingAssistantMessage || pendingAssistantMessage.threadId !== selectedThreadId) {
      return null;
    }
    if (liveRunId) {
      return threadRuns.find((run) => run.id === liveRunId) ?? null;
    }
    return [...pendingAssistantRuns].reverse().find((run) => run.status === "running") ?? null;
  }, [liveRunId, pendingAssistantMessage, pendingAssistantRuns, selectedThreadId, threadRuns]);

  const shouldShowOptimisticAssistantBubble = Boolean(
    pendingAssistantMessage && pendingAssistantMessage.threadId === selectedThreadId
  );

  const hydrateToolCallDetails = useCallback(
    async (threadId: string, runId: string, toolCallId: string, force = false) => {
      const persistedRun = threadRunsRef.current.find((run) => run.id === runId);
      if (
        !force &&
        listOrEmpty(persistedRun?.tool_calls).some(
          (toolCall) => toolCall.id === toolCallId && toolCallHasRenderablePayload(toolCall)
        )
      ) {
        return;
      }
      const optimisticToolCalls = optimisticToolCallsRef.current[runId] ?? [];
      if (
        !force &&
        optimisticToolCalls.some((toolCall) => toolCall.id === toolCallId && toolCallHasRenderablePayload(toolCall))
      ) {
        return;
      }
      if (hydratingToolCallIdsRef.current.has(toolCallId)) {
        return;
      }

      hydratingToolCallIdsRef.current.add(toolCallId);
      setHydratingToolCallIds((current) => new Set(current).add(toolCallId));
      try {
        const toolCall = await getAgentToolCall(toolCallId);
        const existing = getAgentStreamSessionSnapshot().optimisticToolCallsByRunId[runId] ?? [];
        const nextToolCalls = mergeRunToolCalls(existing, [toolCall]);
        const unchanged =
          existing.length === nextToolCalls.length &&
          existing.every((item, index) => {
            const next = nextToolCalls[index];
            return (
              next &&
              item.id === next.id &&
              item.status === next.status &&
              toolCallHasRenderablePayload(item) === toolCallHasRenderablePayload(next)
            );
          });
        if (!unchanged) {
          setAgentStreamSessionOptimisticToolCalls(runId, nextToolCalls);
        }
        patchAgentThreadCachedToolCall(queryClient, threadId, runId, toolCall);
        if (toolCall.tool_name === "rename_thread") {
          const renamedTitle = extractRenameThreadTitle(toolCall);
          if (renamedTitle) {
            applyThreadTitleToCaches(threadId, renamedTitle);
          }
        }
      } catch (error) {
        console.warn("Failed to hydrate agent tool call details.", {
          threadId,
          runId,
          toolCallId,
          error
        });
      } finally {
        hydratingToolCallIdsRef.current.delete(toolCallId);
        setHydratingToolCallIds((current) => {
          if (!current.has(toolCallId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(toolCallId);
          return next;
        });
      }
    },
    [applyThreadTitleToCaches, queryClient]
  );

  const handleAgentStreamEvent = useCallback(
    (threadId: string, event: Parameters<typeof applyAgentStreamEventToStore>[1]) => {
      const { effects } = applyAgentStreamEventToStore(threadId, event);
      runAgentStreamEffects(queryClient, effects, hydrateToolCallDetails);
    },
    [hydrateToolCallDetails, queryClient]
  );

  const resetOptimisticRunState = useCallback((threadId?: string) => {
    if (!threadId) {
      resetAgentStreamSession();
      setHydratingToolCallIds(new Set());
      hydratingToolCallIdsRef.current.clear();
      return;
    }
    const runId = getAgentStreamSessionSnapshot().activeStreamRunIdsByThreadId[threadId];
    clearAgentStreamSessionThread(threadId);
    if (runId) {
      clearAgentStreamSessionRun(runId);
    }
  }, []);

  const handleHydrateToolCall = useCallback(
    (runId: string, toolCallId: string) => {
      if (selectedThreadId) {
        void hydrateToolCallDetails(selectedThreadId, runId, toolCallId);
      }
    },
    [hydrateToolCallDetails, selectedThreadId]
  );

  return {
    activeOptimisticSteps: liveRunId ? session.optimisticStepsByRunId[liveRunId] ?? [] : [],
    activeOptimisticToolCalls: liveRunId ? session.optimisticToolCallsByRunId[liveRunId] ?? [] : [],
    activeStreamReasoningText: liveRunId ? session.streamedReasoningTextByRunId[liveRunId] ?? "" : "",
    activeStreamRunId: liveRunId,
    activeStreamText: liveRunId ? session.streamedTextByRunId[liveRunId] ?? "" : "",
    getStreamingReasoningText: (runId: string) =>
      getAgentStreamSessionSnapshot().streamedReasoningTextByRunId[runId] ?? "",
    getStreamingText: (runId: string) => getAgentStreamSessionSnapshot().streamedTextByRunId[runId] ?? "",
    getReconnectSequenceIndex: (runId: string) => {
      const run = threadRunsRef.current.find((item) => item.id === runId);
      const snapshot = getAgentStreamSessionSnapshot();
      return run ? resolveReconnectSequenceIndex(run, snapshot) : snapshot.lastSequenceIndexByRunId[runId] ?? 0;
    },
    handleAgentStreamEvent,
    handleHydrateToolCall,
    hydratingToolCallIds,
    liveActivityLedgerByRunId: session.liveActivityLedgerByRunId,
    optimisticStepsByRunId: session.optimisticStepsByRunId,
    optimisticToolCallsByRunId: session.optimisticToolCallsByRunId,
    pendingRunAttachedToOptimisticMessage,
    resetOptimisticRunState,
    shouldShowOptimisticAssistantBubble,
    streamedReasoningTextByRunId: session.streamedReasoningTextByRunId,
    streamedTextByRunId: session.streamedTextByRunId
  };
}

export { findRunningRunForThread };
