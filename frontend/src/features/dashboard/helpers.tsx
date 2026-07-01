/**
 * CALLING SPEC:
 * - Purpose: shared dashboard tabs, chart helpers, date utilities, and chart container rendering for the dashboard route.
 * - Inputs: typed dashboard read models plus React chart container children.
 * - Outputs: derived chart data, display helpers, and reusable dashboard UI utilities.
 * - Side effects: React rendering only inside `DashboardChartContainer`.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import { formatMinor } from "../../lib/format";
import { listOrEmpty, nullishToNull } from "../../lib/collections";
import type {
  Dashboard,
  DashboardBreakdownItem,
  DashboardCategorySummary,
  DashboardGroupSummary,
  DashboardLifecycleSummary,
  DashboardToBreakdownItem
} from "../../lib/types";

export type DashboardTab = "spending" | "breakdown" | "income" | "agent";
export type DashboardViewMode = "month" | "year";

export const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "spending", label: "Spending" },
  { id: "breakdown", label: "Breakdown" },
  { id: "income", label: "Income" },
  { id: "agent", label: "Agent" }
];

export const CHART_COLORS = {
  income: "rgb(var(--chart-income))",
  expense: "rgb(var(--chart-expense))",
  net: "rgb(var(--chart-net))",
  muted: "rgb(var(--muted-foreground))",
  destination: "rgb(var(--chart-destination))",
  source: "rgb(var(--chart-source))"
};

const DASHBOARD_BAR_COLORS = [
  "rgb(var(--chart-segment-1))",
  "rgb(var(--chart-segment-2))",
  "rgb(var(--chart-segment-3))",
  "rgb(var(--chart-segment-4))",
  "rgb(var(--chart-segment-5))",
  "rgb(var(--chart-segment-6))",
  "rgb(var(--chart-segment-7))",
  "rgb(var(--chart-segment-8))"
];

const DASHBOARD_PIE_COLORS = [
  "rgb(var(--chart-pie-1))",
  "rgb(var(--chart-pie-2))",
  "rgb(var(--chart-pie-3))",
  "rgb(var(--chart-pie-4))",
  "rgb(var(--chart-pie-5))",
  "rgb(var(--chart-pie-6))",
  "rgb(var(--chart-pie-7))",
  "rgb(var(--chart-pie-8))"
];

export const DASHBOARD_PIE_ANIMATION_PROPS = {
  animationBegin: 0,
  animationDuration: 420,
  animationEasing: "ease-out" as const
};

export function axisTick(value: number | string) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return `${Math.round((Number.isFinite(numericValue) ? numericValue : 0) / 100).toLocaleString()}`;
}

export function toMinorValue(value: unknown): number {
  if (Array.isArray(value) && value.length > 0) {
    return toMinorValue(value[0]);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function tooltipAmount(currencyCode: string, value: unknown): string {
  return formatMinor(toMinorValue(value), currencyCode);
}

export function tooltipAmountWithName(
  currencyCode: string,
  value: unknown,
  name: string | number | undefined
): [string, string] {
  return [tooltipAmount(currencyCode, value), String(name ?? "")];
}

export function dashboardBarColor(index: number): string {
  return DASHBOARD_BAR_COLORS[index % DASHBOARD_BAR_COLORS.length];
}

export function dashboardPieColor(index: number): string {
  return DASHBOARD_PIE_COLORS[index % DASHBOARD_PIE_COLORS.length];
}

export function monthDate(monthKey: string): Date {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function shiftMonthKey(monthKey: string, monthDelta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(year, month - 1 + monthDelta, 1);
  return `${shifted.getFullYear()}-${`${shifted.getMonth() + 1}`.padStart(2, "0")}`;
}

export function buildYearMonthKeys(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${`${index + 1}`.padStart(2, "0")}`);
}

export function buildTimelineYears(monthKeys: string[]): string[] {
  return Array.from(new Set(monthKeys.map((monthKey) => monthKey.slice(0, 4)))).sort();
}

export function pickTimelineMonthForYear(monthKeys: string[], yearKey: string, preferredMonthKey: string): string | null {
  const yearMonths = monthKeys.filter((monthKey) => monthKey.startsWith(`${yearKey}-`));
  if (yearMonths.length === 0) {
    return null;
  }
  const preferredMonthNumber = Number(preferredMonthKey.slice(5, 7));
  return (
    yearMonths.find((monthKey) => Number(monthKey.slice(5, 7)) === preferredMonthNumber) ??
    yearMonths[yearMonths.length - 1]
  );
}

export function formatMonthShort(monthKey: string): string {
  return monthDate(monthKey).toLocaleDateString(undefined, { month: "short" });
}

export function formatMonthLong(monthKey: string): string {
  return monthDate(monthKey).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** Extract day-only label from YYYY-MM-DD for daily chart x-axis. */
