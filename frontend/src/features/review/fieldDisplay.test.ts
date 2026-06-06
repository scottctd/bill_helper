import { describe, expect, it } from "vitest";

import { humanizeFieldLabel, humanizeFieldValue, humanizeProposalFields } from "./fieldDisplay";
import type { ProposalFields } from "./proposalFields";

describe("fieldDisplay", () => {
  it("title-cases field labels", () => {
    expect(humanizeFieldLabel("date")).toBe("Date");
    expect(humanizeFieldLabel("group type")).toBe("Group Type");
  });

  it("formats amount minors with currency", () => {
    expect(humanizeFieldValue("amount", "1400", "CAD")).toBe("CAD 14.00");
  });

  it("renders tags as a comma-separated list", () => {
    expect(humanizeFieldValue("tags", "[e_transfer, food]")).toBe("e_transfer, food");
  });

  it("title-cases entry kinds", () => {
    expect(humanizeFieldValue("kind", "EXPENSE")).toBe("Expense");
  });

  it("humanizes proposal field rows", () => {
    const fields: ProposalFields = {
      mode: "create",
      rows: [
        { label: "date", value: "2026-05-29" },
        { label: "amount", value: "1400" },
        { label: "currency", value: "CAD" },
        { label: "tags", value: "[e_transfer]" },
        { label: "kind", value: "EXPENSE" }
      ]
    };

    const humanized = humanizeProposalFields(fields, {
      currency_code: "CAD"
    });

    expect(humanized.rows).toEqual([
      { label: "Date", value: "2026-05-29" },
      { label: "Amount", value: "CAD 14.00" },
      { label: "Tags", value: "e_transfer" },
      { label: "Kind", value: "Expense" }
    ]);
  });
});
