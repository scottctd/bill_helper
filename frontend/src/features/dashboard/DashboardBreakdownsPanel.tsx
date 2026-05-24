/**
 * CALLING SPEC:
 * - Purpose: render the breakdowns tab panel with experiment layouts.
 * - Inputs: scoped dashboard read models and optional previous-month comparison data.
 * - Outputs: breakdowns tab panel React element.
 * - Side effects: React rendering only.
 */

import type { Dashboard } from "../../lib/types";
import { formatMonthLong, type DashboardViewMode } from "./helpers";
import { BreakdownsExperimentTabs } from "./breakdown/BreakdownsExperimentTabs";

type DashboardBreakdownsPanelProps = {
  viewMode: DashboardViewMode;
  month: string;
  data: Dashboard;
  previousMonthDashboard: Dashboard | undefined;
  previousMonthLoading?: boolean;
};

export function DashboardBreakdownsPanel({
  viewMode,
  month,
  data,
  previousMonthDashboard,
  previousMonthLoading = false
}: DashboardBreakdownsPanelProps) {
  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-breakdowns" aria-labelledby="dashboard-tab-breakdowns">
      {viewMode === "year" ? (
        <div className="dashboard-scope-note">
          Breakdowns remain anchored to <strong>{formatMonthLong(month)}</strong>. Use `Overview` and `Daily Expense` for year-level trend charts.
        </div>
      ) : null}
      {previousMonthLoading ? (
        <p className="muted text-sm">Loading month-over-month comparison...</p>
      ) : null}
      <BreakdownsExperimentTabs viewMode={viewMode} month={month} data={data} previousMonthDashboard={previousMonthDashboard} />
    </section>
  );
}
