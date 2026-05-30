/**
 * CALLING SPEC:
 * - Purpose: render progressive loading placeholders for the dashboard route shell.
 * - Inputs: loading flags for timeline, trend, and tab panel regions.
 * - Outputs: dashboard page skeleton layout.
 * - Side effects: React rendering only.
 */

import { PageHeader } from "../../components/layout/PageHeader";
import { WorkspaceSection } from "../../components/layout/WorkspaceSection";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { DASHBOARD_TABS, type DashboardTab } from "./helpers";

type DashboardPageSkeletonProps = {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  timelineLoading?: boolean;
  trendLoading?: boolean;
  panelLoading?: boolean;
};

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={className ?? "dashboard-skeleton-block"} aria-hidden="true" />;
}

export function DashboardPageSkeleton({
  activeTab,
  onTabChange,
  timelineLoading = true,
  trendLoading = true,
  panelLoading = true
}: DashboardPageSkeletonProps) {
  return (
    <div className="dashboard-page-layout">
      <div className="stack-lg min-w-0">
        <PageHeader title="Dashboard" description="Month and year ledger trends." />

        <Card>
          <CardHeader>
            <SkeletonBlock className="dashboard-skeleton-title" />
          </CardHeader>
          <CardContent className="h-72 min-w-0">
            {trendLoading ? <SkeletonBlock className="dashboard-skeleton-chart h-full" /> : null}
          </CardContent>
        </Card>

        <WorkspaceSection>
          <WorkspaceToolbar className="dashboard-toolbar">
            <div className="field dashboard-toolbar-view">
              <span>View</span>
              <SkeletonBlock className="dashboard-skeleton-control" />
            </div>
            <div className="field dashboard-toolbar-year dashboard-timeline-strip-field">
              <span>Year</span>
              {timelineLoading ? (
                <div className="dashboard-skeleton-timeline" aria-hidden="true">
                  {Array.from({ length: 5 }, (_, index) => (
                    <SkeletonBlock key={index} className="dashboard-skeleton-chip" />
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field dashboard-toolbar-month dashboard-timeline-strip-field">
              <span>Month</span>
              {timelineLoading ? (
                <div className="dashboard-skeleton-timeline" aria-hidden="true">
                  {Array.from({ length: 12 }, (_, index) => (
                    <SkeletonBlock key={index} className="dashboard-skeleton-chip" />
                  ))}
                </div>
              ) : null}
            </div>
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
                className="dashboard-tab-button"
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </WorkspaceSection>

        {panelLoading ? (
          <section className="stack-lg" aria-busy="true" aria-live="polite">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonBlock key={index} className="dashboard-skeleton-stat" />
              ))}
            </div>
            <SkeletonBlock className="dashboard-skeleton-card h-64" />
            <SkeletonBlock className="dashboard-skeleton-card h-72" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
