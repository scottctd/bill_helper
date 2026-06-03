/**
 * CALLING SPEC:
 * - Purpose: render import task conversation in a fixed-height dialog with internal scroll.
 * - Inputs: open state, task metadata, and close handler.
 * - Outputs: modal with streamed/polled agent thread timeline and usage bar.
 * - Side effects: agent thread queries and SSE reconnect.
 */

import { useMemo } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { buildThreadUsageTotals } from "../agent/activity";
import { AgentThreadUsageBar } from "../agent/panel/AgentThreadUsageBar";
import { AgentTimeline } from "../agent/panel/AgentTimeline";
import { useStickToBottom } from "../agent/panel/useStickToBottom";
import type { ImportTask } from "../../lib/types";
import { importTaskStatusLabel } from "./importHelpers";
import { useImportTaskTimeline } from "./useImportTaskTimeline";

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
  const timeline = useImportTaskTimeline(threadId, open);
  const { containerRef, isAtBottom, scrollToBottom, detachFromBottom } = useStickToBottom<HTMLDivElement>();

  const threadUsageTotals = useMemo(
    () => buildThreadUsageTotals(timeline.threadQuery.data),
    [timeline.threadQuery.data]
  );

  const latestRun = timeline.threadQuery.data?.runs?.at(-1);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="import-task-dialog-content">
        <DialogHeader className="import-task-dialog-header">
          <div className="import-task-dialog-header-main">
            <DialogTitle>{task.source_label}</DialogTitle>
            {statusLabel ? <DialogDescription>{statusLabel}</DialogDescription> : null}
          </div>
          <AgentThreadUsageBar selectedThreadId={threadId} totals={threadUsageTotals} />
        </DialogHeader>
        <div className="import-task-dialog-body">
          <section className="agent-thread-timeline import-task-dialog-timeline">
            <AgentTimeline
              selectedThreadId={threadId}
              isLoading={timeline.threadQuery.isLoading}
              errorMessage={timeline.threadQuery.isError ? (timeline.threadQuery.error as Error).message : null}
              initiatedByExternalAgent={timeline.threadQuery.data?.thread.initiated_by_external_agent ?? false}
              messages={timeline.threadQuery.data?.messages}
              timelineScrollRef={containerRef}
              runsByAssistantMessageId={timeline.runsByAssistantMessageId}
              pendingAssistantRuns={timeline.pendingAssistantRuns}
              pendingAssistantRunsByUserMessageId={timeline.pendingAssistantRunsByUserMessageId}
              pendingUserMessage={null}
              pendingAssistantMessage={null}
              shouldShowOptimisticAssistantBubble={false}
              pendingRunAttachedToOptimisticMessage={null}
              activeStreamRunId={timeline.activeStreamRunId}
              activeStreamReasoningText={timeline.activeStreamReasoningText}
              activeStreamText={timeline.activeStreamText}
              streamedReasoningTextByRunId={timeline.streamedReasoningTextByRunId}
              streamedTextByRunId={timeline.streamedTextByRunId}
              optimisticRunEventsByRunId={timeline.optimisticRunEventsByRunId}
              optimisticToolCallsByRunId={timeline.optimisticToolCallsByRunId}
              activeOptimisticEvents={timeline.activeOptimisticEvents}
              activeOptimisticToolCalls={timeline.activeOptimisticToolCalls}
              hydratingToolCallIds={timeline.hydratingToolCallIds}
              onHydrateToolCall={timeline.handleHydrateToolCall}
              isAtBottom={isAtBottom}
              detachFromBottom={detachFromBottom}
              scrollToBottom={scrollToBottom}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
