import { describe, expect, it } from "vitest";

import { buildTocLeafMeta, buildTocLeafTitle } from "./tocDisplay";

describe("buildTocLeafTitle", () => {
  it("uses entry name only for entry titles", () => {
    expect(
      buildTocLeafTitle("create_entry", {
        name: "Breakfast",
        kind: "EXPENSE",
        to_entity: "Cafe"
      })
    ).toBe("Breakfast");
  });

  it("uses resource names for non-entry proposals", () => {
    expect(buildTocLeafTitle("create_entity", { name: "Nayax Canada", category: "merchant" })).toBe("Nayax Canada");
    expect(buildTocLeafTitle("delete_tag", { name: "groceries", target: { name: "groceries" } })).toBe("groceries");
  });
});

describe("buildTocLeafMeta", () => {
  it("uses category for entities", () => {
    expect(buildTocLeafMeta("create_entity", { name: "Nayax Canada", category: "merchant" })).toBe("merchant");
  });

  it("uses kind sign, date, and amount for entries", () => {
    expect(
      buildTocLeafMeta("create_entry", {
        name: "Breakfast",
        kind: "EXPENSE",
        date: "2026-03-05",
        amount_minor: 1200,
        currency_code: "USD",
        from_entity: "Checking",
        to_entity: "Cafe"
      })
    ).toBe("2026-03-05 - USD 12.00");
  });

  it("uses plus sign for income entries", () => {
    expect(
      buildTocLeafMeta("create_entry", {
        name: "GST/HST Credit",
        kind: "INCOME",
        date: "2026-06-05",
        amount_minor: 17450,
        currency_code: "CAD"
      })
    ).toBe("2026-06-05 + CAD 174.50");
  });

});
