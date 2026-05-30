/**
 * CALLING SPEC:
 * - Purpose: render the top-row breakdown summary charts (tags, destinations, sources).
 * - Inputs: dashboard read model for the selected month.
 * - Outputs: three-chart summary row React element.
 * - Side effects: React rendering only.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import type { Dashboard } from "../../../lib/types";
import {
  CHART_COLORS,
  DASHBOARD_PIE_ANIMATION_PROPS,
  DashboardChartContainer,
  axisTick,
  dashboardPieColor,
  tooltipAmount
} from "../helpers";
import { HorizontalBarValueLabels, VerticalBarValueLabels } from "../BarChartValueLabels";

export type BreakdownSummaryChartsProps = {
  data: Dashboard;
};

export function BreakdownSummaryCharts({ data }: BreakdownSummaryChartsProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Spending by Tags</CardTitle>
        </CardHeader>
        <CardContent className="h-80 min-w-0">
          {data.spending_by_tag.length === 0 ? (
            <p className="muted">No expense-tag data for this month.</p>
          ) : (
            <DashboardChartContainer>
              {({ width, height }) => (
                <PieChart width={width} height={height}>
                  <Pie
                    data={data.spending_by_tag}
                    dataKey="total_minor"
                    nameKey="label"
                    outerRadius={85}
                    {...DASHBOARD_PIE_ANIMATION_PROPS}
                  >
                    {data.spending_by_tag.map((item, index) => (
                      <Cell key={item.label} fill={dashboardPieColor(index)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => tooltipAmount(data.currency_code, value)} />
                  <Legend />
                </PieChart>
              )}
            </DashboardChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spending by Destination</CardTitle>
          <p className="text-xs text-muted-foreground">Sqrt scale on destination bars.</p>
        </CardHeader>
        <CardContent className="h-80 min-w-0">
          {data.spending_by_to.length === 0 ? (
            <p className="muted">No destination breakdown yet.</p>
          ) : (
            <DashboardChartContainer>
              {({ width, height }) => (
                <BarChart width={width} height={height} data={data.spending_by_to} layout="vertical" margin={{ left: 24, right: 44, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
                  <XAxis type="number" tickFormatter={axisTick} scale="sqrt" domain={[0, "dataMax"]} />
                  <YAxis dataKey="label" type="category" width={96} tick={{ fontSize: 11 }} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.18)" }} formatter={(value) => tooltipAmount(data.currency_code, value)} />
                  <Bar dataKey="total_minor" name="Total" fill={CHART_COLORS.destination} radius={[0, 6, 6, 0]}>
                    <HorizontalBarValueLabels dataKey="total_minor" />
                  </Bar>
                </BarChart>
              )}
            </DashboardChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spending by Source (`from`)</CardTitle>
        </CardHeader>
        <CardContent className="h-80 min-w-0">
          {data.spending_by_from.length === 0 ? (
            <p className="muted">No source breakdown yet.</p>
          ) : (
            <DashboardChartContainer>
              {({ width, height }) => (
                <BarChart width={width} height={height} data={data.spending_by_from} margin={{ top: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={axisTick} />
                  <Tooltip formatter={(value) => tooltipAmount(data.currency_code, value)} />
                  <Bar dataKey="total_minor" name="Total" fill={CHART_COLORS.source} radius={[6, 6, 0, 0]}>
                    <VerticalBarValueLabels dataKey="total_minor" />
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
