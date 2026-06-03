/**
 * CALLING SPEC:
 * - Purpose: orchestrate the Import tab workspace (create flow, job list, job detail).
 * - Inputs: none; uses routed page shell context.
 * - Outputs: full Import tab UI aligned with other workspace pages.
 * - Side effects: import job list/detail queries.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, DollarSign, FolderInput, Sparkles } from "lucide-react";

import { EmptyState } from "../../components/layout/EmptyState";
import { StatBlock } from "../../components/layout/StatBlock";
import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { listImportJobs } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { ImportJobSummary, ImportTask } from "../../lib/types";
import { cn } from "../../lib/utils";
import { ImportCreatePanel } from "./ImportCreatePanel";
import { ImportJobDetailView } from "./ImportJobDetailView";
import { ImportTaskDialog, type ImportTaskConversationTarget } from "./ImportTaskDialog";
import {
  formatImportCost,
  formatImportTimestamp,
  importJobProgressPercent,
  importJobStatusLabel,
  importJobStatusTone
} from "./importHelpers";

type ImportView = "overview" | "detail";

function ImportJobListRow({
  job,
  onOpen
}: {
  job: ImportJobSummary;
  onOpen: (jobId: string) => void;
}) {
  const progress = importJobProgressPercent(job);
  const tone = importJobStatusTone(job.status);
  const isActive = job.status === "running" || job.status === "queued";

  return (
    <button type="button" className={cn("import-job-row", isActive && "is-active")} onClick={() => onOpen(job.id)}>
      <div className="import-job-row-top">
        <div className="import-job-row-main">
          <p className="import-job-row-title">{job.title ?? "Import job"}</p>
          <p className="import-job-row-meta">
            <span>{formatImportTimestamp(job.created_at)}</span>
            <span>{job.concurrency} workers</span>
          </p>
        </div>
        <Badge variant="outline" className={cn("import-status-badge", `import-status-badge-${tone}`)}>
          {importJobStatusLabel(job.status)}
        </Badge>
      </div>

      <p className="import-job-row-model">{job.model_name}</p>

      <div className="import-job-row-stats">
        <span>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          {job.completed_tasks}/{job.total_tasks} tasks
        </span>
        <span>{job.failed_tasks > 0 ? `${job.failed_tasks} failed` : "OK"}</span>
        <span>
          <DollarSign className="h-3.5 w-3.5" aria-hidden="true" />
          {formatImportCost(job.aggregate_total_cost_usd)}
        </span>
      </div>
      <div className="import-job-progress" aria-hidden="true">
        <div className="import-job-progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </button>
  );
}

export function ImportWorkspace() {
  const [view, setView] = useState<ImportView>("overview");
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
  const summary = useMemo(() => {
    const active = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
    const completed = jobs.filter((job) => job.status === "completed").length;
    const totalCost = jobs.reduce((sum, job) => sum + (job.aggregate_total_cost_usd ?? 0), 0);
    return { active, completed, totalCost, total: jobs.length };
  }, [jobs]);

  function openJob(jobId: string) {
    setSelectedJobId(jobId);
    setView("detail");
  }

  function openTask(task: ImportTaskConversationTarget) {
    setSelectedTask(task);
    setTaskDialogOpen(true);
  }

  return (
    <div className="page import-page">
      {view === "detail" ? (
        <div className="import-detail-nav">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setView("overview");
              setSelectedJobId(null);
            }}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to jobs
          </Button>
        </div>
      ) : (
        <WorkspaceToolbar className="import-workspace-toolbar workspace-table-toolbar">
          <div className="import-workspace-toolbar-copy">
            <div className="import-toolbar-icon" aria-hidden="true">
              <FolderInput className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="import-toolbar-title">Import command center</p>
              <p className="import-toolbar-subtitle">Start a durable worker pool and watch task conversations as they run.</p>
            </div>
          </div>
        </WorkspaceToolbar>
      )}

      {view === "overview" ? (
        <div className="import-overview-grid">
          <div className="import-overview-primary">
            <div className="import-summary-grid" aria-label="Import summary">
              <StatBlock label="Jobs" value={summary.total} detail={`${summary.active} active`} />
              <StatBlock label="Completed" value={summary.completed} tone="success" />
              <StatBlock label="Total spend" value={formatImportCost(summary.totalCost)} detail="All jobs" />
            </div>
            <ImportCreatePanel onJobCreated={(jobId) => {
              setSelectedJobId(jobId);
              setView("detail");
            }} onOpenPriorImport={openTask} />
          </div>

          <WorkspaceSection
            className="import-jobs-section"
            title="Jobs"
            description="Recent worker pools and their aggregate cost."
            contentClassName="import-jobs-section-body"
            actions={
              summary.active > 0 ? (
                <Badge variant="outline" className="import-active-badge">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {summary.active} active
                </Badge>
              ) : null
            }
          >
            {jobsQuery.isLoading ? <p className="muted text-sm">Loading jobs…</p> : null}
            {jobs.length > 0 ? (
              <ul className="import-job-list">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <ImportJobListRow job={job} onOpen={openJob} />
                  </li>
                ))}
              </ul>
            ) : null}
            {jobs.length === 0 && !jobsQuery.isLoading ? (
              <EmptyState
                className="import-empty-state"
                title="No jobs yet"
                description="The next import you start will appear here with progress, failures, and spend."
                actions={
                  <span className="import-empty-inline muted text-sm">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                    Waiting for the first job
                  </span>
                }
              />
            ) : null}
          </WorkspaceSection>
        </div>
      ) : null}

      {view === "detail" && selectedJobId ? <ImportJobDetailView jobId={selectedJobId} onOpenTask={openTask} /> : null}

      <ImportTaskDialog task={selectedTask} open={taskDialogOpen} onOpenChange={setTaskDialogOpen} />
    </div>
  );
}
