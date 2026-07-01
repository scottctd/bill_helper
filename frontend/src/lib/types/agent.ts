/**
 * CALLING SPEC:
 * - Purpose: define agent-thread, review, and streaming contracts for the frontend.
 * - Inputs: frontend modules that render agent threads, runs, tool calls, and review workflows.
 * - Outputs: agent API type aliases from generated OpenAPI types plus hand-written SSE wire unions.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type AgentRunStatus = ApiSchemas["AgentRunStatus"];
export type AgentStepStatus = ApiSchemas["AgentStepStatus"];
export type AgentToolCallStatus = ApiSchemas["AgentToolCallStatus"];
export type AgentChangeType = ApiSchemas["AgentChangeType"];
export type AgentChangeStatus = ApiSchemas["AgentChangeStatus"];
export type AgentReviewActionType = ApiSchemas["AgentReviewActionType"];
export type AgentApprovalPolicy = ApiSchemas["AgentApprovalPolicy"];

/** Frontend-local filter literals for the agent dashboard workspace. */
export type AgentDashboardRangeKey = "7d" | "30d" | "90d" | "all";
/** Frontend-local chart bucket granularity for the agent dashboard workspace. */
export type AgentDashboardGranularity = "day" | "week" | "month";

export type AgentThread = ApiSchemas["AgentThreadRead"];
export type AgentThreadSummary = ApiSchemas["AgentThreadSummaryRead"];
export type AgentTurnAttachment = ApiSchemas["AgentTranscriptAttachmentRead"];
export type AgentTurn = ApiSchemas["AgentTurnRead"];
export type AgentTurnMessage = ApiSchemas["AgentTurnMessageRead"];
export type AgentDraftAttachment = ApiSchemas["AgentDraftAttachmentRead"];
export type AgentRunStep = ApiSchemas["AgentStepRead"];
export type AgentToolCall = ApiSchemas["AgentToolCallRead"];
export type AgentReviewAction = ApiSchemas["AgentReviewActionRead"];
export type AgentChangeItem = ApiSchemas["AgentChangeItemRead"];
export type AgentBatchChangeItemReviewSummary = ApiSchemas["AgentBatchChangeItemReviewSummary"];
export type AgentBatchChangeItemReviewResponse = ApiSchemas["AgentBatchChangeItemReviewResponse"];
export type AgentRun = ApiSchemas["AgentRunRead"];
/** Cached runs may carry live SSE usage fields not present on `AgentRunRead`. */
export type AgentRunWithLiveUsage = AgentRun & Partial<AgentStreamRunUsage>;
export type AgentDashboardMetrics = ApiSchemas["AgentDashboardMetricsRead"];
export type AgentDashboardCostPoint = ApiSchemas["AgentDashboardCostPointRead"];
export type AgentDashboardTokenSlice = ApiSchemas["AgentDashboardTokenSliceRead"];
export type AgentDashboardModelBreakdown = ApiSchemas["AgentDashboardModelBreakdownRead"];
export type AgentDashboardOriginBreakdown = ApiSchemas["AgentDashboardOriginBreakdownRead"];
export type AgentDashboardTopRun = ApiSchemas["AgentDashboardTopRunRead"];
export type AgentDashboard = ApiSchemas["AgentDashboardRead"];
export type AgentThreadDetail = ApiSchemas["AgentThreadDetailRead"];

/** Ephemeral model token deltas are not modeled in OpenAPI (SSE-only). */
export type AgentModelDeltaType = "reasoning" | "content";

/** Cumulative usage for one run when an adapter includes it on SSE payloads. */
export interface AgentStreamRunUsage {
  context_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  input_cost_usd: number | null;
  output_cost_usd: number | null;
  total_cost_usd: number | null;
}

export interface AgentStreamTerminalError {
  code: string;
  detail: string;
}

/** Live usage snapshot attached to durable events during replay while a run is still running. */
export interface AgentStreamEventRunUsageFields {
  run_usage?: AgentStreamRunUsage;
}

/** SSE wire payloads are not OpenAPI response models; kept hand-written with a parity test. */
export type AgentStreamEvent =
  | {
      type: "reasoning_delta";
      run_id: string;
      delta: string;
      sequence_index?: number;
    }
  | {
      type: "text_delta";
      run_id: string;
      delta: string;
      sequence_index?: number;
    }
  | {
      type: "model_delta";
      run_id: string;
      step_index: number;
      delta_type: AgentModelDeltaType;
      text: string;
      sequence_index?: number;
    }
  | ({
      type: "run_started";
      run_id: string;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "model_request_started";
      run_id: string;
      step_index: number;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "model_decision_committed";
      run_id: string;
      step_index: number;
      assistant_message_id: string;
      has_tool_requests: boolean;
      reasoning_text?: string | null;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "tool_started";
      run_id: string;
      step_index: number;
      tool_call_id: string;
      tool_name: string;
      display_label?: string | null;
      display_detail?: string | null;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "tool_finished";
      run_id: string;
      step_index: number;
      tool_call_id: string;
      tool_name: string;
      status: string;
      display_label?: string | null;
      display_detail?: string | null;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "step_committed";
      run_id: string;
      step_index: number;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields)
  | ({
      type: "run_finished";
      run_id: string;
      status: AgentRunStatus;
      final_assistant_content: string | null;
      terminal_error?: AgentStreamTerminalError | null;
      sequence_index?: number;
    } & AgentStreamEventRunUsageFields);

/** Every `AgentStreamEvent["type"]` the client handles or recognizes on the SSE wire. */
export const KNOWN_AGENT_STREAM_EVENT_TYPES = [
  "reasoning_delta",
  "text_delta",
  "model_delta",
  "run_started",
  "model_request_started",
  "model_decision_committed",
  "tool_started",
  "tool_finished",
  "step_committed",
  "run_finished"
] as const satisfies readonly AgentStreamEvent["type"][];

export type KnownAgentStreamEventType = (typeof KNOWN_AGENT_STREAM_EVENT_TYPES)[number];
