/**
 * CALLING SPEC:
 * - Purpose: map import job aggregated proposals into ReviewItemView for the shared panel.
 * - Inputs: ImportJobAggregatedProposal rows from the import API.
 * - Outputs: ReviewItemView instances with structured diffs.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import type { ImportJobAggregatedProposal } from "../../lib/types/import";
import { buildProposalDiff } from "../agent/review/diff";
import { changeTypeLabel } from "../agent/review/model";
import type { ReviewItemView } from "./types";

function proposalSummary(proposal: ImportJobAggregatedProposal): string {
  const payload = proposal.payload_json;
  if (typeof payload.name === "string" && payload.name.trim()) {
    return payload.name;
  }
  if (typeof payload.memo === "string" && payload.memo.trim()) {
    return payload.memo;
  }
  return changeTypeLabel(proposal.change_type as AgentChangeType);
}

export function mapImportProposalToReviewItem(proposal: ImportJobAggregatedProposal): ReviewItemView {
  const changeType = proposal.change_type as AgentChangeType;
  const diff = buildProposalDiff(changeType, proposal.payload_json);
  const sources = proposal.source_task_labels.join(", ") || "No source task";
  const isPending = proposal.status === "PENDING_REVIEW";

  return {
    id: proposal.canonical_change_item_id,
    changeType: proposal.change_type,
    title: proposalSummary(proposal),
    kicker: changeTypeLabel(changeType),
    status: proposal.status,
    meta: sources,
    rationale: proposal.rationale_text,
    diff,
    isPending,
    isResolved: !isPending,
    tocMeta: sources,
    extraBadges: proposal.duplicate_count > 1 ? [`${proposal.duplicate_count} identical`] : undefined
  };
}

export function mapImportProposalsToReviewItems(proposals: ImportJobAggregatedProposal[]): ReviewItemView[] {
  return proposals.map(mapImportProposalToReviewItem);
}
