import { describe, expect, it } from "vitest";

import { buildProposalContext } from "./proposalContext";

describe("buildProposalContext", () => {
  it("includes duplicate merge context for import proposals", () => {
    const lines = buildProposalContext(
      "create_entity",
      { name: "PC Financial", category: "financial_institution" },
      {
        duplicateCount: 3
      }
    );

    expect(lines.map((line) => line.text)).toEqual([
      "3 identical proposals were merged into this canonical item."
    ]);
    expect(lines[0].tone).toBe("warning");
  });

  it("includes unresolved group membership dependencies", () => {
    const lines = buildProposalContext(
      "create_group_member",
      {
        group_ref: { create_group_proposal_id: "proposal-group-create" },
        group_preview: { name: "Monthly Bills" },
        member_preview: { name: "March Rent" }
      },
      {
        siblingItems: [
          {
            id: "proposal-group-create",
            status: "PENDING_REVIEW",
            title: "Monthly Bills",
            changeType: "create_group"
          }
        ]
      }
    );

    expect(lines[0].text).toBe("Depends on pending create group: Monthly Bills.");
    expect(lines[0].tone).toBe("warning");
  });

  it("includes delete snapshot reconciliation context", () => {
    const lines = buildProposalContext("delete_snapshot", {
      account_name: "Checking",
      currency_code: "CAD",
      impact_preview: {
        previous_snapshot: { snapshot_at: "2026-05-01", balance_minor: 100000 },
        next_snapshot: { snapshot_at: "2026-06-01", balance_minor: 120000 }
      }
    });

    expect(lines.some((line) => line.text.startsWith("Previous snapshot:"))).toBe(true);
    expect(lines.some((line) => line.text.includes("reconciliation intervals"))).toBe(true);
  });

  it("does not repeat entry notes that already appear in details", () => {
    const lines = buildProposalContext("create_entry", {
      name: "Lunch",
      markdown_notes: "Pending transaction from Scene Visa statement"
    });

    expect(lines.some((line) => line.text.startsWith("Note:"))).toBe(false);
  });
});
