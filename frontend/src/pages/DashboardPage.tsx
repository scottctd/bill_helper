/**
 * CALLING SPEC:
 * - Purpose: orchestrate dashboard queries, scope selection, and tab routing for the dashboard page.
 * - Inputs: dashboard API queries, route-local selection state, and dashboard feature panel components.
 * - Outputs: the dashboard page shell with derived monthly and yearly view models.
 * - Side effects: dashboard data fetching and UI event wiring.
 */

import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { WorkspaceToolbar } from "../components/layout/WorkspaceToolbar";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { DashboardBreakdownPanel } from "../features/dashboard/DashboardBreakdownsPanel";
import { DashboardPageSkeleton } from "../features/dashboard/DashboardPageSkeleton";
import { DashboardIncomePanel, DashboardSpendingPanel } from "../features/dashboard/DashboardPanels";
import { DashboardPeriodControls, TIMELINE_ITEM_KEY } from "../features/dashboard/DashboardPeriodControls";
import { DashboardSummaryHero } from "../features/dashboard/DashboardSummaryHero";
import { DashboardTrendChart } from "../features/dashboard/DashboardTrendChart";
import { usePrefetchDashboard } from "../features/dashboard/usePrefetchDashboard";
import {
  DASHBOARD_TABS,
  type DashboardTab,
  type DashboardViewMode,
  buildDailyChartData,
  buildMonthlyChartData,
  buildTimelineYears,
  buildYearMonthKeys,
  buildYearlyCategoryTotals,
  buildYearlyFilterGroupTotals,
  buildYearlyLifecycleTotals,
  buildYearlyOverviewData,
  median,
  DESTINATION_BREAKDOWN_LIMIT,
  mergeBreakdownItems,
  sumDashboardKpiForMonths,
  sumLifecycleForMonths,
  takeLastTrendMonthPoints,
  pickTimelineMonthForYear,
  formatMonthLong
} from "../features/dashboard/helpers";
import { getDashboard, getDashboardBatch, getDashboardTimeline } from "../lib/api";
import { currentMonth } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import type { Dashboard } from "../lib/types";
import { cn } from "../lib/utils";

const LazyAgentCostDashboard = lazy(async () => {
  const module = await import("../features/dashboard/AgentCostDashboard");
  return { default: module.AgentCostDashboard };
});

