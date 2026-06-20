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
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { StatBlock } from "../../components/layout/StatBlock";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatMinor } from "../../lib/format";
import type { Dashboard, DashboardBreakdownItem } from "../../lib/types";
import {
  DashboardExpenseGroupBreakdownCard,
  DashboardProjectionChart,
  DashboardSpendingByDestinationCard
} from "./DashboardOverviewCharts";
import {
  CHART_COLORS,
  DashboardChartContainer,
  type DashboardViewMode,
  axisTick,
  builtinGroupColor,
  dashboardBarColor,
  formatDayFromDate,
  tooltipAmount,
  tooltipAmountWithName
} from "./helpers";
import {
  HorizontalBarValueLabels,
  STACKED_BAR_CHART_MARGINS,
  STACKED_BAR_Y_AXIS_WIDTH,
  stackedBarYAxisDomain,
  stackTopBarLabel,
  VerticalBarValueLabels
} from "./BarChartValueLabels";

type DashboardSpendingPanelProps = {
  viewMode: DashboardViewMode;
  selectedYear: number;
  data: Dashboard;
  spendingFilterGroups: Dashboard["filter_groups"];
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
  spendingFilterGroups,
  spendingByDestination,
  dailyChartData,
  yearlyQueriesLoading,
  yearlyQueryError,
  yearlyOverviewData,
  yearlyAverageExpenseMonthMinor,
  yearlyMedianExpenseMonthMinor
}: DashboardSpendingPanelProps) {
  const titlePrefix = viewMode === "year" ? `${selectedYear} ` : "";
  const dayToDayColor = builtinGroupColor("day_to_day");

  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-spending" aria-labelledby="dashboard-tab-spending">
      <DashboardExpenseGroupBreakdownCard
        titlePrefix={titlePrefix}
        filterGroups={spendingFilterGroups}
        currencyCode={data.currency_code}
        yearlyQueriesLoading={yearlyQueriesLoading}
        yearlyQueryError={yearlyQueryError}
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
              <CardTitle>Daily Spending (Day-to-Day)</CardTitle>
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
                        <ReferenceLine
                          y={data.kpis.average_day_to_day_minor ?? 0}
                          stroke={dashboardBarColor(1)}
                          strokeWidth={3}
                          strokeDasharray="6 4"
                        />
                        <ReferenceLine
                          y={data.kpis.median_day_to_day_minor ?? 0}
                          stroke={dashboardBarColor(2)}
                          strokeWidth={3}
                          strokeDasharray="2 4"
                        />
                        <Bar dataKey="day_to_day" name="Day-to-Day" fill={dayToDayColor} radius={[4, 4, 0, 0]}>
                          <VerticalBarValueLabels dataKey="day_to_day" />
                        </Bar>
                      </BarChart>
                    )}
                  </DashboardChartContainer>
                </div>
                <div className="mt-3 flex w-full min-w-0 flex-wrap gap-4 overflow-hidden text-sm" role="list" aria-label="Daily spending legend">
                  <span className="flex min-w-0 max-w-full shrink items-center gap-2">
                    <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: dayToDayColor }} aria-hidden />
                    <span className="truncate">Day-to-Day</span>
                  </span>
                  <span className="flex min-w-0 max-w-full shrink items-center gap-2">
                    <svg width={20} height={4} aria-hidden="true" className="shrink-0">
                      <line x1={0} y1={2} x2={20} y2={2} stroke={dashboardBarColor(1)} strokeWidth={2} strokeDasharray="6 4" />
                    </svg>
                    <span className="truncate">
                      Mean: {formatMinor(data.kpis.average_day_to_day_minor ?? 0, data.currency_code)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <svg width={20} height={4} aria-hidden="true" className="shrink-0">
                      <line x1={0} y1={2} x2={20} y2={2} stroke={dashboardBarColor(2)} strokeWidth={2} strokeDasharray="2 4" />
                    </svg>
                    <span className="truncate">
                      Median: {formatMinor(data.kpis.median_day_to_day_minor ?? 0, data.currency_code)}
                    </span>
                  </span>
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
                    filterGroups={data.filter_groups}
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
            <StatBlock label="Tracked groups" value={data.filter_groups.length} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>{selectedYear} Monthly Filter Group Trend</CardTitle>
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
                      {data.filter_groups.map((group, index, groups) => (
                        <Bar
                          key={group.key}
                          dataKey={group.key}
                          name={group.name}
                          stackId="yearly-group-spend"
                          fill={dashboardBarColor(index)}
                          radius={[4, 4, 0, 0]}
                          isAnimationActive={false}
                          label={stackTopBarLabel({
                            stackKeys: groups.map((item) => item.key),
                            segmentKey: group.key
                          })}
                        />
                      ))}
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
  salaryTotalMinor: number;
  otherIncomeTotalMinor: number;
  yearlyQueriesLoading: boolean;
};

export function DashboardIncomePanel({
  viewMode,
  selectedYear,
  currencyCode,
  incomeByFrom,
  salaryTotalMinor,
  otherIncomeTotalMinor,
  yearlyQueriesLoading
}: DashboardIncomePanelProps) {
  return (
    <section className="stack-lg" role="tabpanel" id="dashboard-panel-income" aria-labelledby="dashboard-tab-income">
      {viewMode === "year" ? (
        <div className="dashboard-scope-note">
          Income breakdown reflects the full <strong>{selectedYear}</strong> year.
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <StatBlock label="Salary" value={formatMinor(salaryTotalMinor, currencyCode)} tone="success" />
        <StatBlock label="Other income" value={formatMinor(otherIncomeTotalMinor, currencyCode)} tone="success" />
      </section>

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
