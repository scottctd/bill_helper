/**
 * CALLING SPEC:
 * - Purpose: define the grouped view-model passed from the panel controller to AgentTimeline.
 * - Inputs: panel query data and composer stream state slices.
 * - Outputs: AgentTimelineModel interface for a single timeline prop.
 * - Side effects: type declarations only.
 */
import type { Ref } from "react";

import type { AgentRun, AgentRunStep, AgentToolCall, AgentTurn } from "../../../lib/types";
import type { RunActivityItem } from "../activity";
import type { PendingAssistantMessage, PendingUserMessage } from "./types";

export interface AgentTimelineStreamModel {
  activeStreamRunId: string | null;
  activeStreamReasoningText: string;
  activeStreamText: string;
  streamedReasoningTextByRunId: Record<string, string>;
  streamedTextByRunId: Record<string, string>;
  optimisticStepsByRunId: Record<string, AgentRunStep[]>;
  optimisticToolCallsByRunId: Record<string, AgentToolCall[]>;
  liveActivityLedgerByRunId: Record<string, RunActivityItem[]>;
  activeOptimisticSteps: AgentRunStep[];
  activeOptimisticToolCalls: AgentToolCall[];
  hydratingToolCallIds: ReadonlySet<string>;
}

export interface AgentTimelineScrollModel {
  timelineScrollRef: Ref<HTMLDivElement>;
  detachFromBottom: () => void;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

export interface AgentTimelineModel {
  selectedThreadId: string;
  isLoading: boolean;
  errorMessage: string | null;
  initiatedByExternalAgent: boolean;
  turns: AgentTurn[] | undefined;
  runsById: Map<string, AgentRun>;
  pendingAssistantRuns: AgentRun[];
  pendingUserMessage: PendingUserMessage | null;
  pendingAssistantMessage: PendingAssistantMessage | null;
  shouldShowOptimisticAssistantBubble: boolean;
  pendingRunAttachedToOptimisticMessage: AgentRun | null;
  stream: AgentTimelineStreamModel;
  scroll: AgentTimelineScrollModel;
  onHydrateToolCall: (runId: string, toolCallId: string) => void;
}

export interface AgentTimelineProps {
  model: AgentTimelineModel;
}
