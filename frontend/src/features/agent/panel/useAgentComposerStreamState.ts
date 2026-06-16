/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentComposerStreamState` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentComposerStreamState.ts`.
 * - Outputs: hooks and state helpers exported by `useAgentComposerStreamState`.
 * - Side effects: client-side state coordination; syncs with module session store for same-tab reuse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentToolCall } from "../../../lib/api";
import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import type {
  AgentRun,
  AgentRunStep,
  AgentStreamEvent,
  AgentThreadDetail,
  AgentToolCall,
  AgentToolCallStatus
} from "../../../lib/types";
import {
  appendLiveActivityLedgerItem,
  mergeRunSteps,
  mergeRunToolCalls,
  pendingRuns,
  type RunActivityItem
} from "../activity";
import { patchAgentThreadCacheFromStreamEvent } from "../threadDetailCache";
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
  threadDetail: AgentThreadDetail | undefined;
}

function cloneSessionRecord<T extends Record<string, unknown>>(record: T): T {
  return { ...record };
}

function mapHarnessToolStatus(status: string): AgentToolCallStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "ok":
      return "ok";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function trackSequenceIndex(runId: string, sequenceIndex: number | undefined): void {
  if (typeof sequenceIndex !== "number") {
    return;
  }
  agentStreamSession.lastSequenceIndexByRunId[runId] = Math.max(
    agentStreamSession.lastSequenceIndexByRunId[runId] ?? 0,
    sequenceIndex
  );
}

function buildOptimisticStepFromCommit(
  event: Extract<AgentStreamEvent, { type: "model_decision_committed" }>,
  reasoningText: string
): AgentRunStep {
  const startedAt = agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id];
  const reasoningDurationMs =
    startedAt && reasoningText.trim().length > 0 ? Math.max(1, Date.now() - startedAt) : null;
  return {
    id: event.assistant_message_id,
    run_id: event.run_id,
    step_index: event.step_index,
    status: "committed",
    reasoning_text: reasoningText.trim().length > 0 ? reasoningText : null,
    progress_note: null,
    reasoning_duration_ms: reasoningDurationMs,
    latency_ms: null,
    created_at: new Date().toISOString()
  };
}

function streamStepId(runId: string, stepIndex: number): string {
  return `stream-step-${runId}-${stepIndex}`;
}

function buildOptimisticToolCallFromStarted(
  event: Extract<AgentStreamEvent, { type: "tool_started" }>
): AgentToolCall {
  return {
    id: event.tool_call_id,
    run_id: event.run_id,
    step_id: streamStepId(event.run_id, event.step_index),
    call_index: 0,
    tool_request_id: event.tool_call_id,
    tool_name: event.tool_name,
    display_label: event.display_label ?? event.tool_name,
    display_detail: event.display_detail ?? null,
    arguments_json: null,
    result_content_json: null,
    output_text: null,
    has_full_payload: false,
    status: "running",
    error_code: null,
    started_at: new Date().toISOString(),
    completed_at: null
  };
}

