/**
 * CALLING SPEC:
 * - Purpose: render the breakdown tab panel with the expense drill-down tree.
 * - Inputs: scoped categories, scope label, and loading state for year aggregation.
 * - Outputs: breakdown tab panel React element.
 * - Side effects: React rendering only.
 */

import type { DashboardCategorySummary } from "../../lib/types";
import { BreakdownTreeCard } from "./breakdown/BreakdownTreeCard";

type DashboardBreakdownPanelProps = {
  scopeLabel: string;
  categories: DashboardCategorySummary[];
  currencyCode: string;
  expenseTotalMinor: number;
  yearlyQueriesLoading?: boolean;
  yearlyQueryError?: Error;
};

export function DashboardBreakdownPanel({
  scopeLabel,
  categories,
  currencyCode,
  expenseTotalMinor,
  yearlyQueriesLoading = false,
  yearlyQueryError
}: DashboardBreakdownPanelProps) {
  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-breakdown" aria-labelledby="dashboard-tab-breakdown">
      {yearlyQueriesLoading ? (
        <p className="muted text-sm">Loading yearly breakdown tree...</p>
      ) : yearlyQueryError ? (
        <p className="error">Failed to load yearly breakdown tree: {yearlyQueryError.message}</p>
      ) : (
        <BreakdownTreeCard
          categories={categories}
          currencyCode={currencyCode}
          expenseTotalMinor={expenseTotalMinor}
          scopeLabel={scopeLabel}
        />
      )}
    </section>
  );
}
