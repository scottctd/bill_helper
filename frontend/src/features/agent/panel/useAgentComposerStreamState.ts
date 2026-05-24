/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentComposerStreamState` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentComposerStreamState.ts`.
 * - Outputs: hooks and state helpers exported by `useAgentComposerStreamState`.
 * - Side effects: client-side state coordination; syncs with module session store for same-tab reuse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentToolCall } from "../../../lib/api";
import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import type { AgentRun, AgentRunEvent, AgentStreamEvent, AgentThreadDetail, AgentToolCall } from "../../../lib/types";
import { mergeRunToolCalls, runsWithoutAssistantMessage } from "../activity";
import { patchAgentThreadCachedRunUsage } from "../threadDetailCache";
import {
  agentStreamSession,
  clearAgentStreamSessionRun,
  clearAgentStreamSessionThread,
  resetAgentStreamSession
} from "./agentStreamSession";
import { extractRenameThreadTitle } from "./helpers";
import { findRunningRunForThread, resolveLiveRunIdForThread, resolveReconnectSequenceIndex } from "./liveRun";
import type { PendingAssistantMessage } from "./types";

interface UseAgentComposerStreamStateArgs {
  applyThreadTitleToCaches: (threadId: string, title: string | null, updatedAt?: string) => void;
  pendingAssistantMessage: PendingAssistantMessage | null;
  selectedThreadId: string;
  setActionError: (message: string | null) => void;
  threadDetail: AgentThreadDetail | undefined;
}

function cloneSessionRecord<T extends Record<string, unknown>>(record: T): T {
  return { ...record };
}

