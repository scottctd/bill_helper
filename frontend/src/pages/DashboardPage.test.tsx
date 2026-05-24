import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";
import type { Dashboard, DashboardTagFromBreakdown } from "../lib/types";

const getDashboardMock = vi.fn<(month: string) => Promise<Dashboard>>();
const getDashboardTimelineMock = vi.fn<() => Promise<{ months: string[] }>>();
const getDashboardBatchMock = vi.fn<(months: string[]) => Promise<{ dashboards: Dashboard[] }>>();

vi.mock("../lib/api", () => ({
  getDashboard: (month: string) => getDashboardMock(month),
  getDashboardTimeline: () => getDashboardTimelineMock(),
  getDashboardBatch: (months: string[]) => getDashboardBatchMock(months)
}));

vi.mock("../lib/format", async () => {
  const actual = await vi.importActual<typeof import("../lib/format")>("../lib/format");
  return {
    ...actual,
    currentMonth: () => "2026-03"
  };
});

function renderDashboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

function monthSeries(startYear: number, startMonth: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startYear, startMonth - 1 + index, 1);
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
  });
}

function buildTagFromBreakdowns(tagTotals: Record<string, number>, fromLabel = "Chequing"): DashboardTagFromBreakdown[] {
  return Object.entries(tagTotals).map(([tag, total_minor]) => ({
    tag,
    total_minor,
    entry_count: 1,
    from_items: [{ label: fromLabel, total_minor, share: 1 }]
  }));
}

