/**
 * CALLING SPEC:
 * - Purpose: orchestrate dashboard queries, scope selection, and tab routing for the dashboard page.
 * - Inputs: dashboard API queries, route-local selection state, and dashboard feature panel components.
 * - Outputs: the dashboard page shell with derived monthly and yearly view models.
 * - Side effects: dashboard data fetching and UI event wiring.
 */

import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PageHeader } from "../components/layout/PageHeader";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { WorkspaceToolbar } from "../components/layout/WorkspaceToolbar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { DashboardPageSkeleton } from "../features/dashboard/DashboardPageSkeleton";
import {
  DashboardDailyPanel,
  DashboardIncomePanel,
  DashboardInsightsPanel,
  DashboardOverviewPanel
} from "../features/dashboard/DashboardPanels";
import { DashboardPeriodControls, TIMELINE_ITEM_KEY } from "../features/dashboard/DashboardPeriodControls";
import { usePrefetchDashboard } from "../features/dashboard/usePrefetchDashboard";
import {
  CHART_COLORS,
  DASHBOARD_TABS,
  type DashboardTab,
  type DashboardViewMode,
  DashboardChartContainer,
  axisTick,
  buildDailyChartData,
  buildMonthlyChartData,
  buildTimelineYears,
  buildYearLargestExpenses,
  buildYearMonthKeys,
  buildYearlyFilterGroupsWithTagTotals,
  buildYearlyOverviewData,
  builtinGroupColor,
  builtinIncomeGroupColor,
  filterGroupNamesByKey,
  filterGroupTotalForMonth,
  isIncomeFilterGroupKey,
  median,
  mergeBreakdownItems,
  takeLastTrendMonthPoints,
  pickTimelineMonthForYear,
  sortByBuiltinOrder,
  sortByIncomeBarOrder,
  sortByIncomeTrendOrder,
  sumDashboardKpiForMonths,
  sumFilterGroupForMonths,
  tooltipAmount
} from "../features/dashboard/helpers";
import { getDashboard, getDashboardBatch, getDashboardTimeline } from "../lib/api";
import { currentMonth } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import type { Dashboard } from "../lib/types";
import { cn } from "../lib/utils";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { STACKED_BAR_CHART_MARGINS, STACKED_BAR_SQRT_Y_AXIS, STACKED_BAR_Y_AXIS_WIDTH, stackedTrendBarLayout, stackTopBarLabel } from "../features/dashboard/BarChartValueLabels";

const LazyAgentCostDashboard = lazy(async () => {
  const module = await import("../features/dashboard/AgentCostDashboard");
  return { default: module.AgentCostDashboard };
});

const LazyDashboardBreakdownsPanel = lazy(async () => {
  const module = await import("../features/dashboard/DashboardBreakdownsPanel");
  return { default: module.DashboardBreakdownsPanel };
});

function DashboardTabFallback() {
  return <p className="muted text-sm">Loading tab...</p>;
}

type IncomeTrendChartProps = {
  data: Array<Record<string, unknown>>;
  trendGroups: Array<{ key: string; name: string }>;
  incomeTrendGroups: Array<{ key: string; name: string }>;
  currencyCode: string;
};

