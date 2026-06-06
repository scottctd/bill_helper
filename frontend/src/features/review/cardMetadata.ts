/**
 * CALLING SPEC:
 * - Purpose: assemble review detail card metadata rows for shared header rendering.
 * - Inputs: change type, status, and optional supplier-specific metadata entries.
 * - Outputs: ordered key-value metadata rows (Type, Status, then supplier rows).
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import { changeTypeLabel } from "../agent/review/model";
import type { ReviewCardMetadataEntry } from "./types";

function metadataText(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function buildReviewCardMetadata(
  changeType: string,
  status: string,
  supplierMetadata: ReviewCardMetadataEntry[] = []
): ReviewCardMetadataEntry[] {
  const supplierRows = supplierMetadata
    .map((entry) => ({ key: metadataText(entry.key), value: metadataText(entry.value) }))
    .filter((entry) => entry.key && entry.value);

  return [
    { key: "Type", value: metadataText(changeTypeLabel(changeType as AgentChangeType), changeType) },
    { key: "Status", value: metadataText(status, "UNKNOWN") },
    ...supplierRows
  ];
}
