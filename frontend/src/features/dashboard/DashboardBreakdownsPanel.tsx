/**
 * CALLING SPEC:
 * - Purpose: render the breakdowns tab panel with summary charts and drill-down tree.
 * - Inputs: scoped dashboard read model for the selected month.
 * - Outputs: breakdowns tab panel React element.
 * - Side effects: React rendering only.
 */

import type { Dashboard } from "../../lib/types";
import { formatMonthLong, type DashboardViewMode } from "./helpers";
import { BreakdownsPanel } from "./breakdown/BreakdownsPanel";

type DashboardBreakdownsPanelProps = {
  viewMode: DashboardViewMode;
  month: string;
  data: Dashboard;
};

export function DashboardBreakdownsPanel({ viewMode, month, data }: DashboardBreakdownsPanelProps) {
  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-breakdowns" aria-labelledby="dashboard-tab-breakdowns">
      {viewMode === "year" ? (
        <div className="dashboard-scope-note">
          Breakdowns remain anchored to <strong>{formatMonthLong(month)}</strong>. Use `Overview` and `Daily Expense` for year-level trend charts.
        </div>
      ) : null}
      <BreakdownsPanel month={month} data={data} />
    </section>
  );
}
