/**
 * CALLING SPEC:
 * - Purpose: provide the `useAgentComposerActions` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/agent/panel/useAgentComposerActions.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `useAgentComposerActions`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { type Dispatch, type FormEvent, type SetStateAction, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getAgentThread, streamAgentMessage } from "../../../lib/api";
import { invalidateAgentThreadData } from "../../../lib/queryInvalidation";
import { queryKeys } from "../../../lib/queryKeys";
import type { AgentApprovalPolicy, AgentStreamEvent, AgentThreadDetail } from "../../../lib/types";
import { sortRunsByCreatedAt } from "../activity";
import { agentStreamAbortControllers } from "./agentStreamSession";
import { type DraftAttachment, type PendingAssistantMessage, type PendingUserMessage, type ReadyDraftAttachment } from "./types";

interface UseAgentComposerActionsArgs {
  activeRunId: string | null;
  activeStreamRunId: string | null;
  addOptimisticRunningThreadId: (threadId: string) => void;
  approvalPolicy: AgentApprovalPolicy;
  clearOptimisticThreadTitle: (threadId: string) => void;
  draftAttachments: DraftAttachment[];
  draftMessage: string;
  ensureThreadId: () => Promise<string>;
  handleAgentStreamEvent: (threadId: string, event: AgentStreamEvent) => void;
  interruptRun: (payload: { runId: string; threadId: string }) => Promise<void>;
  removeOptimisticRunningThreadId: (threadId: string) => void;
  resetOptimisticRunState: (threadId?: string) => void;
  resolveDraftAttachmentsForSend: (attachments: DraftAttachment[]) => Promise<ReadyDraftAttachment[]>;
  selectedComposerModel: string;
  selectedThreadId: string;
  setActionError: (message: string | null) => void;
  setDraftAttachments: Dispatch<SetStateAction<DraftAttachment[]>>;
  setDraftMessage: (message: string) => void;
  setPendingAssistantMessage: (threadId: string, message: PendingAssistantMessage | null) => void;
  setPendingUserMessage: (threadId: string, message: PendingUserMessage | null) => void;
  setThreadStreamHealthy: (threadId: string, isHealthy: boolean) => void;
  snapToBottom: () => void;
  threadDetail: AgentThreadDetail | undefined;
}

export function useAgentComposerActions({
  activeRunId,
  activeStreamRunId,
  addOptimisticRunningThreadId,
  approvalPolicy,
  clearOptimisticThreadTitle,
  draftAttachments,
  draftMessage,
  ensureThreadId,
  handleAgentStreamEvent,
  interruptRun,
  removeOptimisticRunningThreadId,
  resetOptimisticRunState,
  resolveDraftAttachmentsForSend,
  selectedComposerModel,
  selectedThreadId,
  setActionError,
  setDraftAttachments,
  setDraftMessage,
  setPendingAssistantMessage,
  setPendingUserMessage,
  setThreadStreamHealthy,
  snapToBottom,
  threadDetail
}: UseAgentComposerActionsArgs) {
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
      invalidateAgentThreadData(queryClient, activeThreadId);
      const readyAttachments = await resolveDraftAttachmentsForSend(attachments);
      const baselineLastUserMessageId =
        [...(threadDetail?.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user")
          ?.id ?? null;
      const baselineLastAssistantMessageId =
        [...(threadDetail?.messages ?? [])]
          .reverse()
          .find((message) => message.role === "assistant")
          ?.id ?? null;
      const optimisticMessage: PendingUserMessage = {
        id: `pending-user-${Date.now()}`,
        threadId: activeThreadId,
        content,
        createdAt: new Date().toISOString(),
        baselineLastUserMessageId,
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
        baselineLastAssistantMessageId
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
        setActionError((error as Error).message);
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
      setActionError((error as Error).message);
    }
  }

  return {
    handleStopRun,
    handleSubmitMessage,
    sendingThreadIds
  };
}
