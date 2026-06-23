/**
 * CALLING SPEC:
 * - Purpose: render the promoted overview charts for category partition, lifecycle cross-cut, and projection.
 * - Inputs: period-scoped category/lifecycle/filter-group summaries, currency metadata, and loading state.
 * - Outputs: dashboard overview chart cards for ranked categories, lifecycle breakdown, and projection.
 * - Side effects: React rendering only.
 */

import { useState } from "react";

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

import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatMinor, formatMinorCompact } from "../../lib/format";
import {
  entryCategoryColor,
  entryLifecycleColor,
  formatEntryCategoryLabel
} from "../../lib/entryClassificationColors";
import { cn } from "../../lib/utils";
import type {
  DashboardCategorySummary,
  DashboardCategoryChildSummary,
  DashboardLifecycleSummary,
  DashboardFilterGroupSummary
} from "../../lib/types";
import {
  CHART_COLORS,
  DashboardChartContainer,
  DASHBOARD_PIE_ANIMATION_PROPS,
  DESTINATION_BREAKDOWN_LIMIT,
  axisTick,
  splitItemsIntoColumns,
  tooltipAmount
} from "./helpers";
import { formatEntryLifecycle } from "../../lib/catalogs";
import { formatBreakdownShare } from "./breakdown/breakdownHelpers";
import { HorizontalBarValueLabels } from "./BarChartValueLabels";

const MAX_CHILDREN_PER_CATEGORY = 5;
const PROJECTION_SCALE_EXPONENT = 0.5;

type OverviewCardState = {
  titlePrefix: string;
  currencyCode: string;
  yearlyQueriesLoading: boolean;
  yearlyQueryError?: Error;
};

type DashboardCategoryPartitionCardProps = OverviewCardState & {
  categories: DashboardCategorySummary[];
  expenseTotalMinor: number;
};

type DashboardLifecycleCrosscutCardProps = {
  titlePrefix: string;
  lifecycles: DashboardLifecycleSummary[];
  currencyCode: string;
  expenseTotalMinor: number;
};

type DashboardSpendingByDestinationCardProps = {
  titlePrefix: string;
  items: Array<{ label: string; total_minor: number; share: number }>;
  currencyCode: string;
  yearlyQueriesLoading: boolean;
  yearlyQueryError?: Error;
};

type DashboardProjectionChartProps = {
  projection: import("../../lib/types").Dashboard["projection"];
  categories: DashboardCategorySummary[];
  currencyCode: string;
};

