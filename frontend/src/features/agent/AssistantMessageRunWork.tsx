/**
 * CALLING SPEC:
 * - Purpose: render merged agent run work for one assistant turn — flat stream while running, collapsible separator when completed.
 * - Inputs: callers that import `frontend/src/features/agent/AssistantMessageRunWork.tsx`.
 * - Outputs: `AssistantMessageRunWork` React component.
 * - Side effects: local expand/collapse state; optional `onInspectActivity` on separator toggle; subscribes to the module stream store for hydrated tool snapshots.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { AgentRun, AgentRunStep, AgentToolCall } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  buildAgentWorkSeparatorLabel,
  buildLiveRunActivityItems,
  mergeRunActivityItems,
  mergeRunToolCalls,
  type RunActivityItem
} from "./activity";
import { AgentRunActivityRows } from "./AgentRunActivity";
import {
  getAgentStreamSessionRevision,
  getAgentStreamSessionSnapshot,
  subscribeAgentStreamSession
} from "./panel/agentStreamSession";

export interface AssistantMessageRunWorkProps {
  runs: AgentRun[];
  optimisticStepsByRunId: Record<string, AgentRunStep[]>;
  optimisticToolCallsByRunId: Record<string, AgentToolCall[]>;
  liveActivityLedgerByRunId?: Record<string, RunActivityItem[]>;
  isStreamingRun?: boolean;
  streamingReasoningText?: string;
  streamingReasoningStartedAt?: number | null;
  onInspectActivity?: () => void;
  onHydrateToolCall?: (runId: string, toolCallId: string) => void;
  hydratingToolCallIds?: ReadonlySet<string>;
}

export function AssistantMessageRunWork({
  runs,
  optimisticStepsByRunId,
  optimisticToolCallsByRunId,
  liveActivityLedgerByRunId = {},
  isStreamingRun = false,
  streamingReasoningText = "",
  streamingReasoningStartedAt,
  onInspectActivity,
  onHydrateToolCall,
  hydratingToolCallIds
}: AssistantMessageRunWorkProps) {
  const [expanded, setExpanded] = useState(false);
  const streamRevision = useSyncExternalStore(
    subscribeAgentStreamSession,
    getAgentStreamSessionRevision,
    getAgentStreamSessionRevision
  );

  const mergedItems = useMemo(() => {
    const session = getAgentStreamSessionSnapshot();
    const getOptimistic = (runId: string) => ({
      steps: optimisticStepsByRunId[runId] ?? session.optimisticStepsByRunId[runId] ?? [],
      toolCalls: mergeRunToolCalls(
        optimisticToolCallsByRunId[runId] ?? [],
        session.optimisticToolCallsByRunId[runId] ?? []
      )
    });
    const runsHaveLiveLedger = runs.some((run) => (liveActivityLedgerByRunId[run.id] ?? []).length > 0);
    if (isStreamingRun || runsHaveLiveLedger) {
      return buildLiveRunActivityItems(runs, getOptimistic, liveActivityLedgerByRunId);
    }
    return mergeRunActivityItems(runs, getOptimistic);
  }, [
    isStreamingRun,
    liveActivityLedgerByRunId,
    runs,
    optimisticStepsByRunId,
    optimisticToolCallsByRunId,
    streamRevision
  ]);

  const hasStreamingReasoningText = streamingReasoningText.trim().length > 0;
  const anyRunning = runs.some((run) => run.status === "running");
  const isLive = isStreamingRun || anyRunning || hasStreamingReasoningText;
  const placeholderActive = anyRunning && mergedItems.length === 0 && !hasStreamingReasoningText;
  const hasRenderableActivity = mergedItems.length > 0 || hasStreamingReasoningText || placeholderActive;
  const separatorLabel = useMemo(
    () => buildAgentWorkSeparatorLabel(runs, mergedItems),
    [runs, mergedItems]
  );
  const showCompletedChrome = !isLive && hasRenderableActivity;

  if (!hasRenderableActivity) {
    return null;
  }

  if (isLive) {
    return (
      <div className="agent-assistant-run-work">
        <AgentRunActivityRows
          items={mergedItems}
          onInspectActivity={onInspectActivity}
          onHydrateToolCall={onHydrateToolCall}
          hydratingToolCallIds={hydratingToolCallIds}
          streamingReasoningText={streamingReasoningText}
          streamingReasoningStartedAt={streamingReasoningStartedAt}
          showStreamingPlaceholder={placeholderActive}
        />
      </div>
    );
  }

  return (
    <div className="agent-assistant-run-work">
      {showCompletedChrome ? (
        <>
          {expanded ? (
            <AgentRunActivityRows
              items={mergedItems}
              onInspectActivity={onInspectActivity}
              onHydrateToolCall={onHydrateToolCall}
              hydratingToolCallIds={hydratingToolCallIds}
            />
          ) : null}
          <button
            type="button"
            className={cn("agent-work-separator", expanded && "agent-work-separator-expanded")}
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((value) => !value);
              onInspectActivity?.();
            }}
          >
            <span className="agent-work-separator-line" aria-hidden />
            <span className="agent-work-separator-center">
              <span className="agent-work-separator-label">{separatorLabel}</span>
              {expanded ? (
                <ChevronUp className="agent-work-separator-chevron h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <ChevronDown className="agent-work-separator-chevron h-4 w-4 shrink-0" aria-hidden />
              )}
            </span>
            <span className="agent-work-separator-line" aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