function IncomeTrendChart({ data: chartData, trendGroups, incomeTrendGroups, currencyCode }: IncomeTrendChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const incomeStackKeys = incomeTrendGroups.map((group) => group.key);
  const expenseStackKeys = trendGroups.map((group) => group.key);
  const barLayout = stackedTrendBarLayout(chartData.length);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        <DashboardChartContainer>
          {({ width, height }) => (
            <BarChart
              width={width}
              height={height}
              data={chartData}
              barCategoryGap={barLayout.barCategoryGap}
              barGap={barLayout.barGap}
              margin={STACKED_BAR_CHART_MARGINS}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
              <XAxis dataKey="month" />
              <YAxis
                tickFormatter={axisTick}
                width={STACKED_BAR_Y_AXIS_WIDTH}
                tickMargin={6}
                {...STACKED_BAR_SQRT_Y_AXIS}
              />
              <Tooltip
                content={({ payload, label }) => {
                  const active = payload?.find((p) => p.dataKey === hoveredKey) ?? payload?.[0];
                  if (!active) return null;
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
                      <p className="text-muted-foreground mb-1">{String(label)}</p>
                      <p className="font-medium">{String(active.name)}: {tooltipAmount(currencyCode, active.value)}</p>
                    </div>
                  );
                }}
              />
              {incomeTrendGroups.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.name}
                  stackId="income"
                  fill={builtinIncomeGroupColor(group.key)}
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredKey(group.key)}
                  label={stackTopBarLabel({ stackKeys: incomeStackKeys, segmentKey: group.key })}
                />
              ))}
              {trendGroups.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.name}
                  stackId="expense-trend"
                  fill={builtinGroupColor(group.key)}
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredKey(group.key)}
                  label={stackTopBarLabel({ stackKeys: expenseStackKeys, segmentKey: group.key })}
                />
              ))}
            </BarChart>
          )}
        </DashboardChartContainer>
      </div>
      <div
        className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"
        aria-label="Income and expense segment legend"
      >
        <div className="space-y-1">
          <p className="text-[0.7rem] font-medium uppercase tracking-wide text-foreground">Income</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {incomeTrendGroups.map((group) => (
              <li key={group.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: builtinIncomeGroupColor(group.key) }}
                  aria-hidden
                />
                <span>{group.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="text-[0.7rem] font-medium uppercase tracking-wide text-foreground">Expense</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {trendGroups.map((group) => (
              <li key={group.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: builtinGroupColor(group.key) }}
                  aria-hidden
                />
                <span>{group.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { prefetchYearDashboard } = usePrefetchDashboard();
  const [month, setMonth] = useState(currentMonth());
  const [viewMode, setViewMode] = useState<DashboardViewMode>("month");
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const timelineItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const yearScrollRef = useRef<HTMLDivElement>(null);
  const monthScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollBehaviorRef = useRef<ScrollBehavior>("auto");

  const timelineQuery = useQuery({
    queryKey: queryKeys.dashboard.timeline,
    queryFn: getDashboardTimeline,
    staleTime: 60_000
  });
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard.month(month),
    queryFn: () => getDashboard(month),
    staleTime: 60_000
  });

  const anchorMonthForTrend = currentMonth();
  const needsTrendAnchorQuery = viewMode === "month" && month !== anchorMonthForTrend;
  const trendAnchorDashboardQuery = useQuery({
    queryKey: queryKeys.dashboard.month(anchorMonthForTrend),
    queryFn: () => getDashboard(anchorMonthForTrend),
    staleTime: 60_000,
    enabled: needsTrendAnchorQuery
  });

  const timelineMonths = timelineQuery.data?.months ?? [];
  const timelineYears = buildTimelineYears(timelineMonths);
  const selectedYear = Number(month.slice(0, 4));
  const selectedYearMonths = buildYearMonthKeys(selectedYear);
  const previousYearMonths = buildYearMonthKeys(selectedYear - 1);
  const yearlyMonthKeys = [...previousYearMonths, ...selectedYearMonths];

  const yearBatchQuery = useQuery({
    queryKey: queryKeys.dashboard.batch(yearlyMonthKeys),
    queryFn: () => getDashboardBatch(yearlyMonthKeys),
    staleTime: 60_000,
    enabled: viewMode === "year"
  });

  useEffect(() => {
    if (!yearBatchQuery.data) {
      return;
    }
    for (const dashboard of yearBatchQuery.data.dashboards) {
      queryClient.setQueryData(queryKeys.dashboard.month(dashboard.month), dashboard);
    }
  }, [queryClient, yearBatchQuery.data]);

  const monthTimelineIndex = timelineMonths.indexOf(month);
  const yearTimelineIndex = timelineYears.indexOf(String(selectedYear));

  function setTimelineMonth(nextMonth: string, behavior: ScrollBehavior = "smooth") {
    if (!nextMonth || nextMonth === month) {
      return;
    }
    timelineScrollBehaviorRef.current = behavior;
    setMonth(nextMonth);
  }

  /** Align the selected chip’s trailing edge with the strip’s trailing edge (newest items live on the right). */
  function alignTimelineChipToTrailingEdge(
    scroller: HTMLDivElement | null,
    selectedItem: HTMLButtonElement,
    behavior: ScrollBehavior = "auto"
  ) {
    if (!scroller) {
      return;
    }
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (maxScroll <= 0) {
      return;
    }
    const itemTrailing = selectedItem.offsetLeft + selectedItem.offsetWidth;
    let nextLeft = itemTrailing - scroller.clientWidth;
    if (selectedItem.offsetWidth > scroller.clientWidth) {
      nextLeft = selectedItem.offsetLeft;
    }
    nextLeft = Math.max(0, Math.min(maxScroll, nextLeft));
    scroller.scrollTo({ left: nextLeft, behavior });
  }

  function registerTimelineItem(key: string, node: HTMLButtonElement | null) {
    if (!node) {
      timelineItemRefs.current.delete(key);
      return;
    }
    timelineItemRefs.current.set(key, node);
  }

  function shiftYearSelection(step: number) {
    if (timelineYears.length === 0) {
      return;
    }
    const currentIndex = yearTimelineIndex >= 0 ? yearTimelineIndex : timelineYears.length - 1;
    const nextYear = timelineYears[Math.max(0, Math.min(timelineYears.length - 1, currentIndex + step))];
    const nextMonth = pickTimelineMonthForYear(timelineMonths, nextYear, month);
    if (nextMonth && nextMonth !== month) {
      setTimelineMonth(nextMonth);
    }
  }

  function shiftMonthSelection(step: number) {
    if (viewMode !== "month") {
      return;
    }
    const yearMonths = buildYearMonthKeys(selectedYear).filter((monthKey) => timelineMonths.includes(monthKey));
    if (yearMonths.length === 0) {
      return;
    }
    const currentIndex = yearMonths.indexOf(month);
    const resolvedIndex = currentIndex >= 0 ? currentIndex : yearMonths.length - 1;
    const nextMonth = yearMonths[Math.max(0, Math.min(yearMonths.length - 1, resolvedIndex + step))];
    if (nextMonth && nextMonth !== month) {
      setTimelineMonth(nextMonth);
    }
  }

  function handleYearKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      shiftYearSelection(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      shiftYearSelection(-1);
    }
  }

  function handleMonthKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      shiftMonthSelection(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      shiftMonthSelection(-1);
    }
  }

  useEffect(() => {
    if (timelineMonths.length === 0 || monthTimelineIndex >= 0) {
      return;
    }
    const fallbackMonth = timelineMonths[timelineMonths.length - 1];
    if (fallbackMonth !== month) {
      setTimelineMonth(fallbackMonth, "auto");
    }
  }, [month, monthTimelineIndex, timelineMonths]);

  useEffect(() => {
    if (viewMode !== "year" || timelineYears.length === 0 || yearTimelineIndex >= 0) {
      return;
    }
    const fallbackYear = timelineYears[timelineYears.length - 1];
    const fallbackMonth = pickTimelineMonthForYear(timelineMonths, fallbackYear, month);
    if (fallbackMonth && fallbackMonth !== month) {
      setTimelineMonth(fallbackMonth, "auto");
    }
  }, [month, timelineMonths, timelineYears, viewMode, yearTimelineIndex]);

  const dashboardContentReady =
    dashboardQuery.isSuccess && dashboardQuery.data != null && timelineQuery.isSuccess;

  useEffect(() => {
    if (!dashboardContentReady) {
      return;
    }

    const behavior = timelineScrollBehaviorRef.current;
    timelineScrollBehaviorRef.current = "auto";

    const scrollTargets: Array<[HTMLDivElement | null, string]> = [
      [yearScrollRef.current, TIMELINE_ITEM_KEY.year(String(selectedYear))],
      ...(viewMode === "month" ? [[monthScrollRef.current, TIMELINE_ITEM_KEY.month(month)] as [HTMLDivElement | null, string]] : [])
    ];

    // Double rAF: first frame after mount, second after scrollWidth/layout settle.
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        for (const [scroller, key] of scrollTargets) {
          const selectedItem = timelineItemRefs.current.get(key);
          if (selectedItem) {
            alignTimelineChipToTrailingEdge(scroller, selectedItem, behavior);
          }
        }
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) {
        cancelAnimationFrame(frame2);
      }
    };
  }, [dashboardContentReady, month, selectedYear, viewMode]);

  if (dashboardQuery.isLoading || !dashboardQuery.data) {
    return (
      <DashboardPageSkeleton
        activeTab={activeTab}
        onTabChange={setActiveTab}
        timelineLoading={timelineQuery.isLoading}
        trendLoading
        panelLoading
      />
    );
  }

  if (dashboardQuery.isError) {
    return <p>Failed to load dashboard: {(dashboardQuery.error as Error).message}</p>;
  }

  const data = dashboardQuery.data;
  const timelineErrorMessage = timelineQuery.isError ? (timelineQuery.error as Error).message : null;
  const yearlyDashboardsByMonth = new Map<string, Dashboard>();
  if (viewMode === "year") {
    for (const dashboard of yearBatchQuery.data?.dashboards ?? []) {
      yearlyDashboardsByMonth.set(dashboard.month, dashboard);
    }
  }

  const yearlyQueriesLoading = viewMode === "year" && yearBatchQuery.isLoading;
  const yearlyQueryError =
    viewMode === "year" && yearBatchQuery.isError ? (yearBatchQuery.error as Error) : undefined;
  const dailyChartData = buildDailyChartData(data);
  const monthlyChartData = buildMonthlyChartData(data);
  const yearlyOverviewData = buildYearlyOverviewData(selectedYearMonths, yearlyDashboardsByMonth, data.filter_groups);

  const monthViewTrendSourceDashboard =
    viewMode === "month"
      ? month === anchorMonthForTrend
        ? data
        : trendAnchorDashboardQuery.data
      : undefined;
  const monthViewTrendChartData =
    viewMode === "month"
      ? monthViewTrendSourceDashboard
        ? buildMonthlyChartData(monthViewTrendSourceDashboard)
        : []
      : monthlyChartData;
  const trendGroupSourcePoints = viewMode === "month" ? monthViewTrendChartData : monthlyChartData;

  // Trend chart: expense groups (exclude income groups) and income groups
  const sortedFilterGroups = sortByBuiltinOrder(data.filter_groups);
  const expenseGroups = sortedFilterGroups.filter((g) => !isIncomeFilterGroupKey(g.key));
  const incomeGroups = sortedFilterGroups.filter((g) => isIncomeFilterGroupKey(g.key));
  const monthlyExpenseTrendGroups = expenseGroups.filter((group) =>
    trendGroupSourcePoints.some((point) => Number((point as Record<string, unknown>)[group.key] ?? 0) > 0)
  );
  const expenseTrendGroups = monthlyExpenseTrendGroups.length > 0 ? monthlyExpenseTrendGroups : expenseGroups;
  const yearlyExpenseTrendGroupsRaw = expenseGroups.filter((group) =>
    yearlyOverviewData.some((point) => Number((point as Record<string, unknown>)[group.key] ?? 0) > 0)
  );
  const yearlyExpenseTrendGroups = yearlyExpenseTrendGroupsRaw.length > 0 ? yearlyExpenseTrendGroupsRaw : expenseGroups;
  const monthlyIncomeTrendGroups = incomeGroups.filter((group) =>
    trendGroupSourcePoints.some((point) => Number((point as Record<string, unknown>)[group.key] ?? 0) > 0)
  );
  const incomeTrendGroups = sortByIncomeBarOrder(
    monthlyIncomeTrendGroups.length > 0 ? monthlyIncomeTrendGroups : incomeGroups
  );

  const insightsLargestExpenses =
    viewMode === "year" ? buildYearLargestExpenses(selectedYearMonths, yearlyDashboardsByMonth) : data.largest_expenses;
  const groupNamesByKey = filterGroupNamesByKey(data);
  const primaryFilterGroup = data.filter_groups.find((group) => group.key === "day_to_day") ?? data.filter_groups[0] ?? null;
  const selectedYearExpenseTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "expense_total_minor");
  const selectedYearIncomeTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "income_total_minor");
  const selectedYearNetTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "net_total_minor");
  const yearlyPrimaryFilterGroupTotalMinor = primaryFilterGroup
    ? sumFilterGroupForMonths(selectedYearMonths, yearlyDashboardsByMonth, primaryFilterGroup.key)
    : 0;
  const yearlyExpenseMonths = yearlyOverviewData.map((point) => point.expense_total_minor);
  const yearlyAverageExpenseMonthMinor =
    yearlyExpenseMonths.length > 0 ? Math.round(selectedYearExpenseTotalMinor / yearlyExpenseMonths.length) : 0;
  const yearlyMedianExpenseMonthMinor = median(yearlyExpenseMonths);

  const trendChartData =
    viewMode === "month" ? takeLastTrendMonthPoints(monthViewTrendChartData) : yearlyOverviewData;
  const expenseOnlyGroups = sortedFilterGroups.filter((g) => !isIncomeFilterGroupKey(g.key));
  const expenseTrendGroupsFiltered =
    viewMode === "month"
      ? (monthlyExpenseTrendGroups.length > 0 ? monthlyExpenseTrendGroups : expenseOnlyGroups).filter(
          (g) => !isIncomeFilterGroupKey(g.key)
        )
      : (yearlyExpenseTrendGroupsRaw.length > 0 ? yearlyExpenseTrendGroupsRaw : expenseOnlyGroups).filter(
          (g) => !isIncomeFilterGroupKey(g.key)
        );
  const trendGroups = sortByIncomeTrendOrder(viewMode === "month" ? expenseTrendGroupsFiltered : expenseTrendGroupsFiltered);
  const trendTitle = viewMode === "month" ? "Income vs Expense Trend" : `${selectedYear} Income vs Expense Trend`;
  const overviewFilterGroups =
    viewMode === "year"
      ? buildYearlyFilterGroupsWithTagTotals(data.filter_groups, selectedYearMonths, yearlyDashboardsByMonth)
      : data.filter_groups;
  const incomeByFromItems =
    viewMode === "year"
      ? mergeBreakdownItems(
          selectedYearMonths.map((monthKey) => yearlyDashboardsByMonth.get(monthKey)?.income_by_from ?? [])
        )
      : data.income_by_from;
  const salaryTotalMinor =
    viewMode === "year"
      ? sumFilterGroupForMonths(selectedYearMonths, yearlyDashboardsByMonth, "salary")
      : filterGroupTotalForMonth(data, "salary");
  const otherIncomeTotalMinor =
    viewMode === "year"
      ? sumFilterGroupForMonths(selectedYearMonths, yearlyDashboardsByMonth, "other_income")
      : filterGroupTotalForMonth(data, "other_income");
  const incomePanelTotalMinor = viewMode === "year" ? selectedYearIncomeTotalMinor : data.kpis.income_total_minor;
  const incomePanelNetTotalMinor = viewMode === "year" ? selectedYearNetTotalMinor : data.kpis.net_total_minor;
  return (
    <div className="dashboard-page-layout">
      <div className="stack-lg min-w-0">
        <PageHeader title="Dashboard" description="Month and year ledger trends." />

        <Card>
          <CardHeader>
            <CardTitle>{trendTitle}</CardTitle>
          </CardHeader>
          <CardContent className="h-80 min-w-0">
            {viewMode === "year" && yearlyQueriesLoading ? (
              <p className="muted text-sm">Loading yearly trend...</p>
            ) : viewMode === "month" && needsTrendAnchorQuery && trendAnchorDashboardQuery.isLoading ? (
              <p className="muted text-sm">Loading trend...</p>
            ) : viewMode === "month" && needsTrendAnchorQuery && trendAnchorDashboardQuery.isError ? (
              <p className="error">Failed to load trend: {(trendAnchorDashboardQuery.error as Error).message}</p>
            ) : (
              <IncomeTrendChart
                data={trendChartData}
                trendGroups={trendGroups}
                incomeTrendGroups={incomeTrendGroups}
                currencyCode={data.currency_code}
              />
            )}
          </CardContent>
        </Card>

        <WorkspaceSection>
          <WorkspaceToolbar className="dashboard-toolbar">
            <div className="field dashboard-toolbar-view">
              <span>View</span>
              <div className="dashboard-view-toggle" role="tablist" aria-label="Dashboard period view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "month"}
                  className={cn("dashboard-view-toggle-button", viewMode === "month" && "dashboard-view-toggle-button-active")}
                  onClick={() => setViewMode("month")}
                >
                  Month
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === "year"}
                  className={cn("dashboard-view-toggle-button", viewMode === "year" && "dashboard-view-toggle-button-active")}
                  onClick={() => setViewMode("year")}
                  onMouseEnter={() => prefetchYearDashboard(yearlyMonthKeys)}
                  onFocus={() => prefetchYearDashboard(yearlyMonthKeys)}
                >
                  Year
                </button>
              </div>
            </div>
            {timelineQuery.isLoading ? (
              <>
                <div className="field dashboard-toolbar-year dashboard-timeline-strip-field">
                  <span>Year</span>
                  <div className="dashboard-skeleton-timeline" aria-hidden="true">
                    {Array.from({ length: 5 }, (_, index) => (
                      <div key={index} className="dashboard-skeleton-chip dashboard-skeleton-block" />
                    ))}
                  </div>
                </div>
                <div className="field dashboard-toolbar-month dashboard-timeline-strip-field">
                  <span>Month</span>
                  <div className="dashboard-skeleton-timeline" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, index) => (
                      <div key={index} className="dashboard-skeleton-chip dashboard-skeleton-block" />
                    ))}
                  </div>
                </div>
              </>
            ) : timelineErrorMessage ? (
              <>
                <div className="field dashboard-toolbar-year dashboard-timeline-strip-field">
                  <span>Year</span>
                  <p className="error text-sm">Failed to load dashboard timeline: {timelineErrorMessage}</p>
                </div>
                <div className="field dashboard-toolbar-month dashboard-timeline-strip-field">
                  <span>Month</span>
                  <p className="error text-sm">Failed to load dashboard timeline: {timelineErrorMessage}</p>
                </div>
              </>
            ) : (
              <DashboardPeriodControls
                viewMode={viewMode}
                month={month}
                selectedYear={selectedYear}
                timelineMonths={timelineMonths}
                timelineYears={timelineYears}
                yearScrollRef={yearScrollRef}
                monthScrollRef={monthScrollRef}
                registerTimelineItem={registerTimelineItem}
                setTimelineMonth={setTimelineMonth}
                onYearKeyDown={handleYearKeyDown}
                onMonthKeyDown={handleMonthKeyDown}
              />
            )}
          </WorkspaceToolbar>

          <div className="dashboard-tab-list" role="tablist" aria-label="Dashboard sections">
            {DASHBOARD_TABS.map((tab) => (
              <Button
                key={tab.id}
                id={`dashboard-tab-${tab.id}`}
                role="tab"
                aria-controls={`dashboard-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                variant={activeTab === tab.id ? "default" : "outline"}
                size="sm"
                className={cn("dashboard-tab-button", activeTab === tab.id ? "dashboard-tab-active" : "")}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </WorkspaceSection>

        {activeTab === "overview" ? (
          <DashboardOverviewPanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            data={data}
            overviewFilterGroups={overviewFilterGroups}
            primaryFilterGroup={primaryFilterGroup}
            yearlyQueriesLoading={yearlyQueriesLoading}
            yearlyQueryError={yearlyQueryError}
            selectedYearExpenseTotalMinor={selectedYearExpenseTotalMinor}
            selectedYearIncomeTotalMinor={selectedYearIncomeTotalMinor}
            selectedYearNetTotalMinor={selectedYearNetTotalMinor}
            yearlyPrimaryFilterGroupTotalMinor={yearlyPrimaryFilterGroupTotalMinor}
          />
        ) : null}

        {activeTab === "income" ? (
          <DashboardIncomePanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            currencyCode={data.currency_code}
            incomeByFrom={incomeByFromItems}
            totalIncomeMinor={incomePanelTotalMinor}
            salaryTotalMinor={salaryTotalMinor}
            otherIncomeTotalMinor={otherIncomeTotalMinor}
            netTotalMinor={incomePanelNetTotalMinor}
            yearlyQueriesLoading={yearlyQueriesLoading}
          />
        ) : null}

        {activeTab === "daily" ? (
          <DashboardDailyPanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            data={data}
            dailyChartData={dailyChartData}
            yearlyQueriesLoading={yearlyQueriesLoading}
            yearlyQueryError={yearlyQueryError}
            yearlyOverviewData={yearlyOverviewData}
            yearlyAverageExpenseMonthMinor={yearlyAverageExpenseMonthMinor}
            yearlyMedianExpenseMonthMinor={yearlyMedianExpenseMonthMinor}
          />
        ) : null}

        {activeTab === "breakdowns" ? (
          <Suspense fallback={<DashboardTabFallback />}>
            <LazyDashboardBreakdownsPanel viewMode={viewMode} month={month} data={data} />
          </Suspense>
        ) : null}

        {activeTab === "insights" ? (
          <DashboardInsightsPanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            month={month}
            data={data}
            insightsLargestExpenses={insightsLargestExpenses}
            groupNamesByKey={groupNamesByKey}
          />
        ) : null}

        {activeTab === "agent" ? (
          <Suspense fallback={<DashboardTabFallback />}>
            <LazyAgentCostDashboard />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
