/**
 * CALLING SPEC:
 * - Purpose: shared Recharts value labels for dashboard bar charts.
 * - Inputs: bar data keys and optional label formatters.
 * - Outputs: label configs and `LabelList` elements for dashboard bar charts.
 * - Side effects: React rendering only.
 */

import { LabelList } from "recharts";

import { axisTick, toMinorValue } from "./helpers";

export const BAR_VALUE_LABEL_STYLE = {
  fill: "hsl(var(--foreground) / 0.72)",
  fontSize: 11,
  fontWeight: 500
} as const;

export function formatMinorBarLabel(value: unknown): string {
  const minor = toMinorValue(value);
  if (minor <= 0) return "";
  return axisTick(minor);
}

function topStackSegmentKey(payload: Record<string, unknown>, stackKeys: string[]): string {
  for (let index = stackKeys.length - 1; index >= 0; index -= 1) {
    const key = stackKeys[index];
    if (toMinorValue(payload[key]) > 0) {
      return key;
    }
  }
  return stackKeys[stackKeys.length - 1] ?? "";
}

function stackTotalFromPayload(payload: Record<string, unknown>, stackKeys: string[]): number {
  return stackKeys.reduce((sum, key) => sum + toMinorValue(payload[key]), 0);
}

type BarValueLabelsProps = {
  dataKey: string;
  formatter?: (value: unknown) => string;
};

export function VerticalBarValueLabels({ dataKey, formatter = formatMinorBarLabel }: BarValueLabelsProps) {
  return (
    <LabelList dataKey={dataKey} position="top" formatter={(value) => formatter(value)} style={BAR_VALUE_LABEL_STYLE} />
  );
}

export function HorizontalBarValueLabels({ dataKey, formatter = formatMinorBarLabel }: BarValueLabelsProps) {
  return (
    <LabelList dataKey={dataKey} position="right" formatter={(value) => formatter(value)} style={BAR_VALUE_LABEL_STYLE} />
  );
}

type StackTopBarLabelProps = {
  stackKeys: string[];
  segmentKey: string;
  formatter?: (value: unknown) => string;
};

/** Bar `label` config that prints one total above each stacked column. */
export function stackTopBarLabel({ stackKeys, segmentKey, formatter = formatMinorBarLabel }: StackTopBarLabelProps) {
  return {
    position: "top" as const,
    fill: BAR_VALUE_LABEL_STYLE.fill,
    fontSize: BAR_VALUE_LABEL_STYLE.fontSize,
    fontWeight: BAR_VALUE_LABEL_STYLE.fontWeight,
    valueAccessor: (entry: { payload?: Record<string, unknown> | null }) => {
      const payload = entry.payload;
      if (!payload || topStackSegmentKey(payload, stackKeys) !== segmentKey) {
        return undefined;
      }
      const total = stackTotalFromPayload(payload, stackKeys);
      return total > 0 ? total : undefined;
    },
    formatter: (value: unknown) => formatter(value)
  };
}

export const STACKED_BAR_Y_AXIS_WIDTH = 72;

/** Room for 5-digit Y-axis ticks (e.g. 14,901) without clipping the leading digit. */
export const STACKED_BAR_CHART_MARGINS = { top: 32, right: 20, left: 8, bottom: 8 } as const;

export function stackedBarYAxisDomain([, dataMax]: readonly [number, number]): [number, number] {
  if (!Number.isFinite(dataMax) || dataMax <= 0) {
    return [0, 0];
  }
  return [0, Math.ceil(dataMax * 1.12)];
}

/** Vertical stacked-bar Y axis: sqrt scale with headroom for top labels. */
export const STACKED_BAR_SQRT_Y_AXIS = {
  scale: "sqrt" as const,
  domain: stackedBarYAxisDomain
} as const;

/** Tighter category spacing when the trend chart shows a full year of months. */
export function stackedTrendBarLayout(categoryCount: number): { barCategoryGap: string; barGap: number } {
  if (categoryCount >= 12) {
    return { barCategoryGap: "8%", barGap: 3 };
  }
  if (categoryCount >= 8) {
    return { barCategoryGap: "12%", barGap: 3 };
  }
  return { barCategoryGap: "20%", barGap: 4 };
}
