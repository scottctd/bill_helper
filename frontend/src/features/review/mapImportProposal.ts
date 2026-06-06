/**
 * CALLING SPEC:
 * - Purpose: map import job aggregated proposals into ReviewItemView for the shared panel.
 * - Inputs: ImportJobAggregatedProposal rows from the import API.
 * - Outputs: ReviewItemView instances with summary, context, and field details.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import type { ImportJobAggregatedProposal } from "../../lib/types/import";
import { buildProposalContext } from "./proposalContext";
import { buildProposalFields } from "./proposalFields";
import { buildProposalOutcome } from "./proposalOutcome";
import { buildProposalSummary } from "./proposalSummary";
import { changeTypeLabel } from "../agent/review/model";
import { extractEntryTocFields } from "./entryTocFields";
import { buildReviewCardMetadata } from "./cardMetadata";
import { buildTocLeafMeta, buildTocLeafTitle } from "./tocDisplay";
import type { ReviewCardMetadataEntry, ReviewItemView } from "./types";

function buildImportSourceMetadata(proposal: ImportJobAggregatedProposal): ReviewCardMetadataEntry[] {
  const sourceTaskIds = proposal.source_task_ids ?? [];
  const sourceTaskLabels = proposal.source_task_labels ?? [];
  const links = sourceTaskIds
    .map((taskId, index) => ({
      taskId,
      label: sourceTaskLabels[index]?.trim() || taskId
    }))
    .filter((link) => link.taskId && link.label);

  if (links.length === 0) {
    return [];
  }

  return [
    {
      key: "Source",
      value: links.map((link) => link.label).join(", "),
      links
    }
  ];
}

export function mapImportProposalToReviewItem(proposal: ImportJobAggregatedProposal): ReviewItemView {
  const changeType = proposal.change_type as AgentChangeType;
  const fields = buildProposalFields(changeType, proposal.payload_json);
  const isPending = proposal.status === "PENDING_REVIEW";
  const entryFields = extractEntryTocFields(changeType, proposal.payload_json);
  const cardTitle = buildTocLeafTitle(changeType, proposal.payload_json);

  return {
    id: proposal.canonical_change_item_id,
    changeType: proposal.change_type,
    title: cardTitle,
    kicker: changeTypeLabel(changeType),
    status: proposal.status,
    cardMetadata: [
      ...buildReviewCardMetadata(changeType, proposal.status),
      ...buildImportSourceMetadata(proposal)
    ],
    summary: buildProposalSummary(changeType, proposal.payload_json, fields),
    context: buildProposalContext(changeType, proposal.payload_json, {
      duplicateCount: proposal.duplicate_count
    }),
    outcome: buildProposalOutcome({
      status: proposal.status,
      reviewNote: null,
      appliedResourceType: null,
      appliedResourceId: null
    }),
    fields,
    isPending,
    isResolved: !isPending,
    tocTitle: cardTitle,
    tocMeta: buildTocLeafMeta(changeType, proposal.payload_json),
    entryName: entryFields?.entryName,
    entryToEntity: entryFields?.entryToEntity
  };
}

export function mapImportProposalsToReviewItems(proposals: ImportJobAggregatedProposal[]): ReviewItemView[] {
  return proposals.map(mapImportProposalToReviewItem);
}
