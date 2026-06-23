import { describe, expect, it } from "vitest";

import {
  buildCategoryFilterOptions,
  formatEntryLifecycle,
  includesFilter,
  normalizeFilterValue,
  taxonomyTermNames,
  uniqueOptionValues
} from "./catalogs";

describe("catalog helpers", () => {
  it("normalizes filter text", () => {
    expect(normalizeFilterValue("  HeLLo ")).toBe("hello");
  });

  it("matches values with case-insensitive contains logic", () => {
    expect(includesFilter("Coffee Shop", "shop")).toBe(true);
    expect(includesFilter("Coffee Shop", "tea")).toBe(false);
    expect(includesFilter("Coffee Shop", "   ")).toBe(true);
  });

  it("builds sorted unique option values", () => {
    expect(uniqueOptionValues([" Travel ", "travel", "Food", null, "", " food "])).toEqual(["Food", "Travel"]);
  });

  it("extracts taxonomy term names safely", () => {
    expect(taxonomyTermNames(undefined)).toEqual([]);
    expect(
      taxonomyTermNames([
        {
          id: "term-1",
          taxonomy_id: "taxonomy-1",
          name: "Bills",
          normalized_name: "bills",
          parent_term_id: null,
          usage_count: 3
        }
      ])
    ).toEqual(["Bills"]);
  });

  it("formats lifecycle values as lowercase hyphenated labels", () => {
    expect(formatEntryLifecycle("fixed")).toBe("fixed");
    expect(formatEntryLifecycle("day_to_day")).toBe("day-to-day");
    expect(formatEntryLifecycle("one_time")).toBe("one-time");
  });

  it("builds category filter options with parents, child paths, and uncategorized", () => {
    expect(
      buildCategoryFilterOptions([
        {
          id: "parent",
          taxonomy_id: "taxonomy-1",
          name: "food_drink",
          normalized_name: "food_drink",
          parent_term_id: null,
          usage_count: 0
        },
        {
          id: "child",
          taxonomy_id: "taxonomy-1",
          name: "groceries",
          normalized_name: "groceries",
          parent_term_id: "parent",
          usage_count: 1
        }
      ])
    ).toEqual([
      { value: "uncategorized", label: "uncategorized", path: null },
      { value: "food_drink", label: "food_drink", path: "food_drink" },
      {
        value: "groceries",
        label: "food_drink / groceries",
        path: "food_drink/groceries"
      }
    ]);
  });
});
