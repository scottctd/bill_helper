/**
 * CALLING SPEC:
 * - Purpose: provide stable muted colors and display labels for entry categories and lifecycles.
 * - Inputs: category paths or parent names and lifecycle keys.
 * - Outputs: deterministic CSS colors and user-facing labels.
 * - Side effects: none.
 */

import type { EntryLifecycle } from "./types";

const CATEGORY_PARENT_HUES: Record<string, number> = {
  education: 218,
  entertainment: 276,
  financial: 34,
  food_drink: 342,
  health: 104,
  housing: 8,
  income: 146,
  refunds: 170,
  shopping: 310,
  software_tools: 188,
  transport: 258
};

const LIFECYCLE_COLORS: Record<EntryLifecycle, string> = {
  fixed: "hsl(6 34% 55%)",
  day_to_day: "hsl(38 46% 54%)",
  one_time: "hsl(214 34% 55%)"
};

function stableHash(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function entryCategoryParent(categoryPath: string | null | undefined): string {
  return (categoryPath ?? "").split("/")[0]?.trim().toLowerCase() || "uncategorized";
}

export function formatEntryCategoryLabel(value: string): string {
  return value === "Uncategorized" ? "uncategorized" : value;
}

export function entryCategoryColor(categoryPath: string | null | undefined): string {
  const normalizedPath = (categoryPath ?? "").trim().toLowerCase();
  const parent = entryCategoryParent(normalizedPath);
  if (parent === "uncategorized") {
    return "hsl(216 8% 55%)";
  }

  const baseHue = CATEGORY_PARENT_HUES[parent] ?? stableHash(parent) % 360;
  const child = normalizedPath.split("/")[1];
  if (!child) {
    return `hsl(${baseHue} 32% 50%)`;
  }

  const childHash = stableHash(child);
  const hueShift = (childHash % 19) - 9;
  const lightness = 43 + (childHash % 13);
  return `hsl(${(baseHue + hueShift + 360) % 360} 38% ${lightness}%)`;
}

export function entryLifecycleColor(lifecycle: string | null | undefined): string {
  if (lifecycle === "fixed" || lifecycle === "day_to_day" || lifecycle === "one_time") {
    return LIFECYCLE_COLORS[lifecycle];
  }
  return "hsl(216 8% 55%)";
}
