/**
 * CALLING SPEC:
 * - Purpose: map agent thread review items into ReviewItemView for the shared TOC.
 * - Inputs: ThreadReviewItem rows from the agent review controller.
 * - Outputs: ReviewItemView instances for sidebar navigation and active cards.
 * - Side effects: none.
 */

import { buildProposalContext } from "./proposalContext";
import { buildProposalFields } from "./proposalFields";
import { buildProposalOutcome } from "./proposalOutcome";
import { buildProposalSummary } from "./proposalSummary";
import { changeTypeLabel, isPendingReviewStatus, type ThreadReviewItem } from "../agent/review/model";
import { buildReviewCardMetadata } from "./cardMetadata";
import { extractEntryTocFields } from "./entryTocFields";
import { buildTocLeafMeta, buildTocLeafTitle } from "./tocDisplay";
import type { ReviewItemView } from "./types";

export interface MapThreadReviewItemOptions {
  allItems?: ThreadReviewItem[];
}

export function mapThreadReviewItemToReviewItemView(
  reviewItem: ThreadReviewItem,
  options: MapThreadReviewItemOptions = {}
): ReviewItemView {
  const { item } = reviewItem;
  const changeType = item.change_type;
  const isPending = isPendingReviewStatus(item.status);
  const entryFields = extractEntryTocFields(changeType, item.payload_json);
  const cardTitle = buildTocLeafTitle(changeType, item.payload_json);
  const fields = buildProposalFields(changeType, item.payload_json);
  const siblingItems = options.allItems?.map((candidate) => ({
    id: candidate.item.id,
    status: candidate.item.status,
    title: buildTocLeafTitle(candidate.item.change_type, candidate.item.payload_json),
    changeType: candidate.item.change_type
  }));

  return {
    id: item.id,
    changeType: item.change_type,
    title: cardTitle,
    kicker: changeTypeLabel(changeType),
    status: item.status,
    cardMetadata: buildReviewCardMetadata(changeType, item.status),
    summary: buildProposalSummary(changeType, item.payload_json, fields),
    context: buildProposalContext(changeType, item.payload_json, {
      proposedAt: reviewItem.runCreatedAt,
      siblingItems
    }),
    outcome: buildProposalOutcome({
      status: item.status,
      reviewNote: item.review_note,
      appliedResourceType: item.applied_resource_type,
      appliedResourceId: item.applied_resource_id,
      reviewActions: item.review_actions
    }),
    fields,
    isPending,
    isResolved: !isPending,
    tocTitle: cardTitle,
    tocMeta: buildTocLeafMeta(changeType, item.payload_json),
    entryName: entryFields?.entryName,
    entryToEntity: entryFields?.entryToEntity
  };
}

export function mapThreadReviewItemsToReviewItems(items: ThreadReviewItem[]): ReviewItemView[] {
  return items.map((item) => mapThreadReviewItemToReviewItemView(item));
}