export function useAgentComposerStreamState({
  applyThreadTitleToCaches,
  pendingAssistantMessage,
  selectedThreadId,
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
  const [optimisticStepsByRunId, setOptimisticStepsByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.optimisticStepsByRunId)
  );
  const [optimisticToolCallsByRunId, setOptimisticToolCallsByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.optimisticToolCallsByRunId)
  );
  const [liveActivityLedgerByRunId, setLiveActivityLedgerByRunId] = useState(() =>
    cloneSessionRecord(agentStreamSession.liveActivityLedgerByRunId)
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
  const pendingAssistantRuns = useMemo(() => pendingRuns(threadDetail), [threadDetail]);
  const liveRunId = useMemo(
    () =>
      selectedThreadId
        ? resolveLiveRunIdForThread(selectedThreadId, threadRuns, agentStreamSession)
        : null,
    [
      selectedThreadId,
      threadRuns,
      streamedReasoningTextByRunId,
      streamedTextByRunId,
      optimisticStepsByRunId,
      optimisticToolCallsByRunId,
      liveActivityLedgerByRunId,
      activeStreamRunIdsByThreadId
    ]
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
  const activeOptimisticSteps = useMemo(
    () => (liveRunId ? optimisticStepsByRunId[liveRunId] ?? [] : []),
    [liveRunId, optimisticStepsByRunId]
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
      setOptimisticStepsByRunId((current) => {
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
      setLiveActivityLedgerByRunId((current) => {
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
        setOptimisticStepsByRunId({});
        setOptimisticToolCallsByRunId({});
        setLiveActivityLedgerByRunId({});
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

  const appendLiveLedgerItem = useCallback((runId: string, item: RunActivityItem) => {
    const existingSessionLedger = agentStreamSession.liveActivityLedgerByRunId[runId] ?? [];
    const nextSessionLedger = appendLiveActivityLedgerItem(existingSessionLedger, item);
    agentStreamSession.liveActivityLedgerByRunId[runId] = nextSessionLedger;
    flushSync(() => {
      setLiveActivityLedgerByRunId((current) => {
        return {
          ...current,
          [runId]: nextSessionLedger
        };
      });
    });
  }, []);

  const handleAgentStreamEvent = useCallback(
    (threadId: string, event: AgentStreamEvent) => {
      trackSequenceIndex(event.run_id, "sequence_index" in event ? event.sequence_index : undefined);
      syncActiveStreamRunIds((current) =>
        current[threadId] === event.run_id ? current : { ...current, [threadId]: event.run_id }
      );

      if (event.type === "reasoning_delta") {
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
        setStreamedTextByRunId((current) => {
          const nextText = `${current[event.run_id] ?? ""}${event.delta}`;
          agentStreamSession.streamedTextByRunId[event.run_id] = nextText;
          return {
            ...current,
            [event.run_id]: nextText
          };
        });
        bump();
        return;
      }

      if (event.type === "model_delta") {
        if (event.delta_type === "reasoning") {
          if (!agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id]) {
            agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id] = Date.now();
          }
          setStreamedReasoningTextByRunId((current) => {
            const nextText = `${current[event.run_id] ?? ""}${event.text}`;
            agentStreamSession.streamedReasoningTextByRunId[event.run_id] = nextText;
            return {
              ...current,
              [event.run_id]: nextText
            };
          });
        } else {
          setStreamedTextByRunId((current) => {
            const nextText = `${current[event.run_id] ?? ""}${event.text}`;
            agentStreamSession.streamedTextByRunId[event.run_id] = nextText;
            return {
              ...current,
              [event.run_id]: nextText
            };
          });
        }
        bump();
        return;
      }

      if (event.type === "model_decision_committed") {
        const streamedReasoning = agentStreamSession.streamedReasoningTextByRunId[event.run_id] ?? "";
        const committedReasoning = (event.reasoning_text ?? "").trim();
        const reasoningText =
          streamedReasoning.trim().length > 0 ? streamedReasoning : committedReasoning;
        const optimisticStep = buildOptimisticStepFromCommit(event, reasoningText);
        if (reasoningText.trim().length > 0) {
          appendLiveLedgerItem(event.run_id, {
            type: "reasoning_step",
            key: `${event.assistant_message_id}:reasoning`,
            runId: event.run_id,
            stepId: event.assistant_message_id,
            message: reasoningText.trim(),
            durationMs: optimisticStep.reasoning_duration_ms,
            createdAt: optimisticStep.created_at
          });
        }
        const streamedAssistantText = agentStreamSession.streamedTextByRunId[event.run_id] ?? "";
        const shouldAnchorAssistantText = event.has_tool_requests && streamedAssistantText.trim().length > 0;
        if (shouldAnchorAssistantText) {
          appendLiveLedgerItem(event.run_id, {
            type: "assistant_message",
            key: `${event.assistant_message_id}:assistant`,
            runId: event.run_id,
            stepId: event.assistant_message_id,
            message: streamedAssistantText.trim(),
            createdAt: optimisticStep.created_at
          });
        }
        patchAgentThreadCacheFromStreamEvent(queryClient, threadId, event, { reasoningText });
        setOptimisticStepsByRunId((current) => {
          const existing = current[event.run_id] ?? [];
          const nextSteps = mergeRunSteps(existing, [optimisticStep]);
          agentStreamSession.optimisticStepsByRunId[event.run_id] = nextSteps;
          return {
            ...current,
            [event.run_id]: nextSteps
          };
        });
        delete agentStreamSession.reasoningSegmentStartedAtByRunId[event.run_id];
        setStreamedReasoningTextByRunId((current) => {
          if (!current[event.run_id]) {
            return current;
          }
          const next = { ...current };
          delete next[event.run_id];
          agentStreamSession.streamedReasoningTextByRunId[event.run_id] = "";
          return next;
        });
        if (event.has_tool_requests) {
          setStreamedTextByRunId((current) => {
            if (!current[event.run_id]) {
              return current;
            }
            const next = { ...current };
            delete next[event.run_id];
            delete agentStreamSession.streamedTextByRunId[event.run_id];
            return next;
          });
        }
        bump();
        return;
      }

      if (event.type === "tool_started") {
        const optimisticToolCall = buildOptimisticToolCallFromStarted(event);
        appendLiveLedgerItem(event.run_id, {
          type: "tool_call",
          key: event.tool_call_id,
          runId: event.run_id,
          toolCallId: event.tool_call_id,
          toolCall: optimisticToolCall,
          createdAt: optimisticToolCall.started_at ?? optimisticToolCall.completed_at ?? new Date().toISOString()
        });
        patchAgentThreadCacheFromStreamEvent(queryClient, threadId, event);
        setOptimisticToolCallsByRunId((current) => {
          const nextRunToolCalls = mergeRunToolCalls(current[event.run_id] ?? [], [optimisticToolCall]);
          agentStreamSession.optimisticToolCallsByRunId[event.run_id] = nextRunToolCalls;
          return {
            ...current,
            [event.run_id]: nextRunToolCalls
          };
        });
        if (event.tool_name === "rename_thread") {
          void hydrateToolCallDetails(threadId, event.run_id, event.tool_call_id);
        }
        bump();
        return;
      }

      if (event.type === "tool_finished") {
        const status = mapHarnessToolStatus(event.status);
        const completedAt = new Date().toISOString();
        const existingToolCalls = optimisticToolCallsRef.current[event.run_id] ?? [];
        const matched = existingToolCalls.find((toolCall) => toolCall.id === event.tool_call_id);
        const patch: AgentToolCall = matched
          ? {
              ...matched,
              display_label: event.display_label ?? matched.display_label,
              display_detail: event.display_detail ?? matched.display_detail,
              status,
              completed_at: completedAt
            }
          : {
              ...buildOptimisticToolCallFromStarted({
                type: "tool_started",
                run_id: event.run_id,
                step_index: event.step_index,
                tool_call_id: event.tool_call_id,
                tool_name: event.tool_name,
                display_label: event.display_label,
                display_detail: event.display_detail
              }),
              status,
              completed_at: completedAt
            };
        appendLiveLedgerItem(event.run_id, {
          type: "tool_call",
          key: event.tool_call_id,
          runId: event.run_id,
          toolCallId: event.tool_call_id,
          toolCall: patch,
          createdAt: patch.started_at ?? patch.completed_at ?? completedAt
        });
        patchAgentThreadCacheFromStreamEvent(queryClient, threadId, event);
        setOptimisticToolCallsByRunId((current) => {
          const existing = current[event.run_id] ?? [];
          const nextRunToolCalls = mergeRunToolCalls(existing, [patch]);
          agentStreamSession.optimisticToolCallsByRunId[event.run_id] = nextRunToolCalls;
          return {
            ...current,
            [event.run_id]: nextRunToolCalls
          };
        });
        if (event.tool_name === "rename_thread") {
          void hydrateToolCallDetails(threadId, event.run_id, event.tool_call_id, true);
        }
        if (status === "error" && event.tool_name === "rename_thread") {
          invalidateAgentThreadData(queryClient, threadId);
        }
        bump();
        return;
      }

      if (event.type === "run_finished") {
        patchAgentThreadCacheFromStreamEvent(queryClient, threadId, event);
        setStreamedTextByRunId((current) => {
          const streamed = current[event.run_id] ?? "";
          const finalContent = (event.final_assistant_content ?? "").trim();
          if (!streamed && !finalContent) {
            return current;
          }
          if (streamed && finalContent && streamed.trim() === finalContent) {
            const next = { ...current };
            delete next[event.run_id];
            delete agentStreamSession.streamedTextByRunId[event.run_id];
            return next;
          }
          if (finalContent) {
            const next = { ...current };
            delete next[event.run_id];
            delete agentStreamSession.streamedTextByRunId[event.run_id];
            return next;
          }
          return current;
        });
        bump();
      }
    },
    [appendLiveLedgerItem, bump, hydrateToolCallDetails, queryClient, syncActiveStreamRunIds]
  );

  const getReconnectSequenceIndex = useCallback((runId: string) => {
    const run = threadRunsRef.current.find((item) => item.id === runId);
    if (!run) {
      return agentStreamSession.lastSequenceIndexByRunId[runId] ?? 0;
    }
    return resolveReconnectSequenceIndex(run, agentStreamSession);
  }, []);

  return {
    activeOptimisticSteps,
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
    liveActivityLedgerByRunId,
    optimisticStepsByRunId,
    optimisticToolCallsByRunId,
    pendingRunAttachedToOptimisticMessage,
    resetOptimisticRunState,
    shouldShowOptimisticAssistantBubble,
    streamedReasoningTextByRunId,
    streamedTextByRunId
  };
}

export { findRunningRunForThread };