export function formatDayFromDate(dateStr: string): string {
  const parts = String(dateStr ?? "").split("-");
  const day = parts[2];
  return day ? String(parseInt(day, 10)) : "";
}

export const DESTINATION_BREAKDOWN_LIMIT = 20;

/** Split a list into near-equal columns for side-by-side chart layouts. */
export function splitItemsIntoColumns<T>(items: T[], columnCount = 2): T[][] {
  if (items.length === 0 || columnCount <= 1) {
    return items.length > 0 ? [items] : [];
  }
  const columnSize = Math.ceil(items.length / columnCount);
  return Array.from({ length: columnCount }, (_, index) =>
    items.slice(index * columnSize, (index + 1) * columnSize)
  ).filter((column) => column.length > 0);
}

/** Merge monthly breakdown rows by label, recompute shares, and keep the top rows. */
export function mergeBreakdownItems(breakdownSets: DashboardBreakdownItem[][], limit = 8): DashboardBreakdownItem[] {
  const totals = new Map<string, number>();
  for (const items of breakdownSets) {
    for (const item of items) {
      totals.set(item.label, (totals.get(item.label) ?? 0) + item.total_minor);
    }
  }
  const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (grandTotal <= 0) {
    return [];
  }

  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, total_minor]) => ({
      label,
      total_minor,
      share: Math.round((total_minor / grandTotal) * 10_000) / 10_000
    }));
}

export function buildYearlyOverviewData(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>
) {
  return monthKeys.map((monthKey) => {
    const monthDashboard = dashboardsByMonth.get(monthKey);
    const trendPoint = monthDashboard?.monthly_trend?.find((p) => p.month === monthKey);
    return {
      month: formatMonthShort(monthKey),
      expense_total_minor: monthDashboard?.kpis.expense_total_minor ?? 0,
      income_total_minor: monthDashboard?.kpis.income_total_minor ?? 0,
      ...(trendPoint?.category_totals ?? {}),
      ...(trendPoint?.lifecycle_totals ?? {})
    };
  });
}

export function buildYearOverYearData(
  selectedYearMonths: string[],
  previousYearMonths: string[],
  dashboardsByMonth: Map<string, Dashboard>
) {
  return selectedYearMonths.map((monthKey, index) => {
    const previousMonthKey = previousYearMonths[index];
    const selectedDashboard = dashboardsByMonth.get(monthKey);
    const previousDashboard = dashboardsByMonth.get(previousMonthKey);
    return {
      month: formatMonthShort(monthKey),
      current_expense_total_minor: selectedDashboard?.kpis.expense_total_minor ?? 0,
      previous_expense_total_minor: previousDashboard?.kpis.expense_total_minor ?? 0,
      current_income_total_minor: selectedDashboard?.kpis.income_total_minor ?? 0,
      previous_income_total_minor: previousDashboard?.kpis.income_total_minor ?? 0
    };
  });
}

export function sumDashboardKpiForMonths(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>,
  key:
    | "expense_total_minor"
    | "income_total_minor"
    | "net_total_minor"
    | "cash_withdrawal_total_minor"
): number {
  return monthKeys.reduce((sum, monthKey) => sum + (dashboardsByMonth.get(monthKey)?.kpis[key] ?? 0), 0);
}

/** Sum a lifecycle key's total_minor across months using monthly_trend data. */
export function sumLifecycleForMonths(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>,
  lifecycleKey: string
): number {
  return monthKeys.reduce((sum, monthKey) => {
    const dashboard = dashboardsByMonth.get(monthKey);
    const trendPoint = dashboard?.monthly_trend?.find((p) => p.month === monthKey);
    return sum + (trendPoint?.lifecycle_totals?.[lifecycleKey] ?? 0);
  }, 0);
}

/** Sum a category name's total_minor across months using monthly_trend data. */
export function sumCategoryForMonths(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>,
  categoryName: string
): number {
  return monthKeys.reduce((sum, monthKey) => {
    const dashboard = dashboardsByMonth.get(monthKey);
    const trendPoint = dashboard?.monthly_trend?.find((p) => p.month === monthKey);
    return sum + (trendPoint?.category_totals?.[categoryName] ?? 0);
  }, 0);
}

