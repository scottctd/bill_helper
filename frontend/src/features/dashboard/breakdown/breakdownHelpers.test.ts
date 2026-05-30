import { describe, expect, it } from "vitest";

import type { DashboardFilterGroupSummary } from "../../../lib/types";
import {
  formatBreakdownEntryDate,
  formatBreakdownEntryRelativeAge,
  formatBreakdownTagLabel,
  getTagBreakdown,
  mergeFilterGroupsForYearTree,
  toExpansionKey
} from "./breakdownHelpers";
import type { Dashboard } from "../../../lib/types";

const sampleGroup: DashboardFilterGroupSummary = {
  filter_group_id: "fg-day",
  key: "day_to_day",
  name: "Day-to-Day",
  color: null,
  total_minor: 1_000,
  share: 0.5,
  tag_totals: { groceries: 1_000 },
  tag_to_breakdowns: [
    {
      tag: "groceries",
      total_minor: 1_000,
      entry_count: 2,
      to_items: [
        {
          label: "Metro",
          total_minor: 700,
          share: 0.7,
          entries: [
            { id: "e1", occurred_at: "2026-03-01", name: "Weekly shop", amount_minor: 700 }
          ]
        }
      ]
    }
  ]
};

describe("breakdownHelpers", () => {
  it("formats tag labels for display", () => {
    expect(formatBreakdownTagLabel("coffee_snacks")).toBe("coffee snacks");
  });

  it("looks up tag breakdown rows with to entries", () => {
    const breakdown = getTagBreakdown(sampleGroup, "groceries");
    expect(breakdown?.to_items[0]?.entries).toHaveLength(1);
  });

  it("builds stable to expansion keys", () => {
    expect(toExpansionKey("day_to_day", "groceries", "Metro")).toBe("day_to_day:groceries:Metro");
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

  it("aggregates filter groups across year months for the breakdown tree", () => {
    const groupTemplate = sampleGroup;
    const janDashboard = {
      month: "2026-01",
      currency_code: "CAD",
      kpis: { expense_total_minor: 2_000, income_total_minor: 0, net_total_minor: 0 },
      filter_groups: [groupTemplate]
    } as unknown as Dashboard;
    const febDashboard = {
      month: "2026-02",
      currency_code: "CAD",
      kpis: { expense_total_minor: 1_500, income_total_minor: 0, net_total_minor: 0 },
      filter_groups: [
        {
          ...groupTemplate,
          total_minor: 1_500,
          tag_totals: { groceries: 1_500 },
          tag_to_breakdowns: [
            {
              tag: "groceries",
              total_minor: 1_500,
              entry_count: 1,
              to_items: [
                {
                  label: "Metro",
                  total_minor: 1_500,
                  share: 1,
                  entries: [{ id: "e2", occurred_at: "2026-02-02", name: "Top-up", amount_minor: 1_500 }]
                }
              ]
            }
          ]
        }
      ]
    } as unknown as Dashboard;

    const merged = mergeFilterGroupsForYearTree(
      [groupTemplate],
      ["2026-01", "2026-02"],
      new Map([
        ["2026-01", janDashboard],
        ["2026-02", febDashboard]
      ])
    );

    expect(merged[0]?.total_minor).toBe(2_500);
    expect(merged[0]?.tag_totals.groceries).toBe(2_500);
    expect(merged[0]?.tag_to_breakdowns[0]?.entry_count).toBe(3);
    expect(merged[0]?.tag_to_breakdowns[0]?.to_items[0]?.total_minor).toBe(2_200);
  });
});
