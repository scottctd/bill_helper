/**
 * CALLING SPEC:
 * - Purpose: build outcome lines for resolved proposal review cards.
 * - Inputs: review status, notes, applied resource metadata, and review actions.
 * - Outputs: labeled outcome rows for non-pending proposals, including apply-failure code blocks.
 * - Side effects: none.
 */

import type { AgentReviewAction } from "../../lib/types";
import { isPendingReviewStatus } from "../agent/review/model";
import type { ReviewOutcomeLine } from "./types";

export interface BuildProposalOutcomeInput {
  status: string;
  reviewNote: string | null;
  appliedResourceType: string | null;
  appliedResourceId: string | null;
  reviewActions?: AgentReviewAction[];
}

function formatStatusLabel(status: string): string {
  switch (status) {
    case "APPLIED":
      return "Applied";
    case "REJECTED":
      return "Rejected";
    case "APPLY_FAILED":
      return "Apply failed";
    case "APPROVED":
      return "Approved";
    default:
      return status;
  }
}

function formatReviewAction(action: AgentReviewAction): string {
  const verb = action.action === "approve" ? "Approved" : "Rejected";
  const note = action.note?.trim();
  return note ? `${verb} by ${action.actor} — ${note}` : `${verb} by ${action.actor}`;
}

function parseReviewNote(reviewNote: string | null): { failureDetail: string | null; cleanNote: string | null } {
  if (!reviewNote?.trim()) {
    return { failureDetail: null, cleanNote: null };
  }

  const parts = reviewNote.split("|").map((part) => part.trim()).filter(Boolean);
  let failureDetail: string | null = null;
  const noteParts: string[] = [];

  for (const part of parts) {
    const match = part.match(/^apply failed:\s*(.+)$/i);
    if (match) {
      failureDetail = match[1].trim();
      continue;
    }
    noteParts.push(part);
  }

  return {
    failureDetail,
    cleanNote: noteParts.length > 0 ? noteParts.join(" | ") : null
  };
}

export function buildProposalOutcome(input: BuildProposalOutcomeInput): ReviewOutcomeLine[] {
  if (isPendingReviewStatus(input.status as never)) {
    return [];
  }

  const { failureDetail, cleanNote } = parseReviewNote(input.reviewNote);
  const lines: ReviewOutcomeLine[] = [{ label: "Result", value: formatStatusLabel(input.status) }];

  if (input.appliedResourceType && input.appliedResourceId) {
    lines.push({
      label: "Applied resource",
      value: `${input.appliedResourceType} #${input.appliedResourceId}`
    });
  }

  if (failureDetail) {
    lines.push({
      label: "Apply failure",
      value: failureDetail,
      kind: "code"
    });
  }

  if (cleanNote) {
    lines.push({ label: "Review note", value: cleanNote });
  }

  const latestAction = [...(input.reviewActions ?? [])].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  )[0];
  if (latestAction) {
    lines.push({ label: "Last action", value: formatReviewAction(latestAction) });
  }

  if (input.status === "APPLY_FAILED" && !failureDetail && !cleanNote) {
    lines.push({
      label: "Apply failure",
      value: "Apply failed before a detailed error was recorded.",
      kind: "code"
    });
  }

  return lines;
}
