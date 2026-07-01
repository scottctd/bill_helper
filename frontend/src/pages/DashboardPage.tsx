/**
 * CALLING SPEC:
 * - Purpose: render the dashboard page shell composing period controls, tabs, and feature panels.
 * - Inputs: dashboard page model from useDashboardPageModel.
 * - Outputs: the dashboard page layout and tab routing UI.
 * - Side effects: React rendering and user event wiring.
 */
import { Suspense, lazy } from "react";

import { ErrorBoundary } from "../components/ErrorBoundary";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { Button } from "../components/ui/button";
import { DashboardBreakdownPanel } from "../features/dashboard/DashboardBreakdownsPanel";
import { DashboardFinanceChrome } from "../features/dashboard/DashboardFinanceChrome";
import { DashboardPageSkeleton } from "../features/dashboard/DashboardPageSkeleton";
import { DashboardIncomePanel, DashboardSpendingPanel } from "../features/dashboard/DashboardPanels";
import { DASHBOARD_TABS } from "../features/dashboard/helpers";
import { useDashboardPageModel } from "../features/dashboard/useDashboardPageModel";
import { cn } from "../lib/utils";
import { getApiErrorMessage } from "../lib/api/core";

const LazyAgentCostDashboard = lazy(async () => {
  const module = await import("../features/dashboard/AgentCostDashboard");
  return { default: module.AgentCostDashboard };
});

function DashboardTabFallback() {
  return <p className="muted text-sm">Loading tab...</p>;
}

export function DashboardPage() {
  const model = useDashboardPageModel();
  const { dashboardQuery, timelineQuery } = model.queries;
  const derived = model.derived;

  if (dashboardQuery.isLoading || !derived.data) {
    return (
      <DashboardPageSkeleton
        activeTab={model.activeTab}
        onTabChange={model.setActiveTab}
        timelineLoading={timelineQuery.isLoading}
        trendLoading
        panelLoading
      />
    );
  }

  if (dashboardQuery.isError) {
    return <p>Failed to load dashboard: {getApiErrorMessage(dashboardQuery.error)}</p>;
  }

  const data = derived.data;

  return (
    <div className="dashboard-page-layout">
      <div className="stack-lg min-w-0">
        {model.showFinanceChrome ? <DashboardFinanceChrome model={model} /> : null}

        <WorkspaceSection>
          <div className="dashboard-tab-list" role="tablist" aria-label="Dashboard sections">
            {DASHBOARD_TABS.map((tab) => (
              <Button
                key={tab.id}
                id={`dashboard-tab-${tab.id}`}
                role="tab"
                aria-controls={`dashboard-panel-${tab.id}`}
                aria-selected={model.activeTab === tab.id}
                variant={model.activeTab === tab.id ? "default" : "outline"}
                size="sm"
                className={cn("dashboard-tab-button", model.activeTab === tab.id ? "dashboard-tab-active" : "")}
                onClick={() => model.setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </WorkspaceSection>

        {model.activeTab === "spending" ? (
          <DashboardSpendingPanel
            viewMode={model.viewMode}
            selectedYear={model.selectedYear}
            data={data}
            categories={derived.spendingCategories}
            lifecycles={derived.spendingLifecycles}
            groups={derived.spendingGroups}
            spendingByDestination={derived.spendingByDestination}
            dailyChartData={derived.dailyChartData}
            yearlyQueriesLoading={derived.yearlyQueriesLoading}
            yearlyQueryError={derived.yearlyQueryError}
            yearlyOverviewData={derived.yearlyOverviewData}
            yearlyAverageExpenseMonthMinor={derived.yearlyAverageExpenseMonthMinor}
            yearlyMedianExpenseMonthMinor={derived.yearlyMedianExpenseMonthMinor}
          />
        ) : null}

        {model.activeTab === "breakdown" ? (
          <DashboardBreakdownPanel
            scopeLabel={model.breakdownScopeLabel}
            categories={derived.breakdownCategories}
            currencyCode={data.currency_code}
            expenseTotalMinor={derived.breakdownExpenseTotalMinor}
            yearlyQueriesLoading={derived.yearlyQueriesLoading}
            yearlyQueryError={derived.yearlyQueryError}
          />
        ) : null}

        {model.activeTab === "income" ? (
          <DashboardIncomePanel
            viewMode={model.viewMode}
            selectedYear={model.selectedYear}
            currencyCode={data.currency_code}
            incomeByFrom={derived.incomeByFromItems}
            yearlyQueriesLoading={derived.yearlyQueriesLoading}
          />
        ) : null}

        {model.activeTab === "agent" ? (
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
