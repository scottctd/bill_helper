/**
 * CALLING SPEC:
 * - Purpose: pure helpers for dashboard breakdown tree views.
 * - Inputs: dashboard filter group summaries, tag keys, and breakdown items.
 * - Outputs: sorted groups/tags, lookup helpers, and entry deep-link URLs.
 * - Side effects: none.
 */

import type {
  Dashboard,
  DashboardFilterGroupSummary,
  DashboardTagToBreakdown,
  DashboardToBreakdownItem
} from "../../../lib/types";
import {
  BUILTIN_FILTER_GROUP_ORDER,
  buildYearFilterGroupTagTotals,
  isIncomeFilterGroupKey,
  sortByBuiltinOrder,
  sumDashboardKpiForMonths,
  sumFilterGroupForMonths
} from "../helpers";

export type BreakdownTagSort = "amount_desc" | "amount_asc" | "alpha" | "share_desc";

export type BreakdownTagSelection = {
  filterGroupKey: string;
  filterGroupId: string;
  filterGroupName: string;
  tag: string;
};

export function expenseFilterGroups(groups: DashboardFilterGroupSummary[]): DashboardFilterGroupSummary[] {
  return groups.filter((group) => !isIncomeFilterGroupKey(group.key));
}

export function sortExpenseFilterGroups(groups: DashboardFilterGroupSummary[]): DashboardFilterGroupSummary[] {
  const builtin = sortByBuiltinOrder(groups.filter((group) => BUILTIN_FILTER_GROUP_ORDER.includes(group.key as (typeof BUILTIN_FILTER_GROUP_ORDER)[number])));
  const custom = [...groups.filter((group) => !BUILTIN_FILTER_GROUP_ORDER.includes(group.key as (typeof BUILTIN_FILTER_GROUP_ORDER)[number]))].sort(
    (left, right) => right.total_minor - left.total_minor || left.name.localeCompare(right.name)
  );
  return [...builtin, ...custom];
}

export function formatBreakdownTagLabel(tag: string): string {
  if (tag === "(untagged)") return "Untagged";
  return tag.replace(/_/g, " ");
}

export function formatBreakdownShare(share: number): string {
  if (share <= 0) return "0%";
  if (share < 0.1) return `${(share * 100).toFixed(1)}%`;
  return `${Math.round(share * 100)}%`;
}

export function resolveGroupColor(group: DashboardFilterGroupSummary): string {
  return group.color ?? "hsl(var(--muted-foreground))";
}

export function getTagBreakdown(group: DashboardFilterGroupSummary, tag: string) {
  return group.tag_to_breakdowns?.find((item) => item.tag === tag);
}

export function listTagsForGroup(
  group: DashboardFilterGroupSummary,
  sort: BreakdownTagSort = "amount_desc"
): Array<{ tag: string; totalMinor: number; shareOfGroup: number }> {
  const rows = Object.entries(group.tag_totals).map(([tag, totalMinor]) => ({
    tag,
    totalMinor,
    shareOfGroup: group.total_minor > 0 ? totalMinor / group.total_minor : 0
  }));
  return sortTagRows(rows, sort);
}

export function sortTagRows<T extends { tag: string; totalMinor: number; shareOfGroup: number }>(rows: T[], sort: BreakdownTagSort): T[] {
  const copy = [...rows];
  switch (sort) {
    case "amount_asc":
      return copy.sort((left, right) => left.totalMinor - right.totalMinor || left.tag.localeCompare(right.tag));
    case "alpha":
      return copy.sort((left, right) => left.tag.localeCompare(right.tag));
    case "share_desc":
      return copy.sort((left, right) => right.shareOfGroup - left.shareOfGroup || left.tag.localeCompare(right.tag));
    default:
      return copy.sort((left, right) => right.totalMinor - left.totalMinor || left.tag.localeCompare(right.tag));
  }
}

export function buildBreakdownEntriesHref(filterGroupId: string, tag?: string): string {
  const params = new URLSearchParams({ filter_group_id: filterGroupId });
  if (tag) params.set("tag", tag);
  return `/entries?${params.toString()}`;
}

