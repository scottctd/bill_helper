import { describe, expect, it } from "vitest";

import { extractEntryTocFields } from "./entryTocFields";

describe("extractEntryTocFields", () => {
  it("reads create entry destination and name", () => {
    expect(
      extractEntryTocFields("create_entry", {
        name: "Breakfast",
        to_entity: "Cafe"
      })
    ).toEqual({
      entryName: "Breakfast",
      entryToEntity: "Cafe"
    });
  });

  it("reads update entry fields from patch and target", () => {
    expect(
      extractEntryTocFields("update_entry", {
        target: { name: "Old name", to_entity: "Old destination" },
        patch: { name: "New name", to_entity: "New destination" }
      })
    ).toEqual({
      entryName: "New name",
      entryToEntity: "New destination"
    });
  });

  it("returns null for non-entry proposals", () => {
    expect(extractEntryTocFields("create_entity", { name: "Cafe" })).toBeNull();
  });
});
