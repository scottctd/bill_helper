/**
 * CALLING SPEC:
 * - Purpose: render job-level aggregated proposal review using the shared review panel.
 * - Inputs: import job id/title, open state, and refresh callback.
 * - Outputs: deduped proposal review with structured diffs and batch controls.
 * - Side effects: import proposal list queries and crash-safe batch review mutations.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  batchApproveImportJobProposals,
  batchRejectImportJobProposals,
  listImportJobProposals
} from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { ImportJobBatchApplyResponse } from "../../lib/types";
import { ReviewPanel } from "../review/ReviewPanel";
import { ReviewReadOnlyCard } from "../review/ReviewReadOnlyCard";
import { ReviewTocSection } from "../review/ReviewTocSection";
import { findRelativeReviewItemId } from "../review/helpers";
import { mapImportProposalsToReviewItems } from "../review/mapImportProposal";

interface ImportJobReviewModalProps {
  open: boolean;
  jobId: string;
  jobTitle: string | null;
  onOpenChange: (open: boolean) => void;
  onMutationComplete: () => void;
}

function resultSummary(result: ImportJobBatchApplyResponse | null): string | null {
  if (!result) {
    return null;
  }
  return `${result.applied_count} applied · ${result.failed_count} failed`;
}

export function ImportJobReviewModal({
  open,
  jobId,
  jobTitle,
  onOpenChange,
  onMutationComplete
}: ImportJobReviewModalProps) {
  const [lastResult, setLastResult] = useState<ImportJobBatchApplyResponse | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const proposalsQuery = useQuery({
    queryKey: queryKeys.import.proposals(jobId),
    queryFn: () => listImportJobProposals(jobId),
    enabled: open
  });

  const proposals = proposalsQuery.data ?? [];
  const items = useMemo(() => mapImportProposalsToReviewItems(proposals), [proposals]);
  const pendingItems = useMemo(() => items.filter((item) => item.isPending), [items]);
  const resolvedItems = useMemo(() => items.filter((item) => item.isResolved), [items]);

  const totalDuplicateCount = useMemo(
    () => proposals.reduce((sum, proposal) => sum + Math.max(proposal.duplicate_count - 1, 0), 0),
    [proposals]
  );

  useEffect(() => {
    if (!open || items.length === 0) {
      setActiveItemId(null);
      return;
    }
    setActiveItemId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null));
  }, [open, items]);

  const activeItem = items.find((item) => item.id === activeItemId) ?? null;

  const finishMutation = (result: ImportJobBatchApplyResponse) => {
    setLastResult(result);
    void proposalsQuery.refetch();
    onMutationComplete();
  };

  const approveMutation = useMutation({
    mutationFn: (changeItemIds?: string[]) => batchApproveImportJobProposals(jobId, changeItemIds),
    onSuccess: finishMutation
  });

  const rejectMutation = useMutation({
    mutationFn: (changeItemIds?: string[]) => batchRejectImportJobProposals(jobId, changeItemIds),
    onSuccess: finishMutation
  });

  const isBusy = approveMutation.isPending || rejectMutation.isPending;
  const resultText = resultSummary(lastResult);
  const hasProposals = proposals.length > 0;

  const header = (
    <DialogHeader className="agent-review-modal-header">
      <div className="agent-review-header-copy">
        <DialogTitle>{jobTitle ?? "Import job"} — Aggregated review</DialogTitle>
        <DialogDescription>
          {proposals.length} canonical proposal{proposals.length === 1 ? "" : "s"}
          {totalDuplicateCount > 0
            ? ` · ${totalDuplicateCount} merged duplicate${totalDuplicateCount === 1 ? "" : "s"}`
            : ""}
        </DialogDescription>
      </div>
      <div className="agent-review-header-stats">
        <Badge variant="outline" className="agent-review-header-pill">
          Pending {pendingItems.length}
        </Badge>
        <Badge variant="outline" className="agent-review-header-pill">
          {resolvedItems.length > 0 ? `Reviewed ${resolvedItems.length}` : `Total ${items.length}`}
        </Badge>
      </div>
    </DialogHeader>
  );

  const controls = (
    <div className="agent-review-controls-bar">
      <div className="agent-review-controls-group">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="agent-review-sidebar-toggle"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
          aria-controls="agent-review-sidebar"
          aria-expanded={!isSidebarCollapsed}
        >
          {isSidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {isSidebarCollapsed ? "Show list" : "Hide list"}
        </Button>
        <Button type="button" size="sm" onClick={() => approveMutation.mutate(undefined)} disabled={isBusy || !hasProposals}>
          {isBusy ? "Working…" : "Approve All"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => rejectMutation.mutate(undefined)}
          disabled={isBusy || !hasProposals}
        >
          {isBusy ? "Working…" : "Reject All"}
        </Button>
      </div>

      <div className="agent-review-controls-group agent-review-controls-nav">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveItemId((current) => findRelativeReviewItemId(items, current, -1))}
          disabled={items.length <= 1}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveItemId((current) => findRelativeReviewItemId(items, current, 1))}
          disabled={items.length <= 1}
        >
          Next
        </Button>
      </div>

      {activeItem?.isPending ? (
        <div className="agent-review-controls-group agent-review-controls-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => rejectMutation.mutate([activeItem.id])}
            disabled={isBusy}
          >
            Reject
          </Button>
          <Button type="button" onClick={() => approveMutation.mutate([activeItem.id])} disabled={isBusy}>
            Approve
          </Button>
        </div>
      ) : null}
    </div>
  );

  const sidebar = (
    <>
      <ReviewTocSection title="Pending" items={pendingItems} activeItemId={activeItemId} onSelect={setActiveItemId} />
      <ReviewTocSection
        title="Reviewed / Failed"
        items={resolvedItems}
        activeItemId={activeItemId}
        onSelect={setActiveItemId}
      />
    </>
  );

  const activeCard = proposalsQuery.isLoading ? (
    <div className="agent-review-empty-card">
      <p className="muted text-sm">Loading proposals…</p>
    </div>
  ) : activeItem ? (
    <ReviewReadOnlyCard
      itemKey={activeItem.id}
      changeType={activeItem.changeType}
      kicker={activeItem.kicker}
      title={activeItem.title}
      status={activeItem.status}
      runMeta={activeItem.meta}
      rationale={activeItem.rationale}
      diff={activeItem.diff}
      extraBadges={activeItem.extraBadges}
    />
  ) : (
    <div className="agent-review-empty-card">
      <p className="muted">{items.length === 0 ? "No pending import proposals." : "Select a proposal to review."}</p>
    </div>
  );

  const footer = (
    <footer className="agent-review-modal-footer">
      <p className="agent-review-footer-pending">
        Pending {pendingItems.length} of {items.length}
        {activeItem ? ` · ${activeItem.kicker}` : ""}
      </p>
      {resultText ? <p className="muted agent-review-footer-message">{resultText}</p> : null}
    </footer>
  );

  return (
    <ReviewPanel
      open={open}
      onOpenChange={onOpenChange}
      dialogContentClassName="import-job-review-dialog"
      isSidebarCollapsed={isSidebarCollapsed}
      header={header}
      controls={controls}
      sidebar={sidebar}
      activeCard={activeCard}
      footer={footer}
    />
  );
}
