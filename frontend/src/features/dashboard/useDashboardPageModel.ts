/**
 * CALLING SPEC:
 * - Purpose: own dashboard queries, period selection, derived chart data, and timeline handlers.
 * - Inputs: TanStack Query client and prefetch helper from usePrefetchDashboard.
 * - Outputs: dashboard view state, derived KPI/chart payloads, and timeline control callbacks.
 * - Side effects: dashboard data fetching, per-month cache seeding from batch responses.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { TIMELINE_ITEM_KEY } from "./DashboardPeriodControls";
import {
  type DashboardTab,
  type DashboardViewMode,
  buildDailyChartData,
  buildMonthlyChartData,
  buildTimelineYears,
  buildYearMonthKeys,
  buildYearlyCategoryTotals,
  buildYearlyGroupTotals,
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
} from "./helpers";
import { usePrefetchDashboard } from "./usePrefetchDashboard";
import { getDashboard, getDashboardBatch, getDashboardTimeline } from "../../lib/api";
import { currentMonth } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import { getApiErrorMessage } from "../../lib/api/core";
import type { Dashboard } from "../../lib/types";

export function useDashboardPageModel() {
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

  const data = dashboardQuery.data;
  const timelineErrorMessage = timelineQuery.isError ? getApiErrorMessage(timelineQuery.error) : null;

  const yearlyDashboardsByMonth = new Map<string, Dashboard>();
  if (viewMode === "year" && data) {
    for (const dashboard of yearBatchQuery.data?.dashboards ?? []) {
      yearlyDashboardsByMonth.set(dashboard.month, dashboard);
    }
  }

  const yearlyQueriesLoading = viewMode === "year" && yearBatchQuery.isLoading;
  const yearlyQueryError =
    viewMode === "year" && yearBatchQuery.isError ? getApiErrorMessage(yearBatchQuery.error) : null;

  const dailyChartData = data ? buildDailyChartData(data) : [];
  const monthlyChartData = data ? buildMonthlyChartData(data) : [];
  const yearlyOverviewData = buildYearlyOverviewData(selectedYearMonths, yearlyDashboardsByMonth);

  const monthViewTrendSourceDashboard =
    viewMode === "month" && data
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
  const selectedYearOneTimeTotalMinor = sumLifecycleForMonths(selectedYearMonths, yearlyDashboardsByMonth, "one_time");
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
    viewMode === "year" && data
      ? buildYearlyCategoryTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data?.categories ?? [];
  const spendingLifecycles =
    viewMode === "year" && data
      ? buildYearlyLifecycleTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data?.lifecycles ?? [];
  const spendingGroups =
    viewMode === "year" && data
      ? buildYearlyGroupTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data?.groups ?? [];

  const spendingByDestination =
    viewMode === "year" && data
      ? mergeBreakdownItems(
          selectedYearMonths.map((monthKey) => yearlyDashboardsByMonth.get(monthKey)?.spending_by_to ?? []),
          DESTINATION_BREAKDOWN_LIMIT
        )
      : data?.spending_by_to ?? [];

  const breakdownCategories =
    viewMode === "year" && data
      ? buildYearlyCategoryTotals(selectedYearMonths, yearlyDashboardsByMonth)
      : data?.categories ?? [];

  const breakdownScopeLabel = viewMode === "year" ? String(selectedYear) : formatMonthLong(month);
  const breakdownExpenseTotalMinor =
    viewMode === "year" ? selectedYearExpenseTotalMinor : data?.kpis.expense_total_minor ?? 0;

  const incomeByFromItems =
    viewMode === "year" && data
      ? mergeBreakdownItems(
          selectedYearMonths.map((monthKey) => yearlyDashboardsByMonth.get(monthKey)?.income_by_from ?? [])
        )
      : data?.income_by_from ?? [];
  const heroIncomeTotalMinor = viewMode === "year" ? selectedYearIncomeTotalMinor : data?.kpis.income_total_minor ?? 0;
  const heroExpenseTotalMinor = viewMode === "year" ? selectedYearExpenseTotalMinor : data?.kpis.expense_total_minor ?? 0;
  const heroNetTotalMinor = viewMode === "year" ? selectedYearNetTotalMinor : data?.kpis.net_total_minor ?? 0;
  const heroCashWithdrawalTotalMinor =
    viewMode === "year" ? selectedYearCashWithdrawalTotalMinor : data?.kpis.cash_withdrawal_total_minor ?? 0;
  const heroOneTimeTotalMinor =
    viewMode === "year" ? selectedYearOneTimeTotalMinor : data?.kpis.one_time_total_minor ?? 0;
  const heroExpenseLessOneTimeTotalMinor = Math.max(0, heroExpenseTotalMinor - heroOneTimeTotalMinor);

  const showFinanceChrome = activeTab !== "agent";

  return {
    month,
    viewMode,
    setViewMode,
    activeTab,
    setActiveTab,
    selectedYear,
    timelineMonths,
    timelineYears,
    yearlyMonthKeys,
    yearScrollRef,
    monthScrollRef,
    needsTrendAnchorQuery,
    showFinanceChrome,
    trendTitle,
    trendChartData,
    breakdownScopeLabel,
    queries: {
      timelineQuery,
      dashboardQuery,
      trendAnchorDashboardQuery,
      yearBatchQuery
    },
    derived: {
      data,
      timelineErrorMessage,
      dailyChartData,
      yearlyOverviewData,
      yearlyQueriesLoading,
      yearlyQueryError,
      yearlyAverageExpenseMonthMinor,
      yearlyMedianExpenseMonthMinor,
      spendingCategories,
      spendingLifecycles,
      spendingGroups,
      spendingByDestination,
      breakdownCategories,
      breakdownExpenseTotalMinor,
      incomeByFromItems,
      heroIncomeTotalMinor,
      heroExpenseTotalMinor,
      heroNetTotalMinor,
      heroCashWithdrawalTotalMinor,
      heroExpenseLessOneTimeTotalMinor
    },
    actions: {
      setTimelineMonth,
      registerTimelineItem,
      handleYearKeyDown,
      handleMonthKeyDown,
      prefetchYearDashboard
    }
  };
}

export type DashboardPageModel = ReturnType<typeof useDashboardPageModel>;
