/**
 * CALLING SPEC:
 * - Purpose: render per-run agent UI — activity (delegated) plus optional change-item summary.
 * - Inputs: callers that import `frontend/src/features/agent/AgentRunBlock.tsx`.
 * - Outputs: `AgentRunBlock` React component.
 * - Side effects: React rendering.
 */
import { useMemo } from "react";

import type { AgentRun, AgentRunStep, AgentToolCall } from "../../lib/types";
import { listOrEmpty } from "../../lib/collections";
import { cn } from "../../lib/utils";
import {
  buildRunTimelineFromProjections,
  mergeRunSteps,
  mergeRunToolCalls,
  runErrorText,
  summarizeRunChangeTypes,
  type RunActivityItem
} from "./activity";
import { AssistantMessageRunWork } from "./AssistantMessageRunWork";

interface AgentRunBlockProps {
  run: AgentRun;
  onInspectActivity?: () => void;
  onHydrateToolCall?: (runId: string, toolCallId: string) => void;
  hydratingToolCallIds?: ReadonlySet<string>;
  mode?: "activity" | "summary" | "all";
  optimisticSteps?: AgentRunStep[];
  optimisticToolCalls?: AgentToolCall[];
  streamingReasoningText?: string;
  streamingReasoningStartedAt?: number | null;
  liveActivityLedgerByRunId?: Record<string, RunActivityItem[]>;
}

export function AgentRunBlock({
  run,
  onInspectActivity,
  onHydrateToolCall,
  hydratingToolCallIds,
  mode = "all",
  optimisticSteps = [],
  optimisticToolCalls = [],
  streamingReasoningText = "",
  streamingReasoningStartedAt,
  liveActivityLedgerByRunId = {}
}: AgentRunBlockProps) {
  const showActivity = mode !== "summary";
  const showSummary = mode !== "activity";
  const changeItems = listOrEmpty(run.change_items);
  const hasSummaryChanges = showSummary && changeItems.length > 0;
  const pendingCount = changeItems.filter((item) => item.status === "PENDING_REVIEW").length;
  const failedCount = changeItems.filter((item) => item.status === "APPLY_FAILED").length;
  const typeSummary = summarizeRunChangeTypes(changeItems);

  const optimisticStepsByRunId = useMemo(
    () => ({ [run.id]: optimisticSteps }),
    [run.id, optimisticSteps]
  );
  const optimisticToolCallsByRunId = useMemo(
    () => ({ [run.id]: optimisticToolCalls }),
    [run.id, optimisticToolCalls]
  );

  const mergedSteps = useMemo(() => mergeRunSteps(listOrEmpty(run.steps), optimisticSteps), [run.steps, optimisticSteps]);
  const mergedToolCalls = useMemo(
    () => mergeRunToolCalls(listOrEmpty(run.tool_calls), optimisticToolCalls),
    [run.tool_calls, optimisticToolCalls]
  );
  const activityTimeline = useMemo(
    () => buildRunTimelineFromProjections(mergedSteps, mergedToolCalls),
    [mergedSteps, mergedToolCalls]
  );
  const hasActivitySignals =
    Boolean(runErrorText(run)) ||
    activityTimeline.length > 0 ||
    streamingReasoningText.length > 0 ||
    run.status === "running";

  if (!hasActivitySignals && !hasSummaryChanges) {
    return null;
  }

  return (
    <div className={cn("agent-run-block", showSummary && "agent-run-block-summary")}>
      {showActivity && hasActivitySignals ? (
        <AssistantMessageRunWork
          runs={[run]}
          optimisticStepsByRunId={optimisticStepsByRunId}
          optimisticToolCallsByRunId={optimisticToolCallsByRunId}
          liveActivityLedgerByRunId={liveActivityLedgerByRunId}
          isStreamingRun={run.status === "running" || streamingReasoningText.length > 0}
          streamingReasoningText={streamingReasoningText}
          streamingReasoningStartedAt={streamingReasoningStartedAt}
          onInspectActivity={onInspectActivity}
          onHydrateToolCall={onHydrateToolCall}
          hydratingToolCallIds={hydratingToolCallIds}
        />
      ) : null}

      {hasSummaryChanges ? (
        <div className="agent-run-changes-summary">
          <h4>{pendingCount > 0 ? `${pendingCount} proposed changes pending review` : "No pending changes in this run"}</h4>
          <p className="muted">
            {pendingCount > 0
              ? "Use the thread header Review button to process proposals."
              : "Reviewed changes remain available from the thread header Review button."}
          </p>
          <div className="agent-run-change-chips">
            <span className="agent-run-change-chip">Entry x{typeSummary.entryCount}</span>
            <span className="agent-run-change-chip">Group x{typeSummary.groupCount}</span>
            <span className="agent-run-change-chip">Tag x{typeSummary.tagCount}</span>
            <span className="agent-run-change-chip">Entity x{typeSummary.entityCount}</span>
          </div>
          {failedCount > 0 ? (
            <p className="error">
              {failedCount} apply failure{failedCount === 1 ? "" : "s"} detected. Open review for details.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
