/**
 * CALLING SPEC:
 * - Purpose: TypeScript contracts for the import workflow API.
 * - Inputs: frontend modules importing import job/task/preflight shapes.
 * - Outputs: exported import workflow types.
 * - Side effects: none.
 */

import type { AgentApprovalPolicy, AgentRunStatus } from "./agent";

export type ImportJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ImportTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ImportPreflightSuggestedAction = "import" | "skip";

export interface ImportPriorImport {
  job_id: string;
  job_title: string | null;
  task_id: string;
  thread_id: string;
  imported_at: string;
  task_status: ImportTaskStatus;
  applied_count: number;
}

export interface ImportPreflightFile {
  attachment_id: string;
  user_file_id: string;
  sha256: string | null;
  filename: string;
  size_bytes: number;
  previously_imported: boolean;
  suggested_action: ImportPreflightSuggestedAction;
  prior_imports: ImportPriorImport[];
}

export interface ImportPreflightResponse {
  files: ImportPreflightFile[];
}

export interface ImportTaskRunSummary {
  run_id: string | null;
  run_status: AgentRunStatus | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost_usd: number | null;
}

export interface ImportTask {
  id: string;
  job_id: string;
  thread_id: string;
  source_user_file_id: string | null;
  source_sha256: string | null;
  source_label: string;
  status: ImportTaskStatus;
  active_run_id: string | null;
  error_text: string | null;
  sequence_index: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  latest_run: ImportTaskRunSummary | null;
}

export interface ImportJobSummary {
  id: string;
  title: string | null;
  status: ImportJobStatus;
  model_name: string;
  concurrency: number;
  approval_policy: AgentApprovalPolicy;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  aggregate_total_cost_usd: number | null;
}

export interface ImportJobDetail extends ImportJobSummary {
  instructions: string;
  tasks: ImportTask[];
}

export interface ImportJobCreatePayload {
  title?: string | null;
  model_name?: string | null;
  concurrency?: number | null;
  approval_policy?: AgentApprovalPolicy;
  instructions?: string;
  source_attachment_ids: string[];
}

export interface ImportJobAggregatedProposal {
  canonical_change_item_id: string;
  change_type: string;
  status: string;
  payload_json: Record<string, unknown>;
  duplicate_count: number;
  source_task_ids: string[];
  source_task_labels: string[];
}

export interface ImportJobBatchApplyItemResult {
  change_item_id: string;
  status: "applied" | "failed";
  error?: string | null;
}

export interface ImportJobBatchApplyResponse {
  applied_count: number;
  failed_count: number;
  results: ImportJobBatchApplyItemResult[];
}
