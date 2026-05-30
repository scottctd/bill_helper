/**
 * CALLING SPEC:
 * - Purpose: render the dashboard Income vs Expense stacked trend chart.
 * - Inputs: trend chart data, expense/income segment groups, and currency code.
 * - Outputs: stacked bar chart with dual legend.
 * - Side effects: React rendering only.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import {
  CHART_COLORS,
  DashboardChartContainer,
  axisTick,
  builtinGroupColor,
  builtinIncomeGroupColor,
  tooltipAmount
} from "./helpers";
import { STACKED_BAR_CHART_MARGINS, STACKED_BAR_SQRT_Y_AXIS, STACKED_BAR_Y_AXIS_WIDTH, stackedTrendBarLayout, stackTopBarLabel } from "./BarChartValueLabels";

type TrendGroup = { key: string; name: string };

type DashboardTrendChartProps = {
  data: Array<Record<string, unknown>>;
  trendGroups: TrendGroup[];
  incomeTrendGroups: TrendGroup[];
  currencyCode: string;
};

export function DashboardTrendChart({ data: chartData, trendGroups, incomeTrendGroups, currencyCode }: DashboardTrendChartProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const incomeStackKeys = incomeTrendGroups.map((group) => group.key);
  const expenseStackKeys = trendGroups.map((group) => group.key);
  const barLayout = stackedTrendBarLayout(chartData.length);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1">
        <DashboardChartContainer>
          {({ width, height }) => (
            <BarChart
              width={width}
              height={height}
              data={chartData}
              barCategoryGap={barLayout.barCategoryGap}
              barGap={barLayout.barGap}
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
                content={({ payload, label }) => {
                  const active = payload?.find((p) => p.dataKey === hoveredKey) ?? payload?.[0];
                  if (!active) return null;
                  return (
                    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
                      <p className="text-muted-foreground mb-1">{String(label)}</p>
                      <p className="font-medium">
                        {String(active.name)}: {tooltipAmount(currencyCode, active.value)}
                      </p>
                    </div>
                  );
                }}
              />
              {incomeTrendGroups.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.name}
                  stackId="income"
                  fill={builtinIncomeGroupColor(group.key)}
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredKey(group.key)}
                  label={stackTopBarLabel({ stackKeys: incomeStackKeys, segmentKey: group.key })}
                />
              ))}
              {trendGroups.map((group) => (
                <Bar
                  key={group.key}
                  dataKey={group.key}
                  name={group.name}
                  stackId="expense-trend"
                  fill={builtinGroupColor(group.key)}
                  isAnimationActive={false}
                  onMouseEnter={() => setHoveredKey(group.key)}
                  label={stackTopBarLabel({ stackKeys: expenseStackKeys, segmentKey: group.key })}
                />
              ))}
            </BarChart>
          )}
        </DashboardChartContainer>
      </div>
      <div
        className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"
        aria-label="Income and expense segment legend"
      >
        <div className="space-y-1">
          <p className="text-[0.7rem] font-medium uppercase tracking-wide text-foreground">Income</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {incomeTrendGroups.map((group) => (
              <li key={group.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: builtinIncomeGroupColor(group.key) }}
                  aria-hidden
                />
                <span>{group.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="text-[0.7rem] font-medium uppercase tracking-wide text-foreground">Expense</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {trendGroups.map((group) => (
              <li key={group.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: builtinGroupColor(group.key) }}
                  aria-hidden
                />
                <span>{group.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
