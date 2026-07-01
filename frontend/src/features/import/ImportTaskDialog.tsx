/**
 * CALLING SPEC:
 * - Purpose: render import task conversation in a fixed-height dialog with internal scroll and follow-up chat.
 * - Inputs: open state, task metadata, and close handler.
 * - Outputs: modal with streamed/polled agent thread timeline, usage bar, and composer.
 * - Side effects: agent thread queries and SSE reconnect.
 */

import { useMemo } from "react";

import { DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { ModalShell } from "../../components/ui/modal-shell";
import { buildThreadUsageTotals } from "../agent/activity";
import { AgentComposer } from "../agent/panel/AgentComposer";
import { AgentThreadUsageBar } from "../agent/panel/AgentThreadUsageBar";
import { AgentTimeline } from "../agent/panel/AgentTimeline";
import type { ImportTask } from "../../lib/types";
import { importTaskStatusLabel } from "./importHelpers";
import { useImportTaskTimeline } from "./useImportTaskTimeline";
import { getApiErrorMessage } from "../../lib/api/core";

export interface ImportTaskConversationTarget {
  thread_id: string;
  source_label: string;
}

interface ImportTaskDialogProps {
  task: (ImportTask & ImportTaskConversationTarget) | ImportTaskConversationTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportTaskDialog({ task, open, onOpenChange }: ImportTaskDialogProps) {
  const threadId = task?.thread_id ?? "";
  const dialog = useImportTaskTimeline(threadId, open);
  const { composer, timeline } = dialog;

  const threadUsageTotals = useMemo(
    () => buildThreadUsageTotals(dialog.threadQuery.data),
    [dialog.threadQuery.data]
  );

  const latestRun = dialog.threadQuery.data?.runs?.at(-1);
  const statusLabel =
    "status" in (task ?? {}) && task && "status" in task
      ? importTaskStatusLabel((task as ImportTask).status)
      : latestRun?.status
        ? `Run ${latestRun.status}`
        : null;

  if (!task) {
    return null;
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="import-task-dialog-content"
      header={
        <DialogHeader className="import-task-dialog-header">
          <div className="import-task-dialog-header-main">
            <DialogTitle>{task.source_label}</DialogTitle>
            {statusLabel ? <DialogDescription>{statusLabel}</DialogDescription> : null}
          </div>
          <AgentThreadUsageBar selectedThreadId={threadId} totals={threadUsageTotals} />
        </DialogHeader>
      }
    >
      <div className="import-task-dialog-body">
        <section className="agent-thread-timeline import-task-dialog-timeline">
          <AgentTimeline
            model={{
              selectedThreadId: threadId,
              isLoading: dialog.threadQuery.isLoading,
              errorMessage: dialog.threadQuery.isError ? getApiErrorMessage(dialog.threadQuery.error) : null,
              initiatedByExternalAgent: dialog.threadQuery.data?.thread.initiated_by_external_agent ?? false,
              turns: dialog.threadQuery.data?.turns,
              runsById: dialog.runsById,
              pendingAssistantRuns: dialog.pendingAssistantRuns,
              pendingUserMessage: timeline.pendingUserMessage,
              pendingAssistantMessage: timeline.pendingAssistantMessage,
              shouldShowOptimisticAssistantBubble: timeline.shouldShowOptimisticAssistantBubble,
              pendingRunAttachedToOptimisticMessage: timeline.pendingRunAttachedToOptimisticMessage,
              stream: {
                activeStreamRunId: timeline.activeStreamRunId,
                activeStreamReasoningText: timeline.activeStreamReasoningText,
                activeStreamText: timeline.activeStreamText,
                streamedReasoningTextByRunId: timeline.streamedReasoningTextByRunId,
                streamedTextByRunId: timeline.streamedTextByRunId,
                optimisticStepsByRunId: timeline.optimisticStepsByRunId,
                optimisticToolCallsByRunId: timeline.optimisticToolCallsByRunId,
                liveActivityLedgerByRunId: timeline.liveActivityLedgerByRunId,
                activeOptimisticSteps: timeline.activeOptimisticSteps,
                activeOptimisticToolCalls: timeline.activeOptimisticToolCalls,
                hydratingToolCallIds: timeline.hydratingToolCallIds
              },
              scroll: {
                timelineScrollRef: timeline.timelineScrollRef,
                detachFromBottom: timeline.detachFromBottom,
                isAtBottom: timeline.isAtBottom,
                scrollToBottom: timeline.scrollToBottom
              },
              onHydrateToolCall: timeline.onHydrateToolCall
            }}
          />
          <AgentComposer {...composer} />
        </section>
      </div>
    </ModalShell>
  );
}