/** Merge to_breakdown item arrays by label. */
function mergeToBreakdownItems(items: DashboardToBreakdownItem[]): DashboardToBreakdownItem[] {
  const byLabel = new Map<string, DashboardToBreakdownItem>();
  for (const item of items) {
    const existing = byLabel.get(item.label);
    if (!existing) {
      byLabel.set(item.label, {
        label: item.label,
        total_minor: item.total_minor,
        share: item.share,
        entries: [...listOrEmpty(item.entries)]
      });
      continue;
    }
    existing.total_minor += item.total_minor;
    existing.entries = [...listOrEmpty(existing.entries), ...listOrEmpty(item.entries)];
  }

  return [...byLabel.values()]
    .map((item) => ({
      ...item,
      entries: [...listOrEmpty(item.entries)].sort((left, right) => {
        if (right.amount_minor !== left.amount_minor) {
          return right.amount_minor - left.amount_minor;
        }
        return right.occurred_at.localeCompare(left.occurred_at);
      })
    }))
    .sort((left, right) => right.total_minor - left.total_minor || left.label.localeCompare(right.label));
}

/** Merge categories across months for a yearly aggregate view. */
export function buildYearlyCategoryTotals(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>
): DashboardCategorySummary[] {
  type ChildAccum = {
    name: string;
    path: string;
    total_minor: number;
    entry_count: number;
    to_breakdown: DashboardToBreakdownItem[];
  };

  type CategoryAccum = {
    total_minor: number;
    entry_count: number;
    children: Map<string, ChildAccum>;
    to_breakdown: DashboardToBreakdownItem[];
  };

  const totalsByName = new Map<string, CategoryAccum>();

  for (const monthKey of monthKeys) {
    const dashboard = dashboardsByMonth.get(monthKey);
    if (!dashboard) continue;
    for (const category of dashboard.categories) {
      let entry = totalsByName.get(category.name);
      if (!entry) {
        entry = { total_minor: 0, entry_count: 0, children: new Map(), to_breakdown: [] };
        totalsByName.set(category.name, entry);
      }
      entry.total_minor += category.total_minor;
      entry.entry_count += category.entry_count;

      for (const child of listOrEmpty(category.children)) {
        let childEntry = entry.children.get(child.path);
        if (!childEntry) {
          childEntry = { name: child.name, path: child.path, total_minor: 0, entry_count: 0, to_breakdown: [] };
          entry.children.set(child.path, childEntry);
        }
        childEntry.total_minor += child.total_minor;
        childEntry.entry_count += child.entry_count;
        childEntry.to_breakdown = mergeToBreakdownItems([...childEntry.to_breakdown, ...listOrEmpty(child.to_breakdown)]);
      }

      entry.to_breakdown = mergeToBreakdownItems([...entry.to_breakdown, ...listOrEmpty(category.to_breakdown)]);
    }
  }

  const yearExpenseTotal = [...totalsByName.values()].reduce((sum, e) => sum + e.total_minor, 0);

  return [...totalsByName.entries()]
    .sort(([nameA], [nameB]) => {
      if (nameA === "Uncategorized" && nameB !== "Uncategorized") return 1;
      if (nameB === "Uncategorized" && nameA !== "Uncategorized") return -1;
      const aTotal = totalsByName.get(nameA)!.total_minor;
      const bTotal = totalsByName.get(nameB)!.total_minor;
      return bTotal - aTotal;
    })
    .map(([name, entry]) => ({
      name,
      total_minor: entry.total_minor,
      share: yearExpenseTotal > 0 ? entry.total_minor / yearExpenseTotal : 0,
      entry_count: entry.entry_count,
      children: [...entry.children.values()]
        .sort((a, b) => b.total_minor - a.total_minor)
        .map((child) => ({
          name: child.name,
          path: child.path,
          total_minor: child.total_minor,
          share: entry.total_minor > 0 ? child.total_minor / entry.total_minor : 0,
          entry_count: child.entry_count,
          to_breakdown: child.to_breakdown
        })),
      to_breakdown: entry.to_breakdown
    }));
}

