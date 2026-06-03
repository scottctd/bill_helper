/**
 * CALLING SPEC:
 * - Purpose: shared import UI formatting and status helpers.
 * - Inputs: import job/task/proposal records from API types.
 * - Outputs: display labels, progress values, and badge tone mappings.
 * - Side effects: none.
 */

import type { AgentRun } from "../../lib/types";
import type { ImportJobStatus, ImportJobSummary, ImportTaskStatus } from "../../lib/types";
import { isPendingReviewStatus } from "../agent/review/model";

export function countPendingProposalsInRuns(runs: AgentRun[] | undefined): number {
  return (runs ?? []).reduce(
    (total, run) => total + run.change_items.filter((item) => isPendingReviewStatus(item.status)).length,
    0
  );
}

export function firstThreadIdWithPendingProposals(
  threadIds: string[],
  runsByThreadId: Record<string, AgentRun[] | undefined>
): string | null {
  for (const threadId of threadIds) {
    if (countPendingProposalsInRuns(runsByThreadId[threadId]) > 0) {
      return threadId;
    }
  }
  return threadIds[0] ?? null;
}

export function formatImportCost(value: number | null | undefined): string {
  if (value == null) {
    return "—";
  }
  return `$${value.toFixed(4)}`;
}

export function importJobProgressPercent(job: Pick<ImportJobSummary, "total_tasks" | "completed_tasks" | "failed_tasks">): number {
  if (job.total_tasks <= 0) {
    return 0;
  }
  return Math.round(((job.completed_tasks + job.failed_tasks) / job.total_tasks) * 100);
}

export function importJobStatusLabel(status: ImportJobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function importTaskStatusLabel(status: ImportTaskStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function importJobStatusTone(status: ImportJobStatus): "default" | "success" | "warning" | "danger" {
  if (status === "completed") {
    return "success";
  }
  if (status === "running" || status === "queued") {
    return "warning";
  }
  if (status === "failed" || status === "cancelled") {
    return "danger";
  }
  return "default";
}

export function importTaskIsActive(status: ImportTaskStatus): boolean {
  return status === "running" || status === "queued";
}

export function formatImportTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
