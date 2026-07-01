/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentComposerActions` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentComposerActions.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `useAgentComposerActions`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentThread, streamAgentMessage } from "../../../lib/api";
import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import { queryKeys } from "../../../lib/queryKeys";
import { sortRunsByCreatedAt } from "../activity";
import { agentStreamAbortControllers } from "./agentStreamSession";
import type { ComposerIO, ComposerRunControl, ComposerThreadCacheOps } from "./composerRuntimeTypes";
import { type DraftAttachment, type PendingUserMessage } from "./types";
import { getApiErrorMessage } from "../../../lib/api/core";

interface UseAgentComposerActionsArgs {
  composerIO: ComposerIO;
  threadCacheOps: ComposerThreadCacheOps;
  runControl: ComposerRunControl;
}

export function useAgentComposerActions({ composerIO, threadCacheOps, runControl }: UseAgentComposerActionsArgs) {
  const {
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
  } = composerIO;
  const {
    addOptimisticRunningThreadId,
    clearOptimisticThreadTitle,
    removeOptimisticRunningThreadId,
    setThreadStreamHealthy
  } = threadCacheOps;
  const {
    activeRunId,
    activeStreamRunId,
    interruptRun,
    resetOptimisticRunState,
    selectedThreadId,
    threadDetail
  } = runControl;
  const queryClient = useQueryClient();
  const [sendingThreadIds, setSendingThreadIds] = useState<string[]>([]);

  async function handleSubmitSingleMessage(content: string, attachments: DraftAttachment[]) {
    let threadId: string | null = null;
    try {
      threadId = await ensureThreadId();
      const activeThreadId = threadId;
      const sendAbortController = new AbortController();
      agentStreamAbortControllers[activeThreadId] = sendAbortController;
      setSendingThreadIds((current) => (current.includes(activeThreadId) ? current : [...current, activeThreadId]));
      addOptimisticRunningThreadId(activeThreadId);
      setThreadStreamHealthy(activeThreadId, true);
      resetOptimisticRunState(activeThreadId);
      const readyAttachments = await resolveDraftAttachmentsForSend(attachments);
      const baselineLastTurnRunId =
        [...(threadDetail?.turns ?? [])].sort((left, right) => right.turn_index - left.turn_index)[0]?.run_id ??
        null;
      const optimisticMessage: PendingUserMessage = {
        id: `pending-user-${Date.now()}`,
        threadId: activeThreadId,
        content,
        createdAt: new Date().toISOString(),
        baselineLastTurnRunId,
        attachments: readyAttachments.map((item, index) => ({
          id: `${item.id}-${index}`,
          name: item.file.name,
          url: URL.createObjectURL(item.file),
          mimeType: item.file.type || "",
          kind: item.kind
        }))
      };
      setPendingUserMessage(activeThreadId, optimisticMessage);
      setPendingAssistantMessage(activeThreadId, {
        id: `pending-assistant-${Date.now()}`,
        threadId: activeThreadId,
        createdAt: new Date().toISOString(),
        baselineLastTurnRunId
      });
      setDraftMessage("");
      setDraftAttachments([]);
      snapToBottom();

      await streamAgentMessage({
        threadId: activeThreadId,
        content,
        files: [],
        attachmentIds: readyAttachments.map((item) => item.uploadedAttachmentId),
        attachmentsUseOcr: false,
        modelName: selectedComposerModel || undefined,
        approvalPolicy,
        signal: sendAbortController.signal,
        onEvent: (streamEvent) => handleAgentStreamEvent(activeThreadId, streamEvent)
      });
      delete agentStreamAbortControllers[activeThreadId];
      setThreadStreamHealthy(activeThreadId, false);
      const detail = await getAgentThread(activeThreadId);
      queryClient.setQueryData(queryKeys.agent.thread(activeThreadId), detail);
      clearOptimisticThreadTitle(activeThreadId);
      invalidateAgentThreadData(queryClient, activeThreadId);
      setPendingUserMessage(activeThreadId, null);
      setPendingAssistantMessage(activeThreadId, null);
      removeOptimisticRunningThreadId(activeThreadId);
      resetOptimisticRunState(activeThreadId);
    } catch (error) {
      if (threadId) {
        delete agentStreamAbortControllers[threadId];
        setThreadStreamHealthy(threadId, false);
      }
      if ((error as Error).name === "AbortError") {
        if (threadId) {
          setPendingUserMessage(threadId, null);
          setPendingAssistantMessage(threadId, null);
          resetOptimisticRunState(threadId);
        }
        setActionError(null);
      } else {
        setActionError(getApiErrorMessage(error));
      }
    } finally {
      if (threadId) {
        removeOptimisticRunningThreadId(threadId);
      }
      if (threadId) {
        setSendingThreadIds((current) => current.filter((item) => item !== threadId));
      }
    }
  }

  async function handleSubmitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    const content = draftMessage.trim();
    if (!content && draftAttachments.length === 0) {
      setActionError("Enter a message or attach at least one file.");
      return;
    }
    await handleSubmitSingleMessage(content, [...draftAttachments]);
  }

  async function handleStopRun() {
    if (!selectedThreadId) {
      return;
    }
    setActionError(null);
    setThreadStreamHealthy(selectedThreadId, false);
    removeOptimisticRunningThreadId(selectedThreadId);
    setPendingAssistantMessage(selectedThreadId, null);
    setPendingUserMessage(selectedThreadId, null);
    resetOptimisticRunState(selectedThreadId);
    setSendingThreadIds((current) => current.filter((threadId) => threadId !== selectedThreadId));
    const abortController = agentStreamAbortControllers[selectedThreadId];
    if (abortController) {
      abortController.abort();
      delete agentStreamAbortControllers[selectedThreadId];
    }
    let runIdToInterrupt = activeRunId || activeStreamRunId || null;
    if (!runIdToInterrupt) {
      try {
        const detail = await getAgentThread(selectedThreadId);
        const latestRunningRun = sortRunsByCreatedAt(detail.runs)
          .reverse()
          .find((run) => run.status === "running");
        runIdToInterrupt = latestRunningRun?.id ?? null;
      } catch {
        runIdToInterrupt = null;
      }
    }
    if (!runIdToInterrupt) {
      return;
    }
    try {
      await interruptRun({ runId: runIdToInterrupt, threadId: selectedThreadId });
    } catch (error) {
      setActionError(getApiErrorMessage(error));
    }
  }

  return {
    handleStopRun,
    handleSubmitMessage,
    sendingThreadIds
  };
}