export function selectionKey(selection: BreakdownTagSelection): string {
  return `${selection.filterGroupKey}:${selection.tag}`;
}

export function toExpansionKey(filterGroupKey: string, tag: string, toLabel: string): string {
  return `${filterGroupKey}:${tag}:${toLabel}`;
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

/** Human-readable ledger date for breakdown entry rows, e.g. "May 5". */
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

function mergeToBreakdownItems(items: DashboardToBreakdownItem[]): DashboardToBreakdownItem[] {
  const byLabel = new Map<string, DashboardToBreakdownItem>();
  for (const item of items) {
    const existing = byLabel.get(item.label);
    if (!existing) {
      byLabel.set(item.label, {
        label: item.label,
        total_minor: item.total_minor,
        share: item.share,
        entries: [...item.entries]
      });
      continue;
    }
    existing.total_minor += item.total_minor;
    existing.entries.push(...item.entries);
  }

  return [...byLabel.values()]
    .map((item) => ({
      ...item,
      entries: [...item.entries].sort((left, right) => {
        if (right.amount_minor !== left.amount_minor) {
          return right.amount_minor - left.amount_minor;
        }
        return right.occurred_at.localeCompare(left.occurred_at);
      })
    }))
    .sort((left, right) => right.total_minor - left.total_minor || left.label.localeCompare(right.label));
}

function mergeTagToBreakdowns(breakdowns: DashboardTagToBreakdown[]): DashboardTagToBreakdown[] {
  const byTag = new Map<string, DashboardTagToBreakdown>();
  for (const breakdown of breakdowns) {
    const existing = byTag.get(breakdown.tag);
    if (!existing) {
      byTag.set(breakdown.tag, {
        tag: breakdown.tag,
        total_minor: breakdown.total_minor,
        entry_count: breakdown.entry_count,
        to_items: mergeToBreakdownItems(breakdown.to_items)
      });
      continue;
    }
    existing.total_minor += breakdown.total_minor;
    existing.entry_count += breakdown.entry_count;
    existing.to_items = mergeToBreakdownItems([...existing.to_items, ...breakdown.to_items]);
  }

  return [...byTag.values()]
    .map((breakdown) => {
      const tagTotal = breakdown.total_minor;
      return {
        ...breakdown,
        to_items: breakdown.to_items.map((item) => ({
          ...item,
          share: tagTotal > 0 ? item.total_minor / tagTotal : 0
        }))
      };
    })
    .sort((left, right) => right.total_minor - left.total_minor || left.tag.localeCompare(right.tag));
}

/** Aggregate filter groups across a year for the breakdown tree drill-down. */
export function mergeFilterGroupsForYearTree(
  filterGroups: DashboardFilterGroupSummary[],
  monthKeys: string[],
  dashboardsByMonth: Map<string, Dashboard>
): DashboardFilterGroupSummary[] {
  const yearExpenseTotalMinor = sumDashboardKpiForMonths(monthKeys, dashboardsByMonth, "expense_total_minor");
  const expenseGroups = sortExpenseFilterGroups(expenseFilterGroups(filterGroups));

  return expenseGroups.map((baseGroup) => {
    const totalMinor = sumFilterGroupForMonths(monthKeys, dashboardsByMonth, baseGroup.key);
    const tagTotals = buildYearFilterGroupTagTotals(baseGroup.key, monthKeys, dashboardsByMonth);
    const tagToBreakdowns = mergeTagToBreakdowns(
      monthKeys.flatMap((monthKey) => {
        const group = dashboardsByMonth.get(monthKey)?.filter_groups.find((item) => item.key === baseGroup.key);
        return group?.tag_to_breakdowns ?? [];
      })
    );

    return {
      ...baseGroup,
      total_minor: totalMinor,
      share: yearExpenseTotalMinor > 0 ? totalMinor / yearExpenseTotalMinor : 0,
      tag_totals: tagTotals,
      tag_to_breakdowns: tagToBreakdowns
    };
  });
}
