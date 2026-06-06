/**
 * CALLING SPEC:
 * - Purpose: build contextual helper lines for proposal review cards.
 * - Inputs: change type, payload_json, and optional import or thread sibling metadata.
 * - Outputs: context lines for dependencies, impact previews, and import provenance.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import { formatMinor } from "../../lib/format";
import { changeTypeLabel } from "../agent/review/model";
import type { ReviewContextLine } from "./types";

export interface ProposalContextSiblingItem {
  id: string;
  status: string;
  title: string;
  changeType: string;
}

export interface BuildProposalContextOptions {
  proposedAt?: string;
  duplicateCount?: number;
  siblingItems?: ProposalContextSiblingItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function line(text: string, tone: ReviewContextLine["tone"] = "neutral"): ReviewContextLine {
  return { text, tone };
}

function formatProposedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatSnapshotRecord(
  snapshot: Record<string, unknown> | null | undefined,
  currencyCode: string
): string | null {
  if (!snapshot) {
    return null;
  }
  const date = asText(snapshot.snapshot_at);
  const balanceMinor = typeof snapshot.balance_minor === "number" ? snapshot.balance_minor : null;
  if (!date && balanceMinor == null) {
    return null;
  }
  const balanceText = balanceMinor != null ? formatMinor(balanceMinor, currencyCode) : null;
  if (date && balanceText) {
    return `${date} (${balanceText})`;
  }
  return date || balanceText;
}

function appendImpactCountLines(lines: ReviewContextLine[], impactPreview: Record<string, unknown>): void {
  const entryCount = typeof impactPreview.entry_count === "number" ? impactPreview.entry_count : null;
  const accountCount = typeof impactPreview.account_count === "number" ? impactPreview.account_count : null;
  const snapshotCount = typeof impactPreview.snapshot_count === "number" ? impactPreview.snapshot_count : null;

  if (entryCount != null && entryCount > 0) {
    lines.push(line(`${entryCount} linked entr${entryCount === 1 ? "y" : "ies"} would be affected.`, "warning"));
  }
  if (accountCount != null && accountCount > 0) {
    lines.push(line(`${accountCount} linked account${accountCount === 1 ? "" : "s"} would be affected.`, "warning"));
  }
  if (snapshotCount != null && snapshotCount > 0) {
    lines.push(line(`${snapshotCount} account snapshot${snapshotCount === 1 ? "" : "s"} would be affected.`, "warning"));
  }
}

function appendGroupDependencyLines(
  lines: ReviewContextLine[],
  payload: Record<string, unknown>,
  siblingItems: ProposalContextSiblingItem[] | undefined
): void {
  const groupRef = asRecord(payload.group_ref);
  const proposalId = asText(groupRef.create_group_proposal_id);
  if (!proposalId || !siblingItems) {
    return;
  }

  const dependency = siblingItems.find((item) => item.id === proposalId);
  if (!dependency || dependency.status === "APPLIED") {
    return;
  }

  lines.push(
    line(
      `Depends on pending ${changeTypeLabel(dependency.changeType as AgentChangeType).toLowerCase()}: ${dependency.title}.`,
      "warning"
    )
  );
}

function appendImportLines(lines: ReviewContextLine[], options: BuildProposalContextOptions): void {
  if ((options.duplicateCount ?? 0) > 1) {
    lines.push(
      line(
        `${options.duplicateCount} identical proposals were merged into this canonical item.`,
        "warning"
      )
    );
  }
}

export function buildProposalContext(
  changeType: AgentChangeType,
  payload: Record<string, unknown>,
  options: BuildProposalContextOptions = {}
): ReviewContextLine[] {
  const lines: ReviewContextLine[] = [];
  const impactPreview = asRecord(payload.impact_preview);
  const currencyCode = asText(payload.currency_code, "USD");

  if (options.proposedAt) {
    lines.push(line(`Proposed ${formatProposedAt(options.proposedAt)}.`));
  }

  appendImportLines(lines, options);
  appendGroupDependencyLines(lines, payload, options.siblingItems);

  if (changeType === "delete_snapshot" && Object.keys(impactPreview).length > 0) {
    const previous = formatSnapshotRecord(asRecord(impactPreview.previous_snapshot), currencyCode);
    const next = formatSnapshotRecord(asRecord(impactPreview.next_snapshot), currencyCode);
    lines.push(line(previous ? `Previous snapshot: ${previous}.` : "Previous snapshot: none."));
    lines.push(line(next ? `Next snapshot: ${next}.` : "Next snapshot: none."));
    lines.push(
      line("Deleting this snapshot changes the reconciliation intervals on either side.", "warning")
    );
  }

  if (
    (changeType === "delete_account" ||
      changeType === "delete_entity" ||
      changeType === "delete_group" ||
      changeType === "delete_tag") &&
    Object.keys(impactPreview).length > 0
  ) {
    appendImpactCountLines(lines, impactPreview);
  }

  return lines;
}
