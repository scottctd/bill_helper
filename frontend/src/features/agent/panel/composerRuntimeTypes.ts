/**
 * CALLING SPEC:
 * - Purpose: grouped inputs for composer send/stop orchestration hooks.
 * - Inputs: panel controller wiring for thread lifecycle and stream handlers.
 * - Outputs: ComposerIO and ComposerRunControl type contracts.
 * - Side effects: type declarations only.
 */
import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { AgentApprovalPolicy, AgentStreamEvent, AgentThreadDetail } from "../../../lib/types";
import type { DraftAttachment, PendingAssistantMessage, PendingUserMessage, ReadyDraftAttachment } from "./types";

export interface ComposerIO {
  ensureThreadId: () => Promise<string>;
  handleAgentStreamEvent: (threadId: string, event: AgentStreamEvent) => void;
  snapToBottom: () => void;
  draftAttachments: DraftAttachment[];
  draftMessage: string;
  resolveDraftAttachmentsForSend: (attachments: DraftAttachment[]) => Promise<ReadyDraftAttachment[]>;
  selectedComposerModel: string;
  approvalPolicy: AgentApprovalPolicy;
  setDraftAttachments: Dispatch<SetStateAction<DraftAttachment[]>>;
  setDraftMessage: (message: string) => void;
  setPendingAssistantMessage: (threadId: string, message: PendingAssistantMessage | null) => void;
  setPendingUserMessage: (threadId: string, message: PendingUserMessage | null) => void;
  setActionError: (message: string | null) => void;
}

export interface ComposerThreadCacheOps {
  addOptimisticRunningThreadId: (threadId: string) => void;
  removeOptimisticRunningThreadId: (threadId: string) => void;
  clearOptimisticThreadTitle: (threadId: string) => void;
  setThreadStreamHealthy: (threadId: string, isHealthy: boolean) => void;
}

export interface ComposerRunControl {
  activeRunId: string | null;
  activeStreamRunId: string | null;
  interruptRun: (payload: { runId: string; threadId: string }) => Promise<void>;
  resetOptimisticRunState: (threadId?: string) => void;
  selectedThreadId: string;
  threadDetail: AgentThreadDetail | undefined;
}

export type ComposerSubmitHandler = (event: FormEvent<HTMLFormElement>) => Promise<void>;
