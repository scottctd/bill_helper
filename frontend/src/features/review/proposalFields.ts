/**
 * CALLING SPEC:
 * - Purpose: build compact read-only field rows for proposal review cards.
 * - Inputs: agent change type and proposal payload_json.
 * - Outputs: ProposalFields with create, update (before → after), or delete rows.
 * - Side effects: none.
 */

import type { AgentChangeType } from "../../lib/types";
import { buildProposalDiff, type ProposalDiff } from "../agent/review/diff";
import { humanizeProposalFields } from "./fieldDisplay";

export type ProposalFieldMode = "create" | "update" | "delete";

export interface ProposalFieldRow {
  label: string;
  value?: string;
  before?: string;
  after?: string;
}

export interface ProposalFields {
  mode: ProposalFieldMode;
  rows: ProposalFieldRow[];
  note?: string;
}

function diffToFields(diff: ProposalDiff): ProposalFields {
  if (diff.mode === "create" || diff.mode === "snapshot") {
    return {
      mode: "create",
      rows: diff.lines.map((line) => ({ label: line.path, value: line.value })),
      note: diff.note
    };
  }

  if (diff.mode === "delete") {
    return {
      mode: "delete",
      rows: diff.lines.map((line) => ({ label: line.path, value: line.value })),
      note: diff.note
    };
  }

  const byPath = new Map<string, { before?: string; after?: string }>();
  for (const line of diff.lines) {
    const entry = byPath.get(line.path) ?? {};
    if (line.sign === "-") {
      entry.before = line.value;
    }
    if (line.sign === "+") {
      entry.after = line.value;
    }
    byPath.set(line.path, entry);
  }

  return {
    mode: "update",
    rows: Array.from(byPath.entries()).map(([label, entry]) => ({
      label,
      before: entry.before ?? "",
      after: entry.after ?? ""
    })),
    note: diff.note
  };
}

export function buildProposalFields(changeType: AgentChangeType, payload: Record<string, unknown>): ProposalFields {
  return humanizeProposalFields(diffToFields(buildProposalDiff(changeType, payload)), payload);
}
