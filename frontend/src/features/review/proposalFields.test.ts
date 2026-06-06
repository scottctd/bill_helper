import { describe, expect, it } from "vitest";

import { buildProposalFields } from "./proposalFields";

describe("buildProposalFields", () => {
  it("builds create rows from payload fields", () => {
    const fields = buildProposalFields("create_entity", {
      name: "Molly Tea",
      category: "merchant"
    });

    expect(fields.mode).toBe("create");
    expect(fields.rows).toEqual(
      expect.arrayContaining([
        { label: "Name", value: "Molly Tea" },
        { label: "Category", value: "merchant" }
      ])
    );
  });

  it("builds update rows with before and after values", () => {
    const fields = buildProposalFields("update_entity", {
      name: "Molly Tea",
      current: { name: "Molly Tea", category: "merchant" },
      patch: { category: "cafe" }
    });

    expect(fields.mode).toBe("update");
    expect(fields.rows).toEqual([{ label: "Category", before: "merchant", after: "cafe" }]);
  });

  it("builds delete rows from target fields", () => {
    const fields = buildProposalFields("delete_tag", {
      name: "groceries",
      target: { name: "groceries" }
    });

    expect(fields.mode).toBe("delete");
    expect(fields.rows.some((row) => row.label === "Name" && row.value === "groceries")).toBe(true);
  });
});