export function DashboardCategoryPartitionCard({
  titlePrefix,
  categories,
  currencyCode,
  expenseTotalMinor,
  yearlyQueriesLoading,
  yearlyQueryError
}: DashboardCategoryPartitionCardProps) {
  const sortedCategories = [...categories].sort((a, b) => {
    if (a.name === "Uncategorized" && b.name !== "Uncategorized") return 1;
    if (b.name === "Uncategorized" && a.name !== "Uncategorized") return -1;
    return b.total_minor - a.total_minor;
  });

  const [selectedName, setSelectedName] = useState<string>(sortedCategories[0]?.name ?? "");
  const selectedCategory = sortedCategories.find((cat) => cat.name === selectedName) ?? sortedCategories[0] ?? null;
  const selectedChildren = selectedCategory
    ? [...selectedCategory.children]
        .sort((a, b) => b.total_minor - a.total_minor)
        .slice(0, MAX_CHILDREN_PER_CATEGORY)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titlePrefix}Expense by Category</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ranked categories on the left. Click a category to show its sub-category breakdown on the right.
        </p>
      </CardHeader>
      <CardContent>
        {yearlyQueriesLoading ? (
          <p className="muted text-sm">Loading category breakdown...</p>
        ) : yearlyQueryError ? (
          <p className="error">Failed to load category breakdown: {yearlyQueryError.message}</p>
        ) : sortedCategories.length === 0 ? (
          <p className="muted text-sm">No expense categories configured.</p>
        ) : (
          <div className="dashboard-expense-breakdown-grid">
            <div className="space-y-4">
              <div className="dashboard-expense-breakdown-ranked h-[24rem] min-w-0">
                <DashboardChartContainer>
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={buildRankedChartRows(sortedCategories)} layout="vertical" margin={{ left: 24, right: 44, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.18} />
                      <XAxis type="number" tickFormatter={axisTick} scale="sqrt" domain={[0, "dataMax"]} />
                      <YAxis dataKey="display_name" type="category" width={108} tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: "rgb(var(--muted) / 0.18)" }} formatter={(value) => tooltipAmount(currencyCode, value)} />
                      <Bar dataKey="total_minor" radius={[0, 8, 8, 0]}>
                        {sortedCategories.map((cat) => (
                          <Cell
                            key={cat.name}
                            fill={entryCategoryColor(cat.name)}
                            fillOpacity={selectedCategory?.name === cat.name ? 1 : 0.35}
                          />
                        ))}
                        <HorizontalBarValueLabels dataKey="total_minor" />
                      </Bar>
                    </BarChart>
                  )}
                </DashboardChartContainer>
              </div>
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Select category for sub-category breakdown">
                {sortedCategories.map((cat) => {
                  const isSelected = selectedCategory?.name === cat.name;
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedName(cat.name)}
                      className={cn(
                        "dashboard-expense-breakdown-group rounded-sm border px-3 py-2 text-left text-copy-14 transition-colors",
                        isSelected
                          ? "dashboard-expense-breakdown-group-active"
                          : "dashboard-expense-breakdown-group-idle"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: entryCategoryColor(cat.name) }} aria-hidden />
                          {sortedCategories.indexOf(cat) + 1}. {formatEntryCategoryLabel(cat.name)}
                        </span>
                        <span className="text-muted-foreground">{formatShare(cat.share)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatMinor(cat.total_minor, currencyCode)}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="dashboard-expense-breakdown-facets">
              {selectedCategory ? (
                <div className="dashboard-expense-facet-card rounded-md border border-border/70 bg-muted/10 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{formatEntryCategoryLabel(selectedCategory.name)} Sub-Categories</p>
                    </div>
                    <Badge variant="outline" style={{ borderColor: CHART_COLORS.expense, color: CHART_COLORS.expense }}>
                      {formatMinor(selectedCategory.total_minor, currencyCode)}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {selectedChildren.length > 0 ? (
                      selectedChildren.map((child) => (
                        <div key={child.path} className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-copy-14 hover:bg-muted/10">
                          <span className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: entryCategoryColor(child.path) }} aria-hidden />
                            <span className="truncate">{child.name}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{formatMinor(child.total_minor, currencyCode)}</span>
                          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatBreakdownShare(child.share)}</span>
                        </div>
                      ))
                    ) : selectedCategory.to_breakdown.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Destinations for {formatEntryCategoryLabel(selectedCategory.name)}:</p>
                        {selectedCategory.to_breakdown.slice(0, DESTINATION_BREAKDOWN_LIMIT).map((dest, destIndex) => (
                          <div key={destIndex} className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-copy-14 hover:bg-muted/10">
                            <span className="min-w-0 flex-1 truncate">{dest.label}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{formatMinor(dest.total_minor, currencyCode)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No sub-categories or destinations.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="muted text-sm">No category selected.</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardLifecycleCrosscutCard({
  titlePrefix,
  lifecycles,
  currencyCode,
  expenseTotalMinor
}: DashboardLifecycleCrosscutCardProps) {
  const sortedLifecycles = [...lifecycles].sort((a, b) => b.total_minor - a.total_minor);
  const lifecycleLabel = (key: string | null): string => {
    if (key === null) return "unclassified";
    return formatEntryLifecycle(key as "fixed" | "day_to_day" | "one_time");
  };

  const chartData = sortedLifecycles.map((item) => ({
    name: lifecycleLabel(item.lifecycle),
    value: item.total_minor
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titlePrefix}Expense by Lifecycle</CardTitle>
      </CardHeader>
      <CardContent>
        {sortedLifecycles.length === 0 ? (
          <p className="muted text-sm">No lifecycle data.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-8">
            <div className="h-48 w-48 shrink-0">
              <DashboardChartContainer>
                {({ width, height }) => {
                  const cx = width / 2;
                  const cy = height / 2;
                  const radius = Math.min(width, height) / 2 - 8;
                  return (
                    <PieChart width={width} height={height}>
                      <Pie
                        data={chartData}
                        cx={cx}
                        cy={cy}
                        innerRadius={radius * 0.55}
                        outerRadius={radius}
                        dataKey="value"
                        nameKey="name"
                        {...DASHBOARD_PIE_ANIMATION_PROPS}
                      >
                        {chartData.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={entryLifecycleColor(sortedLifecycles[index]?.lifecycle)}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => tooltipAmount(currencyCode, value)} />
                    </PieChart>
                  );
                }}
              </DashboardChartContainer>
            </div>
            <div className="space-y-2 min-w-[10rem]">
              {sortedLifecycles.map((item, index) => (
                <div key={item.lifecycle ?? "null"} className="flex items-center gap-3 text-copy-14">
                  <span className="inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: entryLifecycleColor(item.lifecycle) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{lifecycleLabel(item.lifecycle)}</span>
                  <span className="shrink-0 tabular-nums">{formatMinor(item.total_minor, currencyCode)}</span>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {formatBreakdownShare(expenseTotalMinor > 0 ? item.total_minor / expenseTotalMinor : 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardFilterGroupsCrosscutCard({
  titlePrefix,
  filterGroups,
  currencyCode,
  expenseTotalMinor
}: {
  titlePrefix: string;
  filterGroups: DashboardFilterGroupSummary[];
  currencyCode: string;
  expenseTotalMinor: number;
}) {
  if (filterGroups.length === 0) return null;

  const sorted = [...filterGroups].sort((a, b) => b.total_minor - a.total_minor);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titlePrefix}Filter Group Cross-Cut</CardTitle>
        <p className="text-xs text-muted-foreground">
          Custom filter groups may overlap with categories. Values shown for reference.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map((group) => {
            const groupColor = group.color ?? "rgb(var(--muted-foreground))";
            return (
              <div key={group.key} className="flex items-center gap-3 text-copy-14">
                <span className="inline-block size-3 shrink-0 rounded-sm" style={{ backgroundColor: groupColor }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                <span className="shrink-0 tabular-nums">{formatMinor(group.total_minor, currencyCode)}</span>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {formatBreakdownShare(group.share)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type DestinationBreakdownItem = DashboardSpendingByDestinationCardProps["items"][number];

type DestinationColumnChartProps = {
  items: DestinationBreakdownItem[];
  currencyCode: string;
  maxTotalMinor: number;
  width: number;
  height: number;
  showXAxisTicks?: boolean;
};

function DestinationColumnChart({
  items,
  currencyCode,
  maxTotalMinor,
  width,
  height,
  showXAxisTicks = true
}: DestinationColumnChartProps) {
  return (
    <BarChart width={width} height={height} data={items} layout="vertical" margin={{ left: 8, right: 36, top: 4, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} opacity={0.2} />
      <XAxis
        type="number"
        tickFormatter={axisTick}
        scale="sqrt"
        domain={[0, maxTotalMinor > 0 ? maxTotalMinor : "dataMax"]}
        hide={!showXAxisTicks}
        tick={{ fontSize: 10 }}
      />
      <YAxis dataKey="label" type="category" width={84} tick={{ fontSize: 10 }} />
      <Tooltip cursor={{ fill: "rgb(var(--muted) / 0.18)" }} formatter={(value) => tooltipAmount(currencyCode, value)} />
      <Bar dataKey="total_minor" name="Total" fill={CHART_COLORS.destination} radius={[0, 6, 6, 0]}>
        <HorizontalBarValueLabels dataKey="total_minor" />
      </Bar>
    </BarChart>
  );
}

export function DashboardSpendingByDestinationCard({
  titlePrefix,
  items,
  currencyCode,
  yearlyQueriesLoading,
  yearlyQueryError
}: DashboardSpendingByDestinationCardProps) {
  const displayItems = items.slice(0, DESTINATION_BREAKDOWN_LIMIT);
  const destinationColumns = splitItemsIntoColumns(displayItems, 2);
  const maxTotalMinor = displayItems.reduce((max, item) => Math.max(max, item.total_minor), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titlePrefix}Spending by Destination</CardTitle>
        <p className="text-xs text-muted-foreground">
          Two columns, up to {DESTINATION_BREAKDOWN_LIMIT} destinations. Sqrt scale on destination bars.
        </p>
      </CardHeader>
      <CardContent className="h-80 min-w-0">
        {yearlyQueriesLoading ? (
          <p className="muted text-sm">Loading destination breakdown...</p>
        ) : yearlyQueryError ? (
          <p className="error">Failed to load destination breakdown: {yearlyQueryError.message}</p>
        ) : displayItems.length === 0 ? (
          <p className="muted">No destination breakdown yet.</p>
        ) : (
          <div className="dashboard-destination-columns grid h-full min-h-0 grid-cols-2 gap-3">
            {destinationColumns.map((columnItems, columnIndex) => (
              <div key={columnIndex} className="min-h-0 min-w-0">
                <DashboardChartContainer>
                  {({ width, height }) => (
                    <DestinationColumnChart
                      items={columnItems}
                      currencyCode={currencyCode}
                      maxTotalMinor={maxTotalMinor}
                      width={width}
                      height={height}
                      showXAxisTicks={columnIndex === destinationColumns.length - 1}
                    />
                  )}
                </DashboardChartContainer>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardProjectionChart({ projection, categories, currencyCode }: DashboardProjectionChartProps) {
  if (projection.projected_total_minor === null) {
    return <p className="muted text-sm">Projection is only available for the current month.</p>;
  }

  const rows = buildProjectionRows(projection, categories);
  const scaleTicks = buildProjectionScaleTicks(rows);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-sm bg-[rgb(var(--chart-expense))]" />
          Spent already
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-sm bg-[rgb(var(--chart-expense))] opacity-30" />
          Projected growth
        </span>
        <span>Sqrt scale</span>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)_16rem] items-end gap-3 text-label-12 uppercase tracking-wide text-muted-foreground">
          <span />
          <div className="relative h-4">
            {scaleTicks.map((tick) => (
              <span
                key={tick.value}
                className="absolute"
                style={{
                  left: `${tick.position_percent}%`,
                  transform:
                    tick.position_percent === 0
                      ? "translateX(0)"
                      : tick.position_percent === 100
                        ? "translateX(-100%)"
                        : "translateX(-50%)"
                }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_1.5rem_1fr] gap-2 text-left">
            <span>Spent</span>
            <span aria-hidden>&rarr;</span>
            <span>Predicted</span>
          </div>
        </div>
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[7rem_minmax(0,1fr)_16rem] items-center gap-3">
              <div className="text-sm font-medium text-foreground">{row.name}</div>
              <div className="relative h-12 overflow-hidden rounded-md bg-muted/20">
                <div className="absolute inset-0 flex">
                  <div
                    className="h-full"
                    style={{
                      width: `${row.spent_percent}%`,
                      backgroundColor: row.color,
                      opacity: 0.95
                    }}
                  />
                  <div
                    className="h-full rounded-r-lg"
                    style={{
                      width: `${row.projected_growth_percent}%`,
                      backgroundColor: row.color,
                      opacity: 0.28
                    }}
                  />
                </div>
                <div className="pointer-events-none absolute inset-0">
                  {scaleTicks.slice(1, -1).map((tick) => (
                    <span
                      key={tick.value}
                      className="absolute inset-y-0 w-px bg-geist-gray-alpha-200"
                      style={{ left: `${tick.position_percent}%` }}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-[1fr_1.5rem_1fr] gap-2 text-heading-16 tabular-nums text-foreground">
                <span className="text-left">{row.spent_label}</span>
                <span className="text-left text-muted-foreground" aria-hidden>&rarr;</span>
                <span className="text-left">{row.projected_label}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildRankedChartRows(categories: DashboardCategorySummary[]) {
  return categories.map((cat) => ({
    name: cat.name,
    display_name: formatEntryCategoryLabel(cat.name),
    total_minor: cat.total_minor,
    fill: entryCategoryColor(cat.name)
  }));
}

function formatShare(share: number): string {
  return `${(share * 100).toFixed(0)}%`;
}

function buildProjectionRows(
  projection: import("../../lib/types").Dashboard["projection"],
  categories: DashboardCategorySummary[]
): Array<{
  key: string;
  name: string;
  color: string;
  spent_minor: number;
  projected_growth_minor: number;
  projected_total_minor: number;
  spent_label: string;
  projected_label: string;
  spent_percent: number;
  projected_growth_percent: number;
}> {
  const totalSpentMinor = projection.spent_to_date_minor;
  const totalProjectedMinor = projection.projected_total_minor ?? totalSpentMinor;
  const maxProjectedMinor = Math.max(
    totalProjectedMinor,
    ...categories.map((cat) => Math.max(
      projection.projected_category_totals[cat.name] ?? cat.total_minor,
      cat.total_minor
    ))
  );
  const totalRow = {
    key: "total",
    name: "Total",
    color: CHART_COLORS.expense,
    spent_minor: totalSpentMinor,
    projected_growth_minor: Math.max(totalProjectedMinor - totalSpentMinor, 0),
    projected_total_minor: Math.max(totalProjectedMinor, totalSpentMinor),
    spent_label: formatMinorCompact(totalSpentMinor),
    projected_label: formatMinorCompact(Math.max(totalProjectedMinor, totalSpentMinor)),
    spent_percent: scaledPercentOf(totalSpentMinor, maxProjectedMinor),
    projected_growth_percent: scaledStackedPercent(
      Math.max(totalProjectedMinor, totalSpentMinor),
      totalSpentMinor,
      maxProjectedMinor
    )
  };

  const categoryRows = categories
    .map((cat) => {
      const projectedTotalMinor = projection.projected_category_totals[cat.name] ?? cat.total_minor;
      return {
        key: cat.name,
        name: formatEntryCategoryLabel(cat.name),
        color: entryCategoryColor(cat.name),
        spent_minor: cat.total_minor,
        projected_growth_minor: Math.max(projectedTotalMinor - cat.total_minor, 0),
        projected_total_minor: Math.max(projectedTotalMinor, cat.total_minor),
        spent_label: formatMinorCompact(cat.total_minor),
        projected_label: formatMinorCompact(Math.max(projectedTotalMinor, cat.total_minor)),
        spent_percent: scaledPercentOf(cat.total_minor, maxProjectedMinor),
        projected_growth_percent: scaledStackedPercent(
          Math.max(projectedTotalMinor, cat.total_minor),
          cat.total_minor,
          maxProjectedMinor
        )
      };
    })
    .filter((cat) => cat.spent_minor > 0 || cat.projected_total_minor > 0);

  return [totalRow, ...categoryRows];
}

function scaledPercentOf(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) {
    return 0;
  }
  return Math.pow(value / maxValue, PROJECTION_SCALE_EXPONENT) * 100;
}

function buildProjectionScaleTicks(
  rows: Array<{ projected_total_minor: number }>
): Array<{ value: number; label: string; position_percent: number }> {
  const maxValue = Math.max(0, ...rows.map((row) => row.projected_total_minor));
  if (maxValue <= 0) {
    return [{ value: 0, label: formatMinorCompact(0), position_percent: 0 }];
  }

  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const tickValue = Math.round(maxValue * Math.pow(ratio, 1 / PROJECTION_SCALE_EXPONENT));
    return {
      value: ratio,
      label: formatMinorCompact(tickValue),
      position_percent: ratio * 100
    };
  });
}

function scaledStackedPercent(totalValue: number, baseValue: number, maxValue: number): number {
  return Math.max(scaledPercentOf(totalValue, maxValue) - scaledPercentOf(baseValue, maxValue), 0);
}
