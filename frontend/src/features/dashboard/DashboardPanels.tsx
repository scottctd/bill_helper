/**
 * CALLING SPEC:
 * - Purpose: render dashboard tab panel content for the dashboard route.
 * - Inputs: derived dashboard route state, chart datasets, and typed dashboard read models.
 * - Outputs: tab panel React elements.
 * - Side effects: React rendering only.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { StatBlock } from "../../components/layout/StatBlock";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatMinor } from "../../lib/format";
import type {
  Dashboard,
  DashboardBreakdownItem,
  DashboardCategorySummary,
  DashboardLifecycleSummary,
  DashboardGroupSummary
} from "../../lib/types";
import {
  DashboardCategoryPartitionCard,
  DashboardLifecycleCrosscutCard,
  DashboardGroupsCrosscutCard,
  DashboardProjectionChart,
  DashboardSpendingByDestinationCard
} from "./DashboardOverviewCharts";
import {
  CHART_COLORS,
  DashboardChartContainer,
  type DashboardViewMode,
  axisTick,
  formatDayFromDate,
  tooltipAmount,
  tooltipAmountWithName
} from "./helpers";
import {
  HorizontalBarValueLabels,
  VerticalBarValueLabels,
  STACKED_BAR_CHART_MARGINS,
  STACKED_BAR_Y_AXIS_WIDTH,
  stackedBarYAxisDomain
} from "./BarChartValueLabels";

type DashboardSpendingPanelProps = {
  viewMode: DashboardViewMode;
  selectedYear: number;
  data: Dashboard;
  categories: DashboardCategorySummary[];
  lifecycles: DashboardLifecycleSummary[];
  groups: DashboardGroupSummary[];
  spendingByDestination: DashboardBreakdownItem[];
  dailyChartData: Array<Record<string, unknown>>;
  yearlyQueriesLoading: boolean;
  yearlyQueryError?: Error;
  yearlyOverviewData: Array<Record<string, unknown>>;
  yearlyAverageExpenseMonthMinor: number;
  yearlyMedianExpenseMonthMinor: number;
};

export function DashboardSpendingPanel({
  viewMode,
  selectedYear,
  data,
  categories,
  lifecycles,
  groups,
  spendingByDestination,
  dailyChartData,
  yearlyQueriesLoading,
  yearlyQueryError,
  yearlyOverviewData,
  yearlyAverageExpenseMonthMinor,
  yearlyMedianExpenseMonthMinor
}: DashboardSpendingPanelProps) {
  const titlePrefix = viewMode === "year" ? `${selectedYear} ` : "";

  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-spending" aria-labelledby="dashboard-tab-spending">
      <DashboardCategoryPartitionCard
        titlePrefix={titlePrefix}
        categories={categories}
        currencyCode={data.currency_code}
        expenseTotalMinor={viewMode === "year" ? yearlyAverageExpenseMonthMinor * 12 : data.kpis.expense_total_minor}
        yearlyQueriesLoading={yearlyQueriesLoading}
        yearlyQueryError={yearlyQueryError}
      />

      <DashboardLifecycleCrosscutCard
        titlePrefix={titlePrefix}
        lifecycles={lifecycles}
        currencyCode={data.currency_code}
        expenseTotalMinor={viewMode === "year"
          ? categories.reduce((s, c) => s + c.total_minor, 0)
          : data.kpis.expense_total_minor}
      />

      <DashboardGroupsCrosscutCard
        titlePrefix={titlePrefix}
        groups={groups}
        currencyCode={data.currency_code}
        expenseTotalMinor={viewMode === "year"
          ? categories.reduce((s, c) => s + c.total_minor, 0)
          : data.kpis.expense_total_minor}
      />

      <DashboardSpendingByDestinationCard
        titlePrefix={titlePrefix}
        items={spendingByDestination}
        currencyCode={data.currency_code}
        yearlyQueriesLoading={yearlyQueriesLoading}
        yearlyQueryError={yearlyQueryError}
      />

      {viewMode === "month" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Daily Spending</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 overflow-hidden">
              <div className="flex min-w-0 flex-col">
                <div className="h-80 min-w-0">
                  <DashboardChartContainer>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={dailyChartData} margin={{ top: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
                        <XAxis dataKey="date" tickFormatter={(v) => formatDayFromDate(String(v ?? ""))} />
                        <YAxis tickFormatter={axisTick} />
                        <Tooltip formatter={(value) => tooltipAmount(data.currency_code, value)} />
                        <Bar dataKey="expense_total_minor" name="Total Expense" fill={CHART_COLORS.expense} radius={[4, 4, 0, 0]}>
                          <VerticalBarValueLabels dataKey="expense_total_minor" />
                        </Bar>
                      </BarChart>
                    )}
                  </DashboardChartContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projection (Current Month)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 md:grid-cols-3">
                <p className="rounded-sm border border-border/70 bg-muted/30 px-3 py-2 text-copy-14">
                  <span className="block text-xs text-muted-foreground">Spent to date</span>
                  <strong>{formatMinor(data.projection.spent_to_date_minor, data.currency_code)}</strong>
                </p>
                <p className="rounded-sm border border-border/70 bg-muted/30 px-3 py-2 text-copy-14">
                  <span className="block text-xs text-muted-foreground">Projected total</span>
                  <strong>
                    {data.projection.projected_total_minor === null
                      ? "Not a current month"
                      : formatMinor(data.projection.projected_total_minor, data.currency_code)}
                  </strong>
                </p>
                <p className="rounded-sm border border-border/70 bg-muted/30 px-3 py-2 text-copy-14">
                  <span className="block text-xs text-muted-foreground">Projected remaining</span>
                  <strong>
                    {data.projection.projected_remaining_minor === null
                      ? "-"
                      : formatMinor(data.projection.projected_remaining_minor, data.currency_code)}
                  </strong>
                </p>
              </div>
              <div className="rounded-md border border-border/70">
                <div className="p-4">
                  <DashboardProjectionChart
                    projection={data.projection}
                    categories={categories}
                    currencyCode={data.currency_code}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <StatBlock label="Average expense month" value={formatMinor(yearlyAverageExpenseMonthMinor, data.currency_code)} />
            <StatBlock label="Median expense month" value={formatMinor(yearlyMedianExpenseMonthMinor, data.currency_code)} />
            <StatBlock label="Groups" value={data.groups.length} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>{selectedYear} Monthly Expense vs Income</CardTitle>
            </CardHeader>
            <CardContent className="h-80 min-w-0">
              {yearlyQueriesLoading ? (
                <p className="muted">Loading yearly monthly trend...</p>
              ) : yearlyQueryError ? (
                <p className="error">Failed to load yearly monthly trend: {yearlyQueryError.message}</p>
              ) : (
                <DashboardChartContainer>
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={yearlyOverviewData} margin={STACKED_BAR_CHART_MARGINS}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
                      <XAxis dataKey="month" />
                      <YAxis
                        tickFormatter={axisTick}
                        width={STACKED_BAR_Y_AXIS_WIDTH}
                        tickMargin={6}
                        domain={stackedBarYAxisDomain}
                      />
                      <Tooltip formatter={(value, name) => tooltipAmountWithName(data.currency_code, value, name)} />
                      <Legend />
                      <Bar
                        dataKey="expense_total_minor"
                        name="Expense"
                        fill={CHART_COLORS.expense}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                      <Bar
                        dataKey="income_total_minor"
                        name="Income"
                        fill={CHART_COLORS.income}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  )}
                </DashboardChartContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

type DashboardIncomePanelProps = {
  viewMode: DashboardViewMode;
  selectedYear: number;
  currencyCode: string;
  incomeByFrom: Dashboard["income_by_from"];
  yearlyQueriesLoading: boolean;
};

export function DashboardIncomePanel({
  viewMode,
  selectedYear,
  currencyCode,
  incomeByFrom,
  yearlyQueriesLoading
}: DashboardIncomePanelProps) {
  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-income" aria-labelledby="dashboard-tab-income">
      {viewMode === "year" ? (
        <div className="dashboard-scope-note">
          Income breakdown reflects the full <strong>{selectedYear}</strong> year.
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Income by Source</CardTitle>
        </CardHeader>
        <CardContent className="h-80 min-w-0">
          {viewMode === "year" && yearlyQueriesLoading ? (
            <p className="muted text-sm">Loading yearly income breakdown...</p>
          ) : incomeByFrom.length === 0 ? (
            <p className="muted">No source breakdown yet.</p>
          ) : (
            <DashboardChartContainer>
              {({ width, height }) => (
                <BarChart width={width} height={height} data={incomeByFrom} layout="vertical" margin={{ left: 24, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
                  <XAxis type="number" tickFormatter={axisTick} />
                  <YAxis dataKey="label" type="category" width={140} />
                  <Tooltip formatter={(value) => tooltipAmount(currencyCode, value)} />
                  <Bar dataKey="total_minor" name="Total" fill={CHART_COLORS.income} radius={[0, 6, 6, 0]}>
                    <HorizontalBarValueLabels dataKey="total_minor" />
                  </Bar>
                </BarChart>
              )}
            </DashboardChartContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
