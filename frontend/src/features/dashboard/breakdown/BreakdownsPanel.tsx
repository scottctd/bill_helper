/**
 * CALLING SPEC:
 * - Purpose: render the unified breakdowns panel (summary charts + drill-down tree).
 * - Inputs: dashboard read model and selected month key.
 * - Outputs: stacked breakdown panel React element.
 * - Side effects: React rendering only.
 */

import type { Dashboard } from "../../../lib/types";
import { BreakdownSummaryCharts } from "./BreakdownSummaryCharts";
import { BreakdownTreeCard } from "./BreakdownTreeCard";

export type BreakdownsPanelProps = {
  month: string;
  data: Dashboard;
};

export function BreakdownsPanel({ month, data }: BreakdownsPanelProps) {
  return (
    <div className="stack-lg">
      <BreakdownSummaryCharts data={data} />
      <BreakdownTreeCard data={data} month={month} />
    </div>
  );
}
