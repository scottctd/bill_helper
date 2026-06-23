/**
 * CALLING SPEC:
 * - Purpose: render the dashboard Income vs Expense trend chart.
 * - Inputs: trend chart data entries with expense_total_minor and income_total_minor fields.
 * - Outputs: simple bar chart with expense and income bars per month.
 * - Side effects: React rendering only.
 */

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";

import {
  CHART_COLORS,
  DashboardChartContainer,
  axisTick,
  tooltipAmountWithName
} from "./helpers";
import {
  STACKED_BAR_CHART_MARGINS,
  STACKED_BAR_SQRT_Y_AXIS,
  STACKED_BAR_Y_AXIS_WIDTH,
  VerticalBarValueLabels
} from "./BarChartValueLabels";

type DashboardTrendChartProps = {
  data: Array<Record<string, unknown>>;
  currencyCode: string;
};

export function DashboardTrendChart({ data: chartData, currencyCode }: DashboardTrendChartProps) {
  const hasExpense = chartData.some((point) => (point.expense_total_minor as number) > 0);
  const hasIncome = chartData.some((point) => (point.income_total_minor as number) > 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        <DashboardChartContainer>
          {({ width, height }) => (
            <BarChart
              width={width}
              height={height}
              data={chartData}
              margin={STACKED_BAR_CHART_MARGINS}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
              <XAxis dataKey="month" />
              <YAxis
                tickFormatter={axisTick}
                width={STACKED_BAR_Y_AXIS_WIDTH}
                tickMargin={6}
                scale={STACKED_BAR_SQRT_Y_AXIS.scale}
                domain={STACKED_BAR_SQRT_Y_AXIS.domain}
              />
              <Tooltip
                formatter={(value, name) => tooltipAmountWithName(currencyCode, value, name)}
              />
              <Legend />
              {hasIncome ? (
                <Bar
                  dataKey="income_total_minor"
                  name="Income"
                  fill={CHART_COLORS.income}
                  isAnimationActive={false}
                  radius={[4, 4, 0, 0]}
                >
                  <VerticalBarValueLabels dataKey="income_total_minor" />
                </Bar>
              ) : null}
              {hasExpense ? (
                <Bar
                  dataKey="expense_total_minor"
                  name="Expense"
                  fill={CHART_COLORS.expense}
                  isAnimationActive={false}
                  radius={[4, 4, 0, 0]}
                >
                  <VerticalBarValueLabels dataKey="expense_total_minor" />
                </Bar>
              ) : null}
            </BarChart>
          )}
        </DashboardChartContainer>
      </div>
    </div>
  );
}
