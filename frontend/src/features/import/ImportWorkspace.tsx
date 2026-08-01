/**
 * CALLING SPEC:
 * - Purpose: orchestrate the Import tab as a full-height master-detail split (jobs rail + create/detail pane).
 * - Inputs: none; uses routed page shell context.
 * - Outputs: Import tab UI with persistent jobs rail and selectable job detail.
 * - Side effects: import job list/detail queries.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { EmptyState } from "../../components/layout/EmptyState";
import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { listImportJobs } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { ImportJobSummary } from "../../lib/types";
import { cn } from "../../lib/utils";
import { ImportCreatePanel } from "./ImportCreatePanel";
import { ImportJobDetailView } from "./ImportJobDetailView";
import { ImportTaskDialog, type ImportTaskConversationTarget } from "./ImportTaskDialog";
import {
  formatImportCost,
  formatImportTimestamp,
  importJobStatusLabel,
  importJobStatusTone
} from "./importHelpers";

function ImportJobListRow({
  job,
  selected,
  onOpen
}: {
  job: ImportJobSummary;
  selected: boolean;
  onOpen: (jobId: string) => void;
}) {
  const tone = importJobStatusTone(job.status);
  const failedLabel = job.failed_tasks > 0 ? ` · ${job.failed_tasks} failed` : "";

  return (
    <button
      type="button"
      className={cn("import-job-row", selected && "is-selected")}
      onClick={() => onOpen(job.id)}
      aria-current={selected ? "true" : undefined}
    >
      <div className="import-job-row-top">
        <p className="import-job-row-title">{job.title ?? "Import job"}</p>
        <Badge variant="outline" className={cn("import-status-badge", `import-status-badge-${tone}`)}>
          {importJobStatusLabel(job.status)}
        </Badge>
      </div>
      <p className="import-job-row-meta">
        <span>
          {job.completed_tasks}/{job.total_tasks}
          {failedLabel}
        </span>
        <span>{formatImportCost(job.aggregate_total_cost_usd)}</span>
        <span>{formatImportTimestamp(job.created_at)}</span>
      </p>
    </button>
  );
}

export function ImportWorkspace() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ImportTaskConversationTarget | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);

  const jobsQuery = useQuery({
    queryKey: queryKeys.import.jobs,
    queryFn: listImportJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      return jobs.some((job) => job.status === "running" || job.status === "queued") ? 3000 : false;
    }
  });

  const jobs = jobsQuery.data ?? [];

  function openJob(jobId: string) {
    setSelectedJobId(jobId);
  }

  function openCreate() {
    setSelectedJobId(null);
  }

  function openTask(task: ImportTaskConversationTarget) {
    setSelectedTask(task);
    setTaskDialogOpen(true);
  }

  return (
    <div className="page import-page">
      <div className="import-split">
        <WorkspaceSection
          className="import-jobs-section"
          title="Jobs"
          actions={
            <Button type="button" variant={selectedJobId ? "default" : "secondary"} size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New import
            </Button>
          }
          contentClassName="import-jobs-section-body"
        >
          {jobsQuery.isLoading ? <p className="muted text-sm">Loading jobs…</p> : null}
          {jobs.length > 0 ? (
            <ul className="import-job-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <ImportJobListRow job={job} selected={job.id === selectedJobId} onOpen={openJob} />
                </li>
              ))}
            </ul>
          ) : null}
          {jobs.length === 0 && !jobsQuery.isLoading ? (
            <EmptyState className="import-empty-state" title="No jobs yet" description="Started imports appear here." />
          ) : null}
        </WorkspaceSection>

        <div className="import-main">
          {selectedJobId ? (
            <ImportJobDetailView jobId={selectedJobId} onOpenTask={openTask} />
          ) : (
            <ImportCreatePanel
              onJobCreated={(jobId) => {
                setSelectedJobId(jobId);
              }}
              onOpenPriorImport={openTask}
            />
          )}
        </div>
      </div>

      <ImportTaskDialog task={selectedTask} open={taskDialogOpen} onOpenChange={setTaskDialogOpen} />
    </div>
  );
}
