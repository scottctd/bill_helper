import { describe, expect, it } from "vitest";

import { buildProposalFields } from "./proposalFields";
import { buildProposalSummary, reviewSummaryText } from "./proposalSummary";

describe("buildProposalSummary", () => {
  it("summarizes create entry proposals with highlighted key values", () => {
    const payload = {
      kind: "EXPENSE",
      date: "2026-05-29",
      name: "Interac E-Transfer Withdrawal",
      amount_minor: 1400,
      currency_code: "CAD",
      from_entity: "Scotiabank Debit",
      to_entity: "Someone",
      tags: ["e_transfer"]
    };
    const fields = buildProposalFields("create_entry", payload);
    const summary = buildProposalSummary("create_entry", payload, fields);

    expect(reviewSummaryText(summary)).toBe(
      'Expense on 2026-05-29 from Scotiabank Debit to Someone for CAD 14.00 (“Interac E-Transfer Withdrawal”) Tags: e_transfer.'
    );
    expect(summary.filter((part) => part.tone === "highlight").map((part) => part.text)).toEqual([
      "2026-05-29",
      "Scotiabank Debit",
      "Someone",
      "CAD 14.00",
      "Interac E-Transfer Withdrawal",
      "e_transfer"
    ]);
  });

  it("summarizes update entity proposals with highlighted changed values", () => {
    const payload = {
      name: "Molly Tea",
      current: { name: "Molly Tea", category: "merchant" },
      patch: { category: "cafe" }
    };
    const fields = buildProposalFields("update_entity", payload);

    expect(reviewSummaryText(buildProposalSummary("update_entity", payload, fields))).toBe(
      "Update entity “Molly Tea” — category merchant → cafe."
    );
  });
});