function DashboardTabFallback() {
  return <p className="muted text-sm">Loading tab...</p>;
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { prefetchYearDashboard } = usePrefetchDashboard();
  const [month, setMonth] = useState(currentMonth());
  const [viewMode, setViewMode] = useState<DashboardViewMode>("month");
  const [activeTab, setActiveTab] = useState<DashboardTab>("spending");
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
  const yearlyOverviewData = buildYearlyOverviewData(selectedYearMonths, yearlyDashboardsByMonth);

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
  const selectedYearExpenseTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "expense_total_minor");
  const selectedYearIncomeTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "income_total_minor");
  const selectedYearNetTotalMinor = sumDashboardKpiForMonths(selectedYearMonths, yearlyDashboardsByMonth, "net_total_minor");
  const selectedYearOneTimeTotalMinor = sumLifecycleForMonths(
    selectedYearMonths,
    yearlyDashboardsByMonth,
    "one_time"
  );
  const selectedYearCashWithdrawalTotalMinor = sumDashboardKpiForMonths(
    selectedYearMonths,
    yearlyDashboardsByMonth,
    "cash_withdrawal_total_minor"
  );
  const yearlyExpenseMonths = yearlyOverviewData.map((point) => point.expense_total_minor);
  const yearlyAverageExpenseMonthMinor =
    yearlyExpenseMonths.length > 0 ? Math.round(selectedYearExpenseTotalMinor / yearlyExpenseMonths.length) : 0;
  const yearlyMedianExpenseMonthMinor = median(yearlyExpenseMonths);

  const trendChartData =
    viewMode === "month" ? takeLastTrendMonthPoints(monthViewTrendChartData) : yearlyOverviewData;
  const trendTitle = viewMode === "month" ? "Income vs Expense Trend" : `${selectedYear} Income vs Expense Trend`;

  const spendingCategories =
    viewMode === "year"
      ? buildYearlyCategoryTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data.categories;
  const spendingLifecycles =
    viewMode === "year"
      ? buildYearlyLifecycleTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data.lifecycles;
  const spendingFilterGroups =
    viewMode === "year"
      ? buildYearlyFilterGroupTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data.filter_groups;

  const spendingByDestination =
    viewMode === "year"
      ? mergeBreakdownItems(
          selectedYearMonths.map((monthKey) => yearlyDashboardsByMonth.get(monthKey)?.spending_by_to ?? []),
          DESTINATION_BREAKDOWN_LIMIT
        )
      : data.spending_by_to;

  const breakdownCategories =
    viewMode === "year"
      ? buildYearlyCategoryTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data.categories;

  const breakdownScopeLabel = viewMode === "year" ? String(selectedYear) : formatMonthLong(month);
  const breakdownExpenseTotalMinor =
    viewMode === "year" ? selectedYearExpenseTotalMinor : data.kpis.expense_total_minor;

  const incomeByFromItems =
    viewMode === "year"
      ? mergeBreakdownItems(
          selectedYearMonths.map((monthKey) => yearlyDashboardsByMonth.get(monthKey)?.income_by_from ?? [])
        )
      : data.income_by_from;
  const heroIncomeTotalMinor = viewMode === "year" ? selectedYearIncomeTotalMinor : data.kpis.income_total_minor;
  const heroExpenseTotalMinor = viewMode === "year" ? selectedYearExpenseTotalMinor : data.kpis.expense_total_minor;
  const heroNetTotalMinor = viewMode === "year" ? selectedYearNetTotalMinor : data.kpis.net_total_minor;
  const heroCashWithdrawalTotalMinor =
    viewMode === "year" ? selectedYearCashWithdrawalTotalMinor : data.kpis.cash_withdrawal_total_minor;
  const heroOneTimeTotalMinor =
    viewMode === "year" ? selectedYearOneTimeTotalMinor : data.kpis.one_time_total_minor;
  const heroExpenseLessOneTimeTotalMinor = Math.max(0, heroExpenseTotalMinor - heroOneTimeTotalMinor);

  const showFinanceChrome = activeTab !== "agent";

  return (
    <div className="dashboard-page-layout">
      <div className="stack-lg min-w-0">
        {showFinanceChrome ? (
          <>
            <DashboardSummaryHero
              viewMode={viewMode}
              selectedYear={selectedYear}
              currencyCode={data.currency_code}
              incomeTotalMinor={heroIncomeTotalMinor}
              expenseTotalMinor={heroExpenseTotalMinor}
              netTotalMinor={heroNetTotalMinor}
              cashWithdrawalTotalMinor={heroCashWithdrawalTotalMinor}
              expenseLessOneTimeTotalMinor={heroExpenseLessOneTimeTotalMinor}
            />

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
                  <DashboardTrendChart data={trendChartData} currencyCode={data.currency_code} />
                )}
              </CardContent>
            </Card>
          </>
        ) : null}

        <WorkspaceSection>
          {showFinanceChrome ? (
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
          ) : null}

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

        {activeTab === "spending" ? (
          <DashboardSpendingPanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            data={data}
            categories={spendingCategories}
            lifecycles={spendingLifecycles}
            filterGroups={spendingFilterGroups}
            spendingByDestination={spendingByDestination}
            dailyChartData={dailyChartData}
            yearlyQueriesLoading={yearlyQueriesLoading}
            yearlyQueryError={yearlyQueryError}
            yearlyOverviewData={yearlyOverviewData}
            yearlyAverageExpenseMonthMinor={yearlyAverageExpenseMonthMinor}
            yearlyMedianExpenseMonthMinor={yearlyMedianExpenseMonthMinor}
          />
        ) : null}

        {activeTab === "breakdown" ? (
          <DashboardBreakdownPanel
            scopeLabel={breakdownScopeLabel}
            categories={breakdownCategories}
            currencyCode={data.currency_code}
            expenseTotalMinor={breakdownExpenseTotalMinor}
            yearlyQueriesLoading={yearlyQueriesLoading}
            yearlyQueryError={yearlyQueryError}
          />
        ) : null}

        {activeTab === "income" ? (
          <DashboardIncomePanel
            viewMode={viewMode}
            selectedYear={selectedYear}
            currencyCode={data.currency_code}
            incomeByFrom={incomeByFromItems}
            yearlyQueriesLoading={yearlyQueriesLoading}
          />
        ) : null}

        {activeTab === "agent" ? (
          <ErrorBoundary>
            <Suspense fallback={<DashboardTabFallback />}>
              <LazyAgentCostDashboard />
            </Suspense>
          </ErrorBoundary>
        ) : null}
      </div>
    </div>
  );
}
