/**
 * CALLING SPEC:
 * - Purpose: build the hierarchical review TOC tree from normalized review items.
 * - Inputs: ReviewItemView lists partitioned by review status.
 * - Outputs: status → proposal-type → entry-destination tree nodes.
 * - Side effects: none.
 */

import type { ProposalTocGroupKey } from "../agent/review/model";
import { groupReviewItemsByChangeType } from "./helpers";
import type { ReviewItemView } from "./types";

export interface ReviewTocEntryDestinationGroup {
  key: string;
  label: string;
  count: number;
  items: ReviewItemView[];
}

export interface ReviewTocTypeGroup {
  key: ProposalTocGroupKey;
  label: string;
  count: number;
  items: ReviewItemView[];
  destinationGroups: ReviewTocEntryDestinationGroup[] | null;
}

export interface ReviewTocStatusSection {
  key: "pending" | "resolved";
  label: string;
  count: number;
  typeGroups: ReviewTocTypeGroup[];
}

function compareEntryItems(left: ReviewItemView, right: ReviewItemView): number {
  const nameComparison = (left.entryName ?? left.title).localeCompare(right.entryName ?? right.title, undefined, {
    sensitivity: "base"
  });
  if (nameComparison !== 0) {
    return nameComparison;
  }
  return left.id.localeCompare(right.id);
}

function groupEntryItemsByDestination(items: ReviewItemView[]): ReviewTocEntryDestinationGroup[] {
  const grouped = new Map<string, ReviewItemView[]>();

  for (const item of items) {
    const destination = item.entryToEntity?.trim() || "Unknown destination";
    const bucket = grouped.get(destination) ?? [];
    bucket.push(item);
    grouped.set(destination, bucket);
  }

  return Array.from(grouped.entries())
    .sort(([leftLabel], [rightLabel]) => leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" }))
    .map(([label, bucketItems]) => ({
      key: label.toLowerCase(),
      label,
      count: bucketItems.length,
      items: [...bucketItems].sort(compareEntryItems)
    }));
}

function buildTypeGroups(items: ReviewItemView[]): ReviewTocTypeGroup[] {
  return groupReviewItemsByChangeType(items).map((group) => {
    if (group.key !== "entry") {
      return {
        key: group.key,
        label: group.label,
        count: group.items.length,
        items: group.items,
        destinationGroups: null
      };
    }

    const destinationGroups = groupEntryItemsByDestination(group.items);
    return {
      key: group.key,
      label: group.label,
      count: group.items.length,
      items: [],
      destinationGroups
    };
  });
}

function buildStatusSection(
  key: ReviewTocStatusSection["key"],
  label: string,
  items: ReviewItemView[]
): ReviewTocStatusSection | null {
  if (items.length === 0) {
    return null;
  }
  return {
    key,
    label,
    count: items.length,
    typeGroups: buildTypeGroups(items)
  };
}

export function buildReviewTocTree(items: ReviewItemView[]): ReviewTocStatusSection[] {
  const pendingItems = items.filter((item) => item.isPending);
  const resolvedItems = items.filter((item) => item.isResolved);

  return [
    buildStatusSection("pending", "Pending", pendingItems),
    buildStatusSection("resolved", "Reviewed / Failed", resolvedItems)
  ].filter((section): section is ReviewTocStatusSection => section != null);
}
