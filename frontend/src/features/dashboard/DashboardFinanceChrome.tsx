/**
 * CALLING SPEC:
 * - Purpose: render dashboard finance chrome: hero, trend chart, and period toolbar.
 * - Inputs: dashboard page model fields for period selection and derived KPI data.
 * - Outputs: summary hero, trend card, and timeline controls.
 * - Side effects: user event wiring for view mode and timeline navigation.
 */
import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { DashboardPeriodControls } from "./DashboardPeriodControls";
import { DashboardSummaryHero } from "./DashboardSummaryHero";
import { DashboardTrendChart } from "./DashboardTrendChart";
import type { DashboardPageModel } from "./useDashboardPageModel";
import { cn } from "../../lib/utils";
import { getApiErrorMessage } from "../../lib/api/core";

export function DashboardFinanceChrome({ model }: { model: DashboardPageModel }) {
  const { timelineQuery, trendAnchorDashboardQuery } = model.queries;
  const derived = model.derived;
  const data = derived.data;
  if (!data) {
    return null;
  }

  return (
    <>
      <DashboardSummaryHero
        viewMode={model.viewMode}
        selectedYear={model.selectedYear}
        currencyCode={data.currency_code}
        incomeTotalMinor={derived.heroIncomeTotalMinor}
        expenseTotalMinor={derived.heroExpenseTotalMinor}
        netTotalMinor={derived.heroNetTotalMinor}
        cashWithdrawalTotalMinor={derived.heroCashWithdrawalTotalMinor}
        expenseLessOneTimeTotalMinor={derived.heroExpenseLessOneTimeTotalMinor}
      />

      <Card>
        <CardHeader>
          <CardTitle>{model.trendTitle}</CardTitle>
        </CardHeader>
        <CardContent className="h-80 min-w-0">
          {model.viewMode === "year" && derived.yearlyQueriesLoading ? (
            <p className="muted text-sm">Loading yearly trend...</p>
          ) : model.viewMode === "month" && model.needsTrendAnchorQuery && trendAnchorDashboardQuery.isLoading ? (
            <p className="muted text-sm">Loading trend...</p>
          ) : model.viewMode === "month" && model.needsTrendAnchorQuery && trendAnchorDashboardQuery.isError ? (
            <p className="error">Failed to load trend: {getApiErrorMessage(trendAnchorDashboardQuery.error)}</p>
          ) : (
            <DashboardTrendChart data={model.trendChartData} currencyCode={data.currency_code} />
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
                aria-selected={model.viewMode === "month"}
                className={cn("dashboard-view-toggle-button", model.viewMode === "month" && "dashboard-view-toggle-button-active")}
                onClick={() => model.setViewMode("month")}
              >
                Month
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={model.viewMode === "year"}
                className={cn("dashboard-view-toggle-button", model.viewMode === "year" && "dashboard-view-toggle-button-active")}
                onClick={() => model.setViewMode("year")}
                onMouseEnter={() => model.actions.prefetchYearDashboard(model.yearlyMonthKeys)}
                onFocus={() => model.actions.prefetchYearDashboard(model.yearlyMonthKeys)}
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
          ) : derived.timelineErrorMessage ? (
            <>
              <div className="field dashboard-toolbar-year dashboard-timeline-strip-field">
                <span>Year</span>
                <p className="error text-sm">Failed to load dashboard timeline: {derived.timelineErrorMessage}</p>
              </div>
              <div className="field dashboard-toolbar-month dashboard-timeline-strip-field">
                <span>Month</span>
                <p className="error text-sm">Failed to load dashboard timeline: {derived.timelineErrorMessage}</p>
              </div>
            </>
          ) : (
            <DashboardPeriodControls
              viewMode={model.viewMode}
              month={model.month}
              selectedYear={model.selectedYear}
              timelineMonths={model.timelineMonths}
              timelineYears={model.timelineYears}
              yearScrollRef={model.yearScrollRef}
              monthScrollRef={model.monthScrollRef}
              registerTimelineItem={model.actions.registerTimelineItem}
              setTimelineMonth={model.actions.setTimelineMonth}
              onYearKeyDown={model.actions.handleYearKeyDown}
              onMonthKeyDown={model.actions.handleMonthKeyDown}
            />
          )}
        </WorkspaceToolbar>
      </WorkspaceSection>
    </>
  );
}
