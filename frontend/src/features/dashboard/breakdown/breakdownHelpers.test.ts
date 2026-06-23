import { describe, expect, it } from "vitest";

import type { DashboardCategorySummary } from "../../../lib/types";
import {
  categoryChildRows,
  formatBreakdownEntryDate,
  formatBreakdownEntryRelativeAge,
  formatBreakdownShare,
  sortCategorySummaries
} from "./breakdownHelpers";

const sampleCategory: DashboardCategorySummary = {
  name: "food_drink",
  total_minor: 1_000,
  share: 0.5,
  entry_count: 2,
  children: [
    {
      name: "restaurants",
      path: "food_drink/restaurants",
      total_minor: 300,
      share: 0.3,
      entry_count: 1,
      to_breakdown: []
    },
    {
      name: "groceries",
      path: "food_drink/groceries",
      total_minor: 700,
      share: 0.7,
      entry_count: 1,
      to_breakdown: []
    }
  ],
  to_breakdown: []
};

describe("breakdownHelpers", () => {
  it("sorts categories by amount with uncategorized last", () => {
    const sorted = sortCategorySummaries([
      { ...sampleCategory, name: "Uncategorized", total_minor: 2_000 },
      { ...sampleCategory, name: "housing", total_minor: 1_500 },
      sampleCategory
    ]);
    expect(sorted.map((category) => category.name)).toEqual(["housing", "food_drink", "Uncategorized"]);
  });

  it("sorts category children by amount", () => {
    expect(categoryChildRows(sampleCategory).map((child) => child.name)).toEqual(["groceries", "restaurants"]);
  });

  it("formats shares at useful precision", () => {
    expect(formatBreakdownShare(0)).toBe("0%");
    expect(formatBreakdownShare(0.034)).toBe("3.4%");
    expect(formatBreakdownShare(0.42)).toBe("42%");
  });

  it("formats entry dates as month and day", () => {
    expect(formatBreakdownEntryDate("2026-05-05")).toMatch(/May\s+5/);
  });

  it("formats relative entry age by tier", () => {
    const reference = new Date(2026, 4, 24);
    expect(formatBreakdownEntryRelativeAge("2026-05-24", reference)).toBe("Today");
    expect(formatBreakdownEntryRelativeAge("2026-05-20", reference)).toBe("4 days ago");
    expect(formatBreakdownEntryRelativeAge("2026-05-17", reference)).toBe("1 week ago");
    expect(formatBreakdownEntryRelativeAge("2026-05-10", reference)).toBe("2 weeks ago");
    expect(formatBreakdownEntryRelativeAge("2026-05-03", reference)).toBe("3 weeks ago");
    expect(formatBreakdownEntryRelativeAge("2026-04-24", reference)).toBe("1 month 0 weeks 0 days ago");
    expect(formatBreakdownEntryRelativeAge("2026-03-01", reference)).toBe("2 months 3 weeks 3 days ago");
  });

});