function buildDashboard(month: string): Dashboard {
  const monthNumber = Number(month.slice(5, 7));
  const base = monthNumber * 10_000;
  const monthTrend = monthSeries(2025, 10, 6);

  return {
    month,
    currency_code: "CAD",
    kpis: {
      expense_total_minor: base + 12_000,
      income_total_minor: base + 35_000,
      net_total_minor: 23_000,
      average_expense_day_minor: 2_500,
      median_expense_day_minor: 2_200,
      spending_days: 18,
      average_day_to_day_minor: 1_750,
      median_day_to_day_minor: 1_500
    },
    filter_groups: [
      {
        filter_group_id: "fg-day",
        key: "day_to_day",
        name: "Day-to-Day",
        color: null,
        total_minor: base + 5_000,
        share: 0.34,
        tag_totals: {
          groceries: base / 3,
          coffee: 1_800,
          lunch: 1_500
        },
        tag_from_breakdowns: buildTagFromBreakdowns({
          groceries: base / 3,
          coffee: 1_800,
          lunch: 1_500
        })
      },
      {
        filter_group_id: "fg-fixed",
        key: "fixed",
        name: "Fixed",
        color: null,
        total_minor: base + 3_800,
        share: 0.24,
        tag_totals: {
          rent: base / 4,
          utilities: 1_900
        },
        tag_from_breakdowns: buildTagFromBreakdowns({
          rent: base / 4,
          utilities: 1_900
        })
      },
      {
        filter_group_id: "fg-one-time",
        key: "one_time",
        name: "One-Time",
        color: null,
        total_minor: base + 2_100,
        share: 0.16,
        tag_totals: {
          gifts: 1_700,
          travel: 1_200
        },
        tag_from_breakdowns: buildTagFromBreakdowns({
          gifts: 1_700,
          travel: 1_200
        })
      },
      {
        filter_group_id: "fg-transfers",
        key: "transfers",
        name: "Transfers",
        color: null,
        total_minor: base + 1_300,
        share: 0.12,
        tag_totals: {
          savings: 1_100
        },
        tag_from_breakdowns: buildTagFromBreakdowns({ savings: 1_100 })
      },
      {
        filter_group_id: "fg-untagged",
        key: "untagged",
        name: "Untagged",
        color: null,
        total_minor: base + 900,
        share: 0.08,
        tag_totals: {},
        tag_from_breakdowns: []
      },
      {
        filter_group_id: "fg-custom",
        key: "work_meals",
        name: "Work Meals",
        color: "#0f766e",
        total_minor: base + 2_600,
        share: 0.18,
        tag_totals: {
          lunch: 2_000,
          dinner: 1_300
        },
        tag_from_breakdowns: buildTagFromBreakdowns({
          lunch: 2_000,
          dinner: 1_300
        })
      },
      {
        filter_group_id: "fg-salary",
        key: "salary",
        name: "Salary",
        color: null,
        total_minor: 0,
        share: 0,
        tag_totals: {},
        tag_from_breakdowns: []
      },
      {
        filter_group_id: "fg-other-income",
        key: "other_income",
        name: "Other Income",
        color: null,
        total_minor: 0,
        share: 0,
        tag_totals: {},
        tag_from_breakdowns: []
      }
    ],
    daily_spending: [
      {
        date: `${month}-01`,
        expense_total_minor: 1_600,
        filter_group_totals: {
          day_to_day: 1_200,
          fixed: 0,
          one_time: 400
        }
      },
      {
        date: `${month}-02`,
        expense_total_minor: 2_300,
        filter_group_totals: {
          day_to_day: 1_900,
          fixed: 0,
          one_time: 400
        }
      }
    ],
    monthly_trend: monthTrend.map((monthKey, index) => ({
      month: monthKey,
      expense_total_minor: 30_000 + index * 2_000,
      income_total_minor: 55_000 + index * 1_000,
      filter_group_totals: {
        day_to_day: 12_000 + index * 1_000,
        fixed: 9_500 + index * 300,
        one_time: 4_000 + index * 500,
        transfers: 3_000 + index * 200,
        untagged: 1_400 + index * 100,
        work_meals: 2_800 + index * 250
      },
      income_filter_group_totals: {
        salary: 48_000,
        other_income: 7_000 + index * 300
      }
    })),
    spending_by_from: [
      { label: "Chequing", total_minor: 20_000, share: 0.6 },
      { label: "Credit Card", total_minor: 14_000, share: 0.4 }
    ],
    spending_by_to: [
      { label: "Metro", total_minor: 9_000, share: 0.28 },
      { label: "Landlord", total_minor: 16_000, share: 0.5 }
    ],
    spending_by_tag: [
      { label: "groceries", total_minor: 8_000, share: 0.25 },
      { label: "rent", total_minor: 16_000, share: 0.5 }
    ],
    income_by_from: [
      { label: "Employer", total_minor: 48_000, share: 0.87 },
      { label: "Interest", total_minor: 7_000, share: 0.13 }
    ],
    weekday_spending: [
      { weekday: "Mon", total_minor: 5_000 },
      { weekday: "Tue", total_minor: 4_500 }
    ],
    largest_expenses: [
      {
        id: `${month}-rent`,
        occurred_at: `${month}-01`,
        name: "Monthly Rent",
        to_entity: "Landlord",
        amount_minor: 16_000,
        matching_filter_group_keys: ["fixed"]
      },
      {
        id: `${month}-team-lunch`,
        occurred_at: `${month}-02`,
        name: "Team Lunch",
        to_entity: "Cafe",
        amount_minor: 4_200,
        matching_filter_group_keys: ["day_to_day", "work_meals"]
      }
    ],
    projection: {
      is_current_month: month === "2026-03",
      days_elapsed: 12,
      days_remaining: 19,
      spent_to_date_minor: 14_000,
      projected_total_minor: month === "2026-03" ? 32_000 : null,
      projected_remaining_minor: month === "2026-03" ? 18_000 : null,
      projected_filter_group_totals: {
        day_to_day: 14_000,
        fixed: 11_000,
        one_time: 4_500,
        transfers: 2_100,
        untagged: 1_500,
        work_meals: 3_200
      }
    },
    reconciliation: []
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();

    getDashboardTimelineMock.mockResolvedValue({
      months: monthSeries(2025, 1, 15)
    });
    getDashboardMock.mockImplementation(async (month) => buildDashboard(month));
    getDashboardBatchMock.mockImplementation(async (months) => ({
      dashboards: months.map((monthKey) => buildDashboard(monthKey))
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads only timeline and selected month on initial month view", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Builtin Filter Groups by Spend")).toBeInTheDocument();
    expect(getDashboardTimelineMock).toHaveBeenCalledTimes(1);
    expect(getDashboardBatchMock).not.toHaveBeenCalled();
    expect(getDashboardMock.mock.calls.map((call) => call[0])).toEqual(["2026-03"]);
  });

  it("loads year dashboards through the batch endpoint in year view", async () => {
    renderDashboardPage();

    await screen.findByText("Builtin Filter Groups by Spend");
    await userEvent.click(screen.getByRole("tab", { name: "Year" }));

    await waitFor(() => {
      expect(getDashboardBatchMock).toHaveBeenCalledTimes(1);
    });
    expect(getDashboardBatchMock.mock.calls[0]?.[0]).toHaveLength(24);
  });

  it("fetches previous month only when breakdowns tab is active in month view", async () => {
    renderDashboardPage();

    await screen.findByText("Builtin Filter Groups by Spend");
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Breakdowns" }));

    await waitFor(() => {
      expect(getDashboardMock.mock.calls.some((call) => call[0] === "2026-02")).toBe(true);
    });
  });

  it("promotes the overview charts and keeps breakdown month table under the renamed tabs", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Builtin Filter Groups by Spend")).toBeInTheDocument();
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    expect(within(sectionTabs).getByRole("tab", { name: "Income" })).toBeInTheDocument();
    expect(within(sectionTabs).getByRole("tab", { name: "Daily Expense" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Experimental MiMo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Experimental Codex" })).not.toBeInTheDocument();

    expect(screen.getByText("Income vs Expense Trend")).toBeInTheDocument();
    expect(screen.getByText("Small-Multiple Trends")).toBeInTheDocument();

    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Breakdowns" }));

    expect(await screen.findByRole("tablist", { name: "Breakdown experiments" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Classic" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Exp 1" })).toBeInTheDocument();
    expect(await screen.findByText("Monthly Spend by Filter Group")).toBeInTheDocument();
    expect(screen.getByText("Spending by Tags")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Exp 1" }));
    expect(await screen.findByText("Expense Breakdown Tree")).toBeInTheDocument();
  });

  it("renders the income tab with source breakdown chart", async () => {
    renderDashboardPage();

    await screen.findByText("Builtin Filter Groups by Spend");
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Income" }));

    expect(await screen.findByText("Income by Source")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel", { name: "Income" });
    expect(within(panel).getByText("Salary")).toBeInTheDocument();
    expect(within(panel).getByText("Other income")).toBeInTheDocument();
  });
});
