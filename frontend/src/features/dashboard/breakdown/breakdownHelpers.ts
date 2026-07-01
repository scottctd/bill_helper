/**
 * CALLING SPEC:
 * - Purpose: pure helpers for dashboard category-breakdown tree views.
 * - Inputs: dashboard category summaries and breakdown items.
 * - Outputs: sorted categories, child rows, and entry date/relative-age helpers.
 * - Side effects: none.
 */

import type { DashboardCategoryChildSummary, DashboardCategorySummary } from "../../../lib/types";
import { listOrEmpty } from "../../../lib/collections";

export type CategorySort = "amount_desc" | "amount_asc" | "alpha" | "share_desc";

export function sortCategorySummaries(categories: DashboardCategorySummary[]): DashboardCategorySummary[] {
  return [...categories].sort((left, right) => {
    // "Uncategorized" always last
    if (left.name === "Uncategorized" && right.name !== "Uncategorized") return 1;
    if (right.name === "Uncategorized" && left.name !== "Uncategorized") return -1;
    // Sort by total descending
    const diff = right.total_minor - left.total_minor;
    if (diff !== 0) return diff;
    return left.name.localeCompare(right.name);
  });
}

export function categoryChildRows(category: DashboardCategorySummary): DashboardCategoryChildSummary[] {
  return [...listOrEmpty(category.children)].sort((left, right) => {
    const diff = right.total_minor - left.total_minor;
    if (diff !== 0) return diff;
    return left.name.localeCompare(right.name);
  });
}

export function formatBreakdownShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.1) return `${(share * 100).toFixed(1)}%`;
  return `${Math.round(share * 100)}%`;
}

export function formatBreakdownEntryDate(dateStr: string): string {
  const date = parseIsoDateLocal(dateStr);
  if (!date) return dateStr || "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Relative age suffix for breakdown entry dates, e.g. "4 days ago". */
export function formatBreakdownEntryRelativeAge(dateStr: string, referenceDate: Date = new Date()): string {
  const entryDate = parseIsoDateLocal(dateStr);
  if (!entryDate) return "";

  const diffDays = diffCalendarDays(entryDate, referenceDate);
  if (diffDays < 0) return "In the future";
  if (diffDays === 0) return "Today";
  if (diffDays < 7) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    const days = diffDays % 7;
    const weekLabel = weeks === 1 ? "1 week" : `${weeks} weeks`;
    if (days === 0) return `${weekLabel} ago`;
    const dayLabel = days === 1 ? "1 day" : `${days} days`;
    return `${weekLabel} ${dayLabel} ago`;
  }

  const months = Math.floor(diffDays / 30);
  const remainder = diffDays % 30;
  const weeks = Math.floor(remainder / 7);
  const days = remainder % 7;
  const monthLabel = months === 1 ? "1 month" : `${months} months`;
  const weekLabel = weeks === 1 ? "1 week" : `${weeks} weeks`;
  const dayLabel = days === 1 ? "1 day" : `${days} days`;
  return `${monthLabel} ${weekLabel} ${dayLabel} ago`;
}

function parseIsoDateLocal(dateStr: string): Date | null {
  const parts = String(dateStr ?? "").split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function diffCalendarDays(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