/** Aggregate the lifecycle cross-cut across months for a yearly view. */
export function buildYearlyLifecycleTotals(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>
): DashboardLifecycleSummary[] {
  const map = new Map<string, { total_minor: number; entry_count: number }>();
  for (const monthKey of monthKeys) {
    const dashboard = dashboardsByMonth.get(monthKey);
    if (!dashboard) continue;
    for (const lifecycle of dashboard.lifecycles) {
      const key = lifecycle.lifecycle ?? "none";
      const existing = map.get(key) ?? { total_minor: 0, entry_count: 0 };
      existing.total_minor += lifecycle.total_minor;
      existing.entry_count += lifecycle.entry_count;
      map.set(key, existing);
    }
  }
  const total = [...map.values()].reduce((sum, entry) => sum + entry.total_minor, 0);
  const order = ["fixed", "day_to_day", "one_time", "none"];
  return [...map.entries()]
    .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    .map(([key, entry]) => ({
      lifecycle: key === "none" ? null : key,
      total_minor: entry.total_minor,
      share: total > 0 ? entry.total_minor / total : 0,
      entry_count: entry.entry_count
    }));
}

/** Aggregate group cross-cuts across months for a yearly view. */
export function buildYearlyGroupTotals(
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>
): DashboardGroupSummary[] {
  const map = new Map<
    string,
    {
      group_id: string;
      name: string;
      source: DashboardGroupSummary["source"];
      color: string | null;
      total_minor: number;
      entry_count: number;
    }
  >();
  for (const monthKey of monthKeys) {
    const dashboard = dashboardsByMonth.get(monthKey);
    if (!dashboard) continue;
    for (const group of dashboard.groups) {
      const existing = map.get(group.group_id);
      if (!existing) {
        map.set(group.group_id, {
          group_id: group.group_id,
          name: group.name,
          source: group.source,
          color: nullishToNull(group.color),
          total_minor: group.total_minor,
          entry_count: group.entry_count
        });
      } else {
        existing.total_minor += group.total_minor;
        existing.entry_count += group.entry_count;
      }
    }
  }
  const yearExpenseTotal = sumDashboardKpiForMonths(monthKeys, dashboardsByMonth, "expense_total_minor");
  return [...map.values()]
    .map((entry) => ({
      group_id: entry.group_id,
      name: entry.name,
      source: entry.source,
      color: entry.color,
      total_minor: entry.total_minor,
      share: yearExpenseTotal > 0 ? entry.total_minor / yearExpenseTotal : 0,
      entry_count: entry.entry_count
    }))
    .sort((left, right) => right.total_minor - left.total_minor);
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}

export function formatDelta(deltaMinor: number, currencyCode: string): string {
  const prefix = deltaMinor > 0 ? "+" : deltaMinor < 0 ? "-" : "";
  return `${prefix}${formatMinor(Math.abs(deltaMinor), currencyCode)}`;
}

type ChartDimensions = {
  width: number;
  height: number;
};

export function DashboardChartContainer({
  children
}: {
  children: (dimensions: ChartDimensions) => ReactElement;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<ChartDimensions | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateDimensions = () => {
      const nextWidth = Math.floor(element.clientWidth);
      const nextHeight = Math.floor(element.clientHeight);
      if (nextWidth <= 0 || nextHeight <= 0) {
        return;
      }

      setDimensions((current) => {
        if (current?.width === nextWidth && current?.height === nextHeight) {
          return current;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateDimensions();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateDimensions();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return <div ref={containerRef} className="h-full min-w-0">{dimensions ? children(dimensions) : null}</div>;
}

export function buildDailyChartData(data: Dashboard) {
  return data.daily_spending.map((point) => ({
    date: point.date,
    expense_total_minor: point.expense_total_minor,
    ...point.category_totals
  }));
}

export function buildMonthlyChartData(data: Dashboard) {
  return data.monthly_trend.map((point) => ({
    month: point.month,
    expense_total_minor: point.expense_total_minor,
    income_total_minor: point.income_total_minor,
    ...point.category_totals,
    ...point.lifecycle_totals
  }));
}

/** Visible month buckets for the dashboard Income vs Expense trend (month view). */
export const TREND_CHART_MONTH_COUNT = 6;

/** Take the last `count` chronologically ordered trend points (ending at the API window's last month). */
export function takeLastTrendMonthPoints<T>(points: T[], count = TREND_CHART_MONTH_COUNT): T[] {
  if (count <= 0) {
    return [];
  }
  return points.slice(-count);
}
