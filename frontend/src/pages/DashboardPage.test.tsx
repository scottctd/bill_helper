import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";
import type { Dashboard } from "../lib/types";

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

function buildDashboard(month: string): Dashboard {
  const monthNumber = Number(month.slice(5, 7));
  const base = monthNumber * 10_000;
  const monthTrend = monthSeries(2025, 10, 6);
  const expenseTotal = base + 12_000;
  const housingTotal = base + 4_000;
  const foodTotal = 5_000;
  const uncategorizedTotal = 3_000;

  return {
    month,
    currency_code: "CAD",
    kpis: {
      expense_total_minor: expenseTotal,
      income_total_minor: base + 35_000,
      net_total_minor: 23_000,
      cash_withdrawal_total_minor: 0,
      average_expense_day_minor: 2_500,
      median_expense_day_minor: 2_200,
      spending_days: 18,
      one_time_total_minor: 2_000,
      core_spend_minor: expenseTotal - 2_000,
      uncategorized_total_minor: uncategorizedTotal
    },
    categories: [
      {
        name: "housing",
        total_minor: housingTotal,
        share: housingTotal / expenseTotal,
        entry_count: 1,
        children: [
          {
            name: "rent",
            path: "housing/rent",
            total_minor: housingTotal,
            share: 1,
            entry_count: 1,
            to_breakdown: [
              {
                label: "Landlord",
                total_minor: housingTotal,
                share: 1,
                entries: [
                  {
                    id: `${month}-rent`,
                    occurred_at: `${month}-01`,
                    name: "Monthly Rent",
                    amount_minor: housingTotal
                  }
                ]
              }
            ]
          }
        ],
        to_breakdown: []
      },
      {
        name: "food_drink",
        total_minor: foodTotal,
        share: foodTotal / expenseTotal,
        entry_count: 2,
        children: [
          {
            name: "groceries",
            path: "food_drink/groceries",
            total_minor: 3_000,
            share: 0.6,
            entry_count: 1,
            to_breakdown: []
          },
          {
            name: "restaurants",
            path: "food_drink/restaurants",
            total_minor: 2_000,
            share: 0.4,
            entry_count: 1,
            to_breakdown: []
          }
        ],
        to_breakdown: []
      },
      {
        name: "Uncategorized",
        total_minor: uncategorizedTotal,
        share: uncategorizedTotal / expenseTotal,
        entry_count: 1,
        children: [],
        to_breakdown: [
          {
            label: "Unknown",
            total_minor: uncategorizedTotal,
            share: 1,
            entries: []
          }
        ]
      }
    ],
    lifecycles: [
      {
        lifecycle: "fixed",
        total_minor: base + 3_000,
        share: (base + 3_000) / expenseTotal,
        entry_count: 1
      },
      { lifecycle: "day_to_day", total_minor: 5_000, share: 5_000 / expenseTotal, entry_count: 2 },
      { lifecycle: "one_time", total_minor: 2_000, share: 2_000 / expenseTotal, entry_count: 1 },
      { lifecycle: null, total_minor: 2_000, share: 2_000 / expenseTotal, entry_count: 1 }
    ],
    filter_groups: [
      {
        filter_group_id: "fg-custom",
        key: "work_meals",
        name: "Work Meals",
        color: "#0f766e",
        total_minor: 2_600,
        share: 2_600 / expenseTotal,
        entry_count: 2
      }
    ],
    daily_spending: [
      {
        date: `${month}-01`,
        expense_total_minor: 1_600,
        category_totals: { housing: 1_200, food_drink: 400 }
      },
      {
        date: `${month}-02`,
        expense_total_minor: 2_300,
        category_totals: { food_drink: 1_900, Uncategorized: 400 }
      }
    ],
    monthly_trend: monthTrend.map((monthKey, index) => ({
      month: monthKey,
      expense_total_minor: 30_000 + index * 2_000,
      income_total_minor: 55_000 + index * 1_000,
      category_totals: {
        housing: 18_000 + index * 1_000,
        food_drink: 9_000 + index * 700,
        Uncategorized: 3_000 + index * 300
      },
      lifecycle_totals: {
        fixed: 18_000 + index * 1_000,
        day_to_day: 8_000 + index * 600,
        one_time: 2_000 + index * 300,
        none: 2_000 + index * 100
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
        category: "housing/rent",
        lifecycle: "fixed"
      },
      {
        id: `${month}-team-lunch`,
        occurred_at: `${month}-02`,
        name: "Team Lunch",
        to_entity: "Cafe",
        amount_minor: 4_200,
        category: "food_drink/restaurants",
        lifecycle: "day_to_day"
      }
    ],
    projection: {
      is_current_month: month === "2026-03",
      days_elapsed: 12,
      days_remaining: 19,
      spent_to_date_minor: 14_000,
      projected_total_minor: month === "2026-03" ? 32_000 : null,
      projected_remaining_minor: month === "2026-03" ? 18_000 : null,
      projected_category_totals: {
        housing: 20_000,
        food_drink: 9_000,
        Uncategorized: 3_000
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

  it("keeps the category partition equal to the expense total", () => {
    const dashboard = buildDashboard("2026-03");
    expect(dashboard.categories.reduce((sum, category) => sum + category.total_minor, 0)).toBe(
      dashboard.kpis.expense_total_minor
    );
  });

  it("loads only timeline and selected month on initial month view", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Expense by Category")).toBeInTheDocument();
    expect(screen.getByLabelText(/This month income and expense summary/i)).toBeInTheDocument();
    expect(getDashboardTimelineMock).toHaveBeenCalledTimes(1);
    expect(getDashboardBatchMock).not.toHaveBeenCalled();
    expect(getDashboardMock.mock.calls.map((call) => call[0])).toEqual(["2026-03"]);
  });

  it("loads year dashboards through the batch endpoint in year view", async () => {
    renderDashboardPage();

    await screen.findByText("Expense by Category");
    await userEvent.click(screen.getByRole("tab", { name: "Year" }));

    await waitFor(() => {
      expect(getDashboardBatchMock).toHaveBeenCalledTimes(1);
    });
    expect(getDashboardBatchMock.mock.calls[0]?.[0]).toHaveLength(24);
  });

  it("renders spending tab content and breakdown tree without removed charts", async () => {
    renderDashboardPage();

    expect(await screen.findByText("Expense by Category")).toBeInTheDocument();
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    expect(within(sectionTabs).getByRole("tab", { name: "Breakdown" })).toBeInTheDocument();
    expect(within(sectionTabs).getByRole("tab", { name: "Income" })).toBeInTheDocument();
    expect(within(sectionTabs).queryByRole("tab", { name: "Insights" })).not.toBeInTheDocument();
    expect(within(sectionTabs).queryByRole("tab", { name: "Daily Expense" })).not.toBeInTheDocument();

    expect(screen.getByText("Income vs Expense Trend")).toBeInTheDocument();
    expect(screen.getByText("Spending by Destination")).toBeInTheDocument();
    expect(screen.getByText("Projection (Current Month)")).toBeInTheDocument();
    expect(screen.queryByText("Spending by Tags")).not.toBeInTheDocument();
    expect(screen.queryByText("Spending by Source (`from`)")).not.toBeInTheDocument();

    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Breakdown" }));

    expect(await screen.findByText("Expense Breakdown Tree")).toBeInTheDocument();
    expect(screen.queryByText("Spending by Tags")).not.toBeInTheDocument();
  });

  it("switches the sub-category facet when a category is selected", async () => {
    renderDashboardPage();

    expect(await screen.findByText("housing Sub-Categories")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /2\. food_drink/ }));

    expect(await screen.findByText("food_drink Sub-Categories")).toBeInTheDocument();
    expect(screen.queryByText("housing Sub-Categories")).not.toBeInTheDocument();
  });

  it("renders the income tab with source breakdown chart", async () => {
    renderDashboardPage();

    await screen.findByText("Expense by Category");
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Income" }));

    expect(await screen.findByText("Income by Source")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel", { name: "Income" });
    expect(within(panel).queryByText("Salary")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Other income")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: "Income" })).not.toBeInTheDocument();
  });

  it("hides finance chrome on the agent tab", async () => {
    renderDashboardPage();

    await screen.findByText("Expense by Category");
    const sectionTabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    await userEvent.click(within(sectionTabs).getByRole("tab", { name: "Agent" }));

    expect(screen.queryByText("Income vs Expense Trend")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/This month income and expense summary/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Year" })).not.toBeInTheDocument();
  });
});
