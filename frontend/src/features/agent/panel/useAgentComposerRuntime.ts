/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentComposerRuntime` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentComposerRuntime.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `useAgentComposerRuntime`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentApprovalPolicy,
  AgentThreadDetail,
  RuntimeSettings
} from "../../../lib/types";
import { sortRunsByCreatedAt } from "../activity";
import {
  resolveComposerModelName
} from "./helpers";
import { useAgentComposerActions } from "./useAgentComposerActions";
import { useAgentComposerStreamState } from "./useAgentComposerStreamState";
import { useAgentDraftAttachments } from "./useAgentDraftAttachments";
import { useAgentStreamReconnect } from "./useAgentStreamReconnect";
import { useStickToBottom } from "./useStickToBottom";
import {
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  type PendingAssistantMessage,
  type PendingUserMessage
} from "./types";

interface UseAgentComposerRuntimeArgs {
  actionError: string | null;
  addOptimisticRunningThreadId: (threadId: string) => void;
  applyThreadTitleToCaches: (threadId: string, title: string | null, updatedAt?: string) => void;
  availableComposerModels: string[];
  clearOptimisticThreadTitle: (threadId: string) => void;
  ensureThreadId: () => Promise<string>;
  interruptRun: (payload: { runId: string; threadId: string }) => Promise<void>;
  isInterruptPending: boolean;
  isMutating: boolean;
  removeOptimisticRunningThreadId: (threadId: string) => void;
  runtimeSettings: RuntimeSettings | undefined;
  selectedThreadId: string;
  setActionError: (message: string | null) => void;
  setThreadStreamHealthy: (threadId: string, isHealthy: boolean) => void;
  threadDetail: AgentThreadDetail | undefined;
}

export function useAgentComposerRuntime({
  actionError,
  addOptimisticRunningThreadId,
  applyThreadTitleToCaches,
  availableComposerModels,
  clearOptimisticThreadTitle,
  ensureThreadId,
  interruptRun,
  isInterruptPending,
  isMutating,
  removeOptimisticRunningThreadId,
  runtimeSettings,
  selectedThreadId,
  setActionError,
  setThreadStreamHealthy,
  threadDetail
}: UseAgentComposerRuntimeArgs) {
  const [draftMessage, setDraftMessage] = useState("");
  const [pendingUserMessagesByThreadId, setPendingUserMessagesByThreadId] = useState<Record<string, PendingUserMessage>>({});
  const [pendingAssistantMessagesByThreadId, setPendingAssistantMessagesByThreadId] = useState<
    Record<string, PendingAssistantMessage>
  >({});
  const {
    containerRef: timelineScrollRef,
    detachFromBottom,
    isAtBottom,
    scrollToBottom,
    snapToBottom
  } = useStickToBottom<HTMLDivElement>();
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerModelOverride, setComposerModelOverride] = useState<string | null>(null);
  const [approvalPolicy, setApprovalPolicy] = useState<AgentApprovalPolicy>("default");
  const lastSnappedThreadRef = useRef("");
  const pendingUserMessagesRef = useRef<Record<string, PendingUserMessage>>({});
  const attachmentState = useAgentDraftAttachments({ setActionError });
  const {
    draftAttachments,
    setDraftAttachments,
    clearAllDraftAttachments,
    isComposerDragActive,
    fileInputRef,
    resolveDraftAttachmentsForSend,
    handlers: {
      handleDraftFileSelection,
      handleComposerPaste,
      handleComposerDragEnter,
      handleComposerDragOver,
      handleComposerDragLeave,
      handleComposerDrop,
      removeDraftAttachment
    }
  } = attachmentState;

  const resolvedComposerModel = useMemo(
    () => resolveComposerModelName(availableComposerModels, threadDetail, runtimeSettings),
    [availableComposerModels, runtimeSettings, threadDetail]
  );
  const selectedComposerModel =
    composerModelOverride && availableComposerModels.includes(composerModelOverride) ? composerModelOverride : resolvedComposerModel;
  const hasActiveRun = useMemo(() => (threadDetail?.runs ?? []).some((run) => run.status === "running"), [threadDetail?.runs]);
  const activeRunId = useMemo(() => {
    const runs = sortRunsByCreatedAt(threadDetail?.runs ?? []);
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (runs[index].status === "running") {
        return runs[index].id;
      }
    }
    return null;
  }, [threadDetail?.runs]);
  const pendingUserMessage = selectedThreadId ? (pendingUserMessagesByThreadId[selectedThreadId] ?? null) : null;
  const pendingAssistantMessage = selectedThreadId ? (pendingAssistantMessagesByThreadId[selectedThreadId] ?? null) : null;

  function setPendingUserMessage(threadId: string, message: PendingUserMessage | null) {
    setPendingUserMessagesByThreadId((current) => {
      const existing = current[threadId];
      if (!message) {
        if (!existing) {
          return current;
        }
        existing.attachments.forEach((attachment) => {
          URL.revokeObjectURL(attachment.url);
        });
        const next = { ...current };
        delete next[threadId];
        return next;
      }
      if (existing && existing.id !== message.id) {
        existing.attachments.forEach((attachment) => {
          URL.revokeObjectURL(attachment.url);
        });
      }
      return {
        ...current,
        [threadId]: message
      };
    });
  }

  function setPendingAssistantMessage(threadId: string, message: PendingAssistantMessage | null) {
    setPendingAssistantMessagesByThreadId((current) => {
      if (!message) {
        if (!(threadId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadId];
        return next;
      }
      return {
        ...current,
        [threadId]: message
      };
    });
  }

  useEffect(() => {
    pendingUserMessagesRef.current = pendingUserMessagesByThreadId;
  }, [pendingUserMessagesByThreadId]);

  const streamState = useAgentComposerStreamState({
    applyThreadTitleToCaches,
    pendingAssistantMessage,
    selectedThreadId,
    threadDetail
  });
  const {
    activeOptimisticSteps,
    activeOptimisticToolCalls,
    activeStreamReasoningText,
    activeStreamRunId,
    activeStreamText,
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
  } = streamState;
  useAgentStreamReconnect({
    clearOptimisticThreadTitle,
    getReconnectSequenceIndex,
    handleAgentStreamEvent,
    removeOptimisticRunningThreadId,
    resetOptimisticRunState,
    selectedThreadId,
    setThreadStreamHealthy,
    threadDetail
  });
  const actions = useAgentComposerActions({
    composerIO: {
      approvalPolicy,
      draftAttachments,
      draftMessage,
      ensureThreadId,
      handleAgentStreamEvent,
      resolveDraftAttachmentsForSend,
      selectedComposerModel,
      setActionError,
      setDraftAttachments,
      setDraftMessage,
      setPendingAssistantMessage,
      setPendingUserMessage,
      snapToBottom
    },
    threadCacheOps: {
      addOptimisticRunningThreadId,
      clearOptimisticThreadTitle,
      removeOptimisticRunningThreadId,
      setThreadStreamHealthy
    },
    runControl: {
      activeRunId,
      activeStreamRunId,
      interruptRun,
      resetOptimisticRunState,
      selectedThreadId,
      threadDetail
    }
  });
  const isSendingMessage = selectedThreadId ? actions.sendingThreadIds.includes(selectedThreadId) : false;
  const isRunInFlight = isSendingMessage || hasActiveRun;

  function autoSizeComposerTextarea(target?: HTMLTextAreaElement | null) {
    const textarea = target ?? composerTextareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT_PX);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  useEffect(() => {
    setComposerModelOverride(null);
  }, [selectedThreadId]);

  useEffect(() => {
    if (composerModelOverride && !availableComposerModels.includes(composerModelOverride)) {
      setComposerModelOverride(null);
    }
  }, [availableComposerModels, composerModelOverride]);

  useEffect(() => {
    if (!selectedThreadId || !threadDetail?.turns || lastSnappedThreadRef.current === selectedThreadId) {
      return;
    }
    lastSnappedThreadRef.current = selectedThreadId;
    requestAnimationFrame(() => snapToBottom());
  }, [selectedThreadId, snapToBottom, threadDetail?.turns]);

  useEffect(() => {
    autoSizeComposerTextarea();
  }, [draftMessage]);

  useEffect(() => {
    return () => {
      Object.values(pendingUserMessagesRef.current).forEach((message) => {
        message.attachments.forEach((attachment) => {
          URL.revokeObjectURL(attachment.url);
        });
      });
    };
  }, []);

  useEffect(() => {
    if (!pendingUserMessage || pendingUserMessage.threadId !== selectedThreadId) {
      return;
    }
    const latestTurn = [...(threadDetail?.turns ?? [])].sort((left, right) => right.turn_index - left.turn_index)[0];
    if (!latestTurn || latestTurn.run_id === pendingUserMessage.baselineLastTurnRunId) {
      return;
    }
    setPendingUserMessage(selectedThreadId, null);
  }, [pendingUserMessage, selectedThreadId, threadDetail?.turns]);

  useEffect(() => {
    if (!pendingAssistantMessage || pendingAssistantMessage.threadId !== selectedThreadId) {
      return;
    }
    const latestTurn = [...(threadDetail?.turns ?? [])].sort((left, right) => right.turn_index - left.turn_index)[0];
    if (!latestTurn || latestTurn.run_id === pendingAssistantMessage.baselineLastTurnRunId) {
      return;
    }
    // Turn is anchored in thread detail — render live activity on that card instead of a
    // second optimistic assistant bubble. Stream buffers stay in session state until SSE ends.
    setPendingAssistantMessage(selectedThreadId, null);
  }, [pendingAssistantMessage, selectedThreadId, threadDetail?.turns]);

  useEffect(() => {
    if (
      !pendingAssistantMessage ||
      pendingAssistantMessage.threadId !== selectedThreadId ||
      isRunInFlight ||
      pendingUserMessage
    ) {
      return;
    }
    setPendingAssistantMessage(selectedThreadId, null);
    setThreadStreamHealthy(selectedThreadId, false);
  }, [
    isRunInFlight,
    pendingAssistantMessage,
    pendingUserMessage,
    selectedThreadId,
    setThreadStreamHealthy
  ]);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (isMutating || isRunInFlight) {
      return;
    }
    event.currentTarget.form?.requestSubmit();
  }

  function handleDraftMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraftMessage(event.target.value);
    autoSizeComposerTextarea(event.target);
  }

  function handleComposerModelChange(value: string) {
    setComposerModelOverride(value);
  }

  function handleApprovalPolicyChange(value: string) {
    if (value === "default" || value === "yolo") {
      setApprovalPolicy(value);
    }
  }

  function resetComposerDraft() {
    setActionError(null);
    setDraftMessage("");
    clearAllDraftAttachments();
    setComposerModelOverride(null);
  }

  return {
    composer: {
      actionError,
      availableModels: availableComposerModels,
      modelDisplayNames: runtimeSettings?.agent_model_display_names ?? {},
      composerTextareaRef,
      draftAttachments,
      draftMessage,
      fileInputRef,
      approvalPolicy,
      isComposerDragActive,
      isInterruptPending,
      isModelPickerDisabled: isMutating,
      isMutating,
      isRunInFlight,
      isSendingMessage,
      onComposerKeyDown: handleComposerKeyDown,
      onComposerPaste: handleComposerPaste,
      onDragEnter: handleComposerDragEnter,
      onDragLeave: handleComposerDragLeave,
      onDragOver: handleComposerDragOver,
      onDrop: handleComposerDrop,
      onFileSelection: handleDraftFileSelection,
      onApprovalPolicyChange: handleApprovalPolicyChange,
      onMessageChange: handleDraftMessageChange,
      onModelChange: handleComposerModelChange,
      onRemoveAttachment: removeDraftAttachment,
      onStopRun() {
        void actions.handleStopRun();
      },
      onSubmit: actions.handleSubmitMessage,
      resetComposerDraft,
      selectedModel: selectedComposerModel
    },
    timeline: {
      activeOptimisticSteps,
      activeOptimisticToolCalls,
      activeStreamRunId,
      activeStreamReasoningText,
      activeStreamText,
      detachFromBottom,
      hydratingToolCallIds,
      isAtBottom,
      onHydrateToolCall: handleHydrateToolCall,
      liveActivityLedgerByRunId,
      optimisticStepsByRunId,
      optimisticToolCallsByRunId,
      pendingAssistantMessage,
      pendingRunAttachedToOptimisticMessage,
      pendingUserMessage,
      scrollToBottom,
      shouldShowOptimisticAssistantBubble,
      streamedReasoningTextByRunId,
      streamedTextByRunId,
      timelineScrollRef
    }
  };
}
