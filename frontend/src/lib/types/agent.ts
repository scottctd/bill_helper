/**
 * CALLING SPEC:
 * - Purpose: define agent-thread, review, and streaming contracts for the frontend.
 * - Inputs: frontend modules that render agent threads, runs, tool calls, and review workflows.
 * - Outputs: agent-domain interfaces and harness projection event unions.
 * - Side effects: type declarations only.
 */

export type AgentRunStatus = "running" | "completed" | "interrupted" | "max_steps" | "failed";
export type AgentStepStatus = "running" | "committed" | "failed";
export type AgentToolCallStatus = "queued" | "running" | "ok" | "error" | "cancelled";
export type AgentModelDeltaType = "reasoning" | "content";
export type AgentChangeType =
  | "create_entry"
  | "update_entry"
  | "delete_entry"
  | "create_account"
  | "update_account"
  | "delete_account"
  | "create_snapshot"
  | "delete_snapshot"
  | "create_group"
  | "update_group"
  | "delete_group"
  | "create_group_member"
  | "delete_group_member"
  | "create_tag"
  | "update_tag"
  | "delete_tag"
  | "create_entity"
  | "update_entity"
  | "delete_entity";
export type AgentChangeStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "APPLIED" | "APPLY_FAILED";
export type AgentReviewActionType = "approve" | "reject";
export type AgentDashboardRangeKey = "7d" | "30d" | "90d" | "all";
export type AgentDashboardGranularity = "day" | "week" | "month";

export interface AgentThread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  initiated_by_external_agent?: boolean;
}

export interface AgentThreadSummary extends AgentThread {
  last_message_preview: string | null;
  pending_change_count: number;
  has_running_run: boolean;
}

export interface AgentTurnAttachment {
  id: string;
  display_name: string;
  mime_type: string;
  attachment_url: string;
}

export interface AgentTurn {
  run_id: string;
  turn_index: number;
  status: AgentRunStatus;
  user_message: AgentTurnMessage;
  assistant_message: AgentTurnMessage | null;
}

export interface AgentTurnMessage {
  id: string;
  role: "user" | "assistant";
  content_markdown: string;
  reasoning_text: string | null;
  created_at: string;
  attachments: AgentTurnAttachment[];
}

export interface AgentDraftAttachment {
  id: string;
  display_name: string;
  mime_type: string;
  created_at: string;
}

export interface AgentRunStep {
  id: string;
  run_id: string;
  step_index: number;
  status: AgentStepStatus;
  reasoning_text: string | null;
  progress_note: string | null;
  reasoning_duration_ms: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface AgentToolCall {
  id: string;
  run_id: string;
  step_id: string;
  call_index: number;
  tool_request_id: string;
  tool_name: string;
  display_label: string;
  display_detail: string | null;
  arguments_json: Record<string, unknown> | null;
  result_content_json: Record<string, unknown> | null;
  output_text: string | null;
  has_full_payload: boolean;
  status: AgentToolCallStatus;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentReviewAction {
  id: string;
  change_item_id: string;
  action: AgentReviewActionType;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface AgentChangeItem {
  id: string;
  run_id: string;
  change_type: AgentChangeType;
  payload_json: Record<string, unknown>;
  status: AgentChangeStatus;
  review_note: string | null;
  applied_resource_type: string | null;
  applied_resource_id: string | null;
  created_at: string;
  updated_at: string;
  review_actions: AgentReviewAction[];
}

export interface AgentBatchChangeItemReviewSummary {
  succeeded: number;
  failed: number;
  failed_item_ids: string[];
}

export interface AgentBatchChangeItemReviewResponse {
  items: AgentChangeItem[];
  summary: AgentBatchChangeItemReviewSummary;
}

export type AgentApprovalPolicy = "default" | "yolo";

export interface AgentRun {
  id: string;
  thread_id: string;
  turn_index: number;
  status: AgentRunStatus;
  model_name: string;
  origin: string;
  approval_policy: AgentApprovalPolicy;
  final_assistant_reply: string | null;
  context_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  input_cost_usd: number | null;
  output_cost_usd: number | null;
  total_cost_usd: number | null;
  error_code: string | null;
  error_detail: string | null;
  last_event_sequence_index: number | null;
  created_at: string;
  completed_at: string | null;
  steps: AgentRunStep[];
  tool_calls: AgentToolCall[];
  change_items: AgentChangeItem[];
}

export interface AgentDashboardMetrics {
  total_cost_usd: number;
  total_tokens: number;
  total_run_count: number;
  completed_run_count: number;
  failed_run_count: number;
  avg_cost_per_run_usd: number;
  avg_tokens_per_run: number;
  cache_hit_rate: number;
  most_used_model: string | null;
  failure_rate: number;
}

export interface AgentDashboardCostPoint {
  bucket_key: string;
  bucket_label: string;
  bucket_start: string;
  total_cost_usd: number;
  run_count: number;
  costs_by_model: Record<string, number>;
}

export interface AgentDashboardTokenSlice {
  label: string;
  token_count: number;
  share: number;
}

export interface AgentDashboardModelBreakdown {
  model_name: string;
  run_count: number;
  completed_run_count: number;
  failed_run_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_cost_per_run_usd: number;
}

export interface AgentDashboardSurfaceBreakdown {
  surface: string;
  run_count: number;
  total_tokens: number;
  total_cost_usd: number;
  costs_by_model: Record<string, number>;
}

export interface AgentDashboardTopRun {
  run_id: string;
  thread_id: string;
  thread_title: string | null;
  model_name: string;
  surface: string;
  status: AgentRunStatus;
  created_at: string;
  completed_at: string | null;
  total_tokens: number;
  total_cost_usd: number;
}

export interface AgentDashboard {
  range_key: AgentDashboardRangeKey;
  granularity: AgentDashboardGranularity;
  available_models: string[];
  available_surfaces: string[];
  selected_models: string[];
  selected_surfaces: string[];
  metrics: AgentDashboardMetrics;
  cost_series: AgentDashboardCostPoint[];
  token_distribution: AgentDashboardTokenSlice[];
  model_breakdown: AgentDashboardModelBreakdown[];
  surface_breakdown: AgentDashboardSurfaceBreakdown[];
  top_runs: AgentDashboardTopRun[];
}

export interface AgentThreadDetail {
  thread: AgentThread;
  turns: AgentTurn[];
  runs: AgentRun[];
  configured_model_name: string;
  current_context_tokens: number | null;
  initiated_by_external_agent?: boolean;
}

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
  | {
      type: "model_decision_committed";
      run_id: string;
      step_index: number;
      assistant_message_id: string;
      has_tool_requests: boolean;
      reasoning_text?: string | null;
      sequence_index?: number;
    }
  | {
      type: "tool_started";
      run_id: string;
      step_index: number;
      tool_call_id: string;
      tool_name: string;
      sequence_index?: number;
    }
  | {
      type: "tool_finished";
      run_id: string;
      step_index: number;
      tool_call_id: string;
      tool_name: string;
      status: string;
      sequence_index?: number;
    }
  | {
      type: "run_finished";
      run_id: string;
      status: AgentRunStatus;
      final_assistant_content: string | null;
      terminal_error?: AgentStreamTerminalError | null;
      sequence_index?: number;
    };
