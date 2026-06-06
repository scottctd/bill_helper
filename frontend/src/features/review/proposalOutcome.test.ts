import { describe, expect, it } from "vitest";

import { buildProposalOutcome } from "./proposalOutcome";

describe("buildProposalOutcome", () => {
  it("returns no outcome lines for pending proposals", () => {
    expect(
      buildProposalOutcome({
        status: "PENDING_REVIEW",
        reviewNote: null,
        appliedResourceType: null,
        appliedResourceId: null
      })
    ).toEqual([]);
  });

  it("includes applied resource, review note, and last action for resolved proposals", () => {
    expect(
      buildProposalOutcome({
        status: "APPLIED",
        reviewNote: "Looks correct.",
        appliedResourceType: "entity",
        appliedResourceId: "entity-42",
        reviewActions: [
          {
            id: "action-1",
            change_item_id: "change-1",
            action: "approve",
            actor: "scott",
            note: null,
            created_at: "2026-03-06T10:05:00Z"
          }
        ]
      })
    ).toEqual([
      { label: "Result", value: "Applied" },
      { label: "Applied resource", value: "entity #entity-42" },
      { label: "Review note", value: "Looks correct." },
      { label: "Last action", value: "Approved by scott" }
    ]);
  });

  it("renders apply failures as a dedicated code block", () => {
    expect(
      buildProposalOutcome({
        status: "APPLY_FAILED",
        reviewNote: "Looks correct. | apply failed: duplicate key value violates unique constraint",
        appliedResourceType: null,
        appliedResourceId: null
      })
    ).toEqual([
      { label: "Result", value: "Apply failed" },
      {
        label: "Apply failure",
        value: "duplicate key value violates unique constraint",
        kind: "code"
      },
      { label: "Review note", value: "Looks correct." }
    ]);
  });
});