export function useAgentComposerStreamState({
  applyThreadTitleToCaches,
  pendingAssistantMessage,
  selectedThreadId,
  setActionError,
  threadDetail
}: UseAgentComposerStreamStateArgs) {
  const queryClient = useQueryClient();
  const [, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((value) => value + 1), []);
  const [activeStreamRunIdsByThreadId, setActiveStreamRunIdsByThreadId] = useState(() =>
    cloneSessionRecord(agentStreamSession.activeStreamRunIdsByThreadId)
  );
  const [streamedReasoningTextByRunId, setStreamedReasoningTextByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.streamedReasoningTextByRunId)
  );
  const [streamedTextByRunId, setStreamedTextByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.streamedTextByRunId)
  );
  const [optimisticRunEventsByRunId, setOptimisticRunEventsByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.optimisticRunEventsByRunId)
  );
  const [optimisticToolCallsByRunId, setOptimisticToolCallsByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.optimisticToolCallsByRunId)
  );
  const [hydratingToolCallIds, setHydratingToolCallIds] = useState<Set<string>>(new Set());
  const activeStreamRunIdsRef = useRef<Record<string, string>>(activeStreamRunIdsByThreadId);
  const threadRunsRef = useRef<AgentRun[]>([]);
  const optimisticToolCallsRef = useRef<Record<string, AgentToolCall[]>>(optimisticToolCallsByRunId);
  const hydratingToolCallIdsRef = useRef<Set<string>>(new Set());

  const syncActiveStreamRunIds = useCallback(
    (updater: (current: Record<string, string>) => Record<string, string>) => {
      setActiveStreamRunIdsByThreadId((current) => {
        const next = updater(current);
        agentStreamSession.activeStreamRunIdsByThreadId = next;
        activeStreamRunIdsRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    activeStreamRunIdsRef.current = activeStreamRunIdsByThreadId;
  }, [activeStreamRunIdsByThreadId]);

  useEffect(() => {
    threadRunsRef.current = threadDetail?.runs ?? [];
  }, [threadDetail?.runs]);

  useEffect(() => {
    optimisticToolCallsRef.current = optimisticToolCallsByRunId;
  }, [optimisticToolCallsByRunId]);

  const threadRuns = threadDetail?.runs ?? [];
  const pendingAssistantRuns = useMemo(() => runsWithoutAssistantMessage(threadDetail), [threadDetail]);
  const liveRunId = useMemo(
    () =>
      selectedThreadId
        ? resolveLiveRunIdForThread(selectedThreadId, threadRuns, agentStreamSession)
        : null,
    [selectedThreadId, threadRuns, streamedReasoningTextByRunId, streamedTextByRunId, optimisticRunEventsByRunId, activeStreamRunIdsByThreadId]
  );
  const activeStreamRunId = liveRunId;

  useEffect(() => {
    if (!selectedThreadId || !liveRunId) {
      return;
    }
    if (activeStreamRunIdsByThreadId[selectedThreadId] === liveRunId) {
      return;
    }
    syncActiveStreamRunIds((current) => ({ ...current, [selectedThreadId]: liveRunId }));
  }, [activeStreamRunIdsByThreadId, liveRunId, selectedThreadId, syncActiveStreamRunIds]);

  const pendingRunAttachedToOptimisticMessage = useMemo(() => {
    if (!pendingAssistantMessage || pendingAssistantMessage.threadId !== selectedThreadId) {
      return null;
    }
    if (liveRunId) {
      return threadRuns.find((run) => run.id === liveRunId) ?? null;
    }
    const runningRun = [...pendingAssistantRuns].reverse().find((run) => run.status === "running");
    return runningRun ?? null;
  }, [liveRunId, pendingAssistantMessage, pendingAssistantRuns, selectedThreadId, threadRuns]);
  const shouldShowOptimisticAssistantBubble = Boolean(
    pendingAssistantMessage && pendingAssistantMessage.threadId === selectedThreadId
  );
  const activeStreamText = useMemo(
    () => (liveRunId ? streamedTextByRunId[liveRunId] ?? "" : ""),
    [liveRunId, streamedTextByRunId]
  );
  const activeStreamReasoningText = useMemo(
    () => (liveRunId ? streamedReasoningTextByRunId[liveRunId] ?? "" : ""),
    [liveRunId, streamedReasoningTextByRunId]
  );
  const activeOptimisticEvents = useMemo(
    () => (liveRunId ? optimisticRunEventsByRunId[liveRunId] ?? [] : []),
    [liveRunId, optimisticRunEventsByRunId]
  );
  const activeOptimisticToolCalls = useMemo(
    () => (liveRunId ? optimisticToolCallsByRunId[liveRunId] ?? [] : []),
    [liveRunId, optimisticToolCallsByRunId]
  );

  const getStreamingReasoningText = useCallback(
    (runId: string) => streamedReasoningTextByRunId[runId] ?? "",
    [streamedReasoningTextByRunId]
  );

  const getStreamingText = useCallback(
    (runId: string) => streamedTextByRunId[runId] ?? "",
    [streamedTextByRunId]
  );

  const clearRunState = useCallback(
    (runId: string) => {
      clearAgentStreamSessionRun(runId);
      setStreamedReasoningTextByRunId((current) => {
        if (!(runId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[runId];
        return next;
      });
      setStreamedTextByRunId((current) => {
        if (!(runId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[runId];
        return next;
      });
      setOptimisticRunEventsByRunId((current) => {
        if (!(runId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[runId];
        return next;
      });
      setOptimisticToolCallsByRunId((current) => {
        if (!(runId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[runId];
        return next;
      });
      bump();
    },
    [bump]
  );

  const resetOptimisticRunState = useCallback(
    (threadId?: string) => {
      if (!threadId) {
        resetAgentStreamSession();
        setActiveStreamRunIdsByThreadId({});
        activeStreamRunIdsRef.current = {};
        setStreamedReasoningTextByRunId({});
        setStreamedTextByRunId({});
        setOptimisticRunEventsByRunId({});
        setOptimisticToolCallsByRunId({});
        setHydratingToolCallIds(new Set());
        hydratingToolCallIdsRef.current.clear();
        bump();
        return;
      }

      const runId = activeStreamRunIdsRef.current[threadId];
      clearAgentStreamSessionThread(threadId);
      syncActiveStreamRunIds((current) => {
        if (!(threadId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      if (runId) {
        clearRunState(runId);
      }
    },
    [bump, clearRunState, syncActiveStreamRunIds]
  );

  const hydrateToolCallDetails = useCallback(
    async (threadId: string, runId: string, toolCallId: string, force = false) => {
      const persistedRun = threadRunsRef.current.find((run) => run.id === runId);
      if (!force && persistedRun?.tool_calls.some((toolCall) => toolCall.id === toolCallId && toolCall.has_full_payload)) {
        return;
      }

      const optimisticToolCalls = optimisticToolCallsRef.current[runId] ?? [];
      if (!force && optimisticToolCalls.some((toolCall) => toolCall.id === toolCallId && toolCall.has_full_payload)) {
        return;
      }

      if (hydratingToolCallIdsRef.current.has(toolCallId)) {
        return;
      }

      hydratingToolCallIdsRef.current.add(toolCallId);
      setHydratingToolCallIds((current) => {
        const next = new Set(current);
        next.add(toolCallId);
        return next;
      });
      try {
        const toolCall = await getAgentToolCall(toolCallId);
        const renamedTitle = toolCall.tool_name === "rename_thread" ? extractRenameThreadTitle(toolCall) : null;
        setOptimisticToolCallsByRunId((current) => {
          const existing = current[runId] ?? [];
          const nextToolCalls = mergeRunToolCalls(existing, [toolCall]);
          agentStreamSession.optimisticToolCallsByRunId[runId] = nextToolCalls;
          if (
            existing.length === nextToolCalls.length &&
            existing.every((existingToolCall, index) => {
              const nextToolCall = nextToolCalls[index];
              return (
                nextToolCall &&
                existingToolCall.id === nextToolCall.id &&
                existingToolCall.status === nextToolCall.status &&
                existingToolCall.has_full_payload === nextToolCall.has_full_payload
              );
            })
          ) {
            return current;
          }
          return {
            ...current,
            [runId]: nextToolCalls
          };
        });
        if (renamedTitle) {
          applyThreadTitleToCaches(threadId, renamedTitle);
        }
      } catch {
        // Ignore transient hydration errors; later expansions or final snapshots will retry/reconcile.
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
    [applyThreadTitleToCaches]
  );

  const handleHydrateToolCall = useCallback(
    (runId: string, toolCallId: string) => {
      if (!selectedThreadId) {
        return;
      }
      void hydrateToolCallDetails(selectedThreadId, runId, toolCallId);
    },
    [hydrateToolCallDetails, selectedThreadId]
  );

  const handleAgentStreamEvent = useCallback(
    (threadId: string, event: AgentStreamEvent) => {
      if (event.type === "run_event") {
        const sequenceIndex = event.event.sequence_index;
        if (typeof sequenceIndex === "number") {
          agentStreamSession.lastSequenceIndexByRunId[event.run_id] = Math.max(
            agentStreamSession.lastSequenceIndexByRunId[event.run_id] ?? 0,
            sequenceIndex
          );
        }
        syncActiveStreamRunIds((current) =>
          current[threadId] === event.run_id ? current : { ...current, [threadId]: event.run_id }
        );
        const toolCall = event.tool_call;
        if (toolCall) {
          setOptimisticToolCallsByRunId((current) => {
            const nextRunToolCalls = mergeRunToolCalls(current[event.run_id] ?? [], [toolCall]);
            agentStreamSession.optimisticToolCallsByRunId[event.run_id] = nextRunToolCalls;
            return {
              ...current,
              [event.run_id]: nextRunToolCalls
            };
          });
          if (toolCall.tool_name === "rename_thread") {
            if (event.event.event_type === "tool_call_started") {
              void hydrateToolCallDetails(threadId, event.run_id, toolCall.id);
            }
            if (event.event.event_type === "tool_call_completed") {
              void hydrateToolCallDetails(threadId, event.run_id, toolCall.id, true);
            }
            if (event.event.event_type === "tool_call_failed") {
              invalidateAgentThreadData(queryClient, threadId);
            }
          }
        }
        setOptimisticRunEventsByRunId((current) => {
          const existing = current[event.run_id] ?? [];
          if (existing.some((item) => item.id === event.event.id)) {
            return current;
          }
          let nextEvent = event.event;
          if (
            nextEvent.event_type === "reasoning_update" &&
            nextEvent.source === "model_reasoning" &&
            (nextEvent.reasoning_duration_ms == null || nextEvent.reasoning_duration_ms <= 0)
          ) {
            const startedAt = agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id];
            if (startedAt) {
              nextEvent = {
                ...nextEvent,
                reasoning_duration_ms: Math.max(1, Date.now() - startedAt)
              };
            }
          }
          if (nextEvent.event_type === "reasoning_update" && nextEvent.source === "model_reasoning") {
            delete agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id];
          }
          const nextEvents = [...existing, nextEvent];
          agentStreamSession.optimisticRunEventsByRunId[event.run_id] = nextEvents;
          return {
            ...current,
            [event.run_id]: nextEvents
          };
        });
        if (event.event.event_type === "reasoning_update" && event.event.source === "assistant_content") {
          setStreamedTextByRunId((current) => {
            if (!current[event.run_id]) {
              return current;
            }
            const next = { ...current, [event.run_id]: "" };
            agentStreamSession.streamedTextByRunId[event.run_id] = "";
            return next;
          });
        }
        if (event.event.event_type === "reasoning_update" && event.event.source === "model_reasoning") {
          setStreamedReasoningTextByRunId((current) => {
            if (!current[event.run_id]) {
              return current;
            }
            const next = { ...current, [event.run_id]: "" };
            agentStreamSession.streamedReasoningTextByRunId[event.run_id] = "";
            return next;
          });
        }
        if (event.event.event_type === "run_failed" && event.event.message) {
          setActionError(event.event.message);
        }
        if (event.run_usage) {
          patchAgentThreadCachedRunUsage(queryClient, threadId, event.run_id, event.run_usage);
        }
        bump();
        return;
      }
      if (event.type === "reasoning_delta") {
        syncActiveStreamRunIds((current) =>
          current[threadId] === event.run_id ? current : { ...current, [threadId]: event.run_id }
        );
        if (!agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id]) {
          agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id] = Date.now();
        }
        setStreamedReasoningTextByRunId((current) => {
          const nextText = `${current[event.run_id] ?? ""}${event.delta}`;
          agentStreamSession.streamedReasoningTextByRunId[event.run_id] = nextText;
          return {
            ...current,
            [event.run_id]: nextText
          };
        });
        bump();
        return;
      }
      if (event.type === "text_delta") {
        syncActiveStreamRunIds((current) =>
          current[threadId] === event.run_id ? current : { ...current, [threadId]: event.run_id }
        );
        setStreamedTextByRunId((current) => {
          const nextText = `${current[event.run_id] ?? ""}${event.delta}`;
          agentStreamSession.streamedTextByRunId[event.run_id] = nextText;
          return {
            ...current,
            [event.run_id]: nextText
          };
        });
        bump();
      }
    },
    [bump, hydrateToolCallDetails, queryClient, setActionError, syncActiveStreamRunIds]
  );

  const getReconnectSequenceIndex = useCallback((runId: string) => {
    const run = threadRunsRef.current.find((item) => item.id === runId);
    if (!run) {
      return agentStreamSession.lastSequenceIndexByRunId[runId] ?? 0;
    }
    return resolveReconnectSequenceIndex(run, agentStreamSession);
  }, []);

  return {
    activeOptimisticEvents,
    activeOptimisticToolCalls,
    activeStreamReasoningText,
    activeStreamRunId,
    activeStreamText,
    getStreamingReasoningText,
    getStreamingText,
    getReconnectSequenceIndex,
    handleAgentStreamEvent,
    handleHydrateToolCall,
    hydratingToolCallIds,
    optimisticRunEventsByRunId,
    optimisticToolCallsByRunId,
    pendingRunAttachedToOptimisticMessage,
    resetOptimisticRunState,
    shouldShowOptimisticAssistantBubble,
    streamedReasoningTextByRunId,
    streamedTextByRunId
  };
}

export { findRunningRunForThread };
