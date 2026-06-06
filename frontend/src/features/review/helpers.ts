/**
 * CALLING SPEC:
 * - Purpose: shared CSS class helpers and TOC grouping for the review panel.
 * - Inputs: change types, review statuses, and ReviewItemView lists.
 * - Outputs: class name fragments, TOC groups, and navigation helpers.
 * - Side effects: none.
 */

import { AlertTriangle, Check, CheckCheck, type LucideIcon, X } from "lucide-react";

import type { AgentChangeStatus, AgentChangeType } from "../../lib/types";
import { proposalTocGroupKey, type ProposalTocGroupKey } from "../agent/review/model";
import type { ReviewItemView } from "./types";

export interface TocProposalGroup {
  key: ProposalTocGroupKey;
  label: string;
  items: ReviewItemView[];
}

const TOC_GROUP_LABELS: Record<ProposalTocGroupKey, string> = {
  account: "Accounts",
  snapshot: "Snapshots",
  entity: "Entities",
  tag: "Tags",
  group: "Groups",
  entry: "Entries",
  group_member: "Group members"
};

const TOC_GROUP_ORDER: ProposalTocGroupKey[] = [
  "account",
  "snapshot",
  "entity",
  "tag",
  "group",
  "entry",
  "group_member"
];

export function reviewModeClass(changeType: string): string {
  if (changeType.startsWith("create_")) {
    return "is-create";
  }
  if (changeType.startsWith("update_")) {
    return "is-update";
  }
  if (changeType.startsWith("delete_")) {
    return "is-delete";
  }
  return "is-snapshot";
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case "PENDING_REVIEW":
      return "agent-review-status-pending";
    case "APPROVED":
      return "agent-review-status-approved";
    case "APPLIED":
      return "agent-review-status-applied";
    case "REJECTED":
      return "agent-review-status-rejected";
    case "APPLY_FAILED":
      return "agent-review-status-failed";
    default:
      return "";
  }
}

export interface TocStatusIndicator {
  className: string;
  icon: LucideIcon;
  label: string;
}

export function tocStatusIndicator(status: string): TocStatusIndicator | null {
  switch (status as AgentChangeStatus) {
    case "APPROVED":
      return { className: "is-approved", icon: Check, label: "Approved" };
    case "APPLIED":
      return { className: "is-applied", icon: CheckCheck, label: "Applied" };
    case "REJECTED":
      return { className: "is-rejected", icon: X, label: "Rejected" };
    case "APPLY_FAILED":
      return { className: "is-failed", icon: AlertTriangle, label: "Apply failed" };
    default:
      return null;
  }
}

export function isPendingReviewStatus(status: string): boolean {
  return status === "PENDING_REVIEW";
}

export function findRelativeReviewItemId<T extends { id: string }>(
  items: T[],
  currentItemId: string | null,
  delta: number
): string | null {
  if (items.length === 0) {
    return null;
  }
  if (!currentItemId) {
    return items[0]?.id ?? null;
  }
  const currentIndex = items.findIndex((item) => item.id === currentItemId);
  if (currentIndex < 0) {
    return items[0]?.id ?? null;
  }
  const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
  return items[nextIndex]?.id ?? null;
}

export function groupReviewItemsByChangeType(items: ReviewItemView[]): TocProposalGroup[] {
  const grouped: Record<ProposalTocGroupKey, ReviewItemView[]> = {
    entry: [],
    account: [],
    snapshot: [],
    entity: [],
    tag: [],
    group: [],
    group_member: []
  };
  for (const item of items) {
    grouped[proposalTocGroupKey(item.changeType as AgentChangeType)].push(item);
  }
  return TOC_GROUP_ORDER.map((key) => ({
    key,
    label: TOC_GROUP_LABELS[key],
    items: grouped[key]
  })).filter((group) => group.items.length > 0);
}
