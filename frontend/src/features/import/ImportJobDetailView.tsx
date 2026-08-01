/**
 * CALLING SPEC:
 * - Purpose: render import job progress, task table, and shared proposal review entry.
 * - Inputs: selected job id and task/review dialog callbacks.
 * - Outputs: job detail workspace with live polling.
 * - Side effects: import job queries, agent thread queries, and review mutations.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, MessageSquareText } from "lucide-react";

import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { cancelImportJob, getImportJob, listImportJobProposals, retryFailedImportTasks } from "../../lib/api";
import { invalidateImportReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import type { ImportTask } from "../../lib/types";
import { cn } from "../../lib/utils";
import { ImportJobReviewModal } from "./ImportJobReviewModal";
import {
  formatImportCost,
  formatImportTimestamp,
  importJobProgressPercent,
  importJobStatusLabel,
  importJobStatusTone,
  importTaskIsActive,
  importTaskStatusLabel
} from "./importHelpers";

interface ImportJobDetailProps {
  jobId: string;
  onOpenTask: (task: ImportTask) => void;
}

export function ImportJobDetailView({ jobId, onOpenTask }: ImportJobDetailProps) {
  const queryClient = useQueryClient();
  const [reviewOpen, setReviewOpen] = useState(false);

  const jobQuery = useQuery({
    queryKey: queryKeys.import.job(jobId),
    queryFn: () => getImportJob(jobId),
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) {
        return false;
      }
      return job.status === "running" || job.status === "queued" ? 2000 : false;
    }
  });

  const job = jobQuery.data;
  const proposalsQuery = useQuery({
    queryKey: queryKeys.import.proposals(jobId),
    queryFn: () => listImportJobProposals(jobId),
    enabled: Boolean(job),
    refetchInterval: (query) => {
      const hasPending = (query.state.data ?? []).length > 0;
      return hasPending || job?.status === "running" || job?.status === "queued" ? 3000 : false;
    }
  });

  const proposalCount = proposalsQuery.data?.length ?? 0;

  const invalidateJobReadModels = () => {
    invalidateImportReadModels(queryClient, {
      jobId,
      threadIds: job?.tasks.map((task) => task.thread_id) ?? [],
      invalidateEntries: true
    });
  };

  const cancelMutation = useMutation({
    mutationFn: () => cancelImportJob(jobId),
    onSuccess: invalidateJobReadModels
  });

  const retryMutation = useMutation({
    mutationFn: () => retryFailedImportTasks(jobId),
    onSuccess: invalidateJobReadModels
  });

  const progressPercent = job ? importJobProgressPercent(job) : 0;
  const statusTone = job ? importJobStatusTone(job.status) : "default";

  const sectionDescription = useMemo(() => {
    if (!job) {
      return null;
    }
    const failed = job.failed_tasks > 0 ? ` · ${job.failed_tasks} failed` : "";
    return `${formatImportTimestamp(job.created_at)} · ${job.completed_tasks}/${job.total_tasks} tasks${failed} · ${formatImportCost(job.aggregate_total_cost_usd)}`;
  }, [job]);

  if (!job) {
    return jobQuery.isLoading ? <p className="muted text-sm">Loading import job…</p> : null;
  }

  function openJobReview() {
    setReviewOpen(true);
  }

  return (
    <>
      <WorkspaceSection
        className="import-job-detail-section"
        contentClassName="import-job-detail-body"
        title={job.title ?? "Import job"}
        description={sectionDescription ?? undefined}
        actions={
          <div className="import-job-detail-actions">
            <Badge variant="outline" className={cn("import-status-badge", `import-status-badge-${statusTone}`)}>
              {importJobStatusLabel(job.status)}
            </Badge>
            {proposalCount > 0 ? (
              <Button
                type="button"
                size="sm"
                className={cn("agent-panel-review-button", "is-pending")}
                onClick={openJobReview}
              >
                <span>Review</span>
                <Badge variant="outline" className="agent-panel-review-badge">
                  {proposalCount}
                </Badge>
              </Button>
            ) : null}
            {job.status === "running" || job.status === "queued" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                Cancel
              </Button>
            ) : null}
            {job.failed_tasks > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                Retry failed
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="import-job-detail-progress" aria-label={`Progress ${progressPercent}%`}>
          <div className="import-job-progress import-job-progress-large" aria-hidden="true">
            <div className="import-job-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="import-job-detail-progress-meta muted text-sm">
            {progressPercent}%
            {job.model_name ? ` · ${job.model_name}` : ""}
            {job.concurrency ? ` · ${job.concurrency} workers` : ""}
          </p>
        </div>

        <div className="table-shell">
          <div className="table-shell-header">
            <div>
              <h3 className="table-shell-title">Tasks</h3>
              <p className="table-shell-subtitle">Open a task conversation.</p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead className="import-task-actions-head">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {job.tasks.map((task) => {
                const isRunning = importTaskIsActive(task.status);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="import-task-source-cell">
                      <span className="import-task-source-label">{task.source_label}</span>
                      {task.error_text ? <p className="import-task-error text-sm">{task.error_text}</p> : null}
                    </TableCell>
                    <TableCell>
                      <span className="import-task-status-inline">
                        {importTaskStatusLabel(task.status)}
                        {isRunning ? <LoaderCircle className="import-task-spinner" aria-hidden="true" /> : null}
                      </span>
                    </TableCell>
                    <TableCell>{formatImportCost(task.latest_run?.total_cost_usd)}</TableCell>
                    <TableCell>
                      <div className="table-actions">
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenTask(task)}>
                          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                          Conversation
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {job.instructions ? (
          <details className="import-instructions-details">
            <summary>Instructions</summary>
            <p className="import-instructions-text">{job.instructions}</p>
          </details>
        ) : null}
      </WorkspaceSection>

      <ImportJobReviewModal
        open={reviewOpen}
        jobId={jobId}
        jobTitle={job.title}
        onOpenChange={setReviewOpen}
        onMutationComplete={invalidateJobReadModels}
        onOpenSourceTask={(taskId) => {
          const task = job.tasks.find((candidate) => candidate.id === taskId);
          if (!task) {
            return;
          }
          setReviewOpen(false);
          onOpenTask(task);
        }}
      />
    </>
  );
}
