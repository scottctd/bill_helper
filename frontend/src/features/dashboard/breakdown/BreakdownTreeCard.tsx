/**
 * CALLING SPEC:
 * - Purpose: render hierarchical expense breakdown tree (filter group → tag → to → entries).
 * - Inputs: dashboard payload and selected month key.
 * - Outputs: expandable tree card with search, sort, and inline entry drill-down.
 * - Side effects: React rendering and local expand/collapse state only.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { formatMinor } from "../../../lib/format";
import type { Dashboard, DashboardFilterGroupSummary } from "../../../lib/types";
import { cn } from "../../../lib/utils";
import { CHART_COLORS } from "../helpers";
import {
  expenseFilterGroups,
  formatBreakdownEntryDate,
  formatBreakdownEntryRelativeAge,
  formatBreakdownShare,
  formatBreakdownTagLabel,
  toExpansionKey,
  getTagBreakdown,
  listTagsForGroup,
  resolveGroupColor,
  selectionKey,
  sortExpenseFilterGroups,
  type BreakdownTagSort
} from "./breakdownHelpers";
import { BreakdownTagLabel } from "./shared/BreakdownTagLabel";

export type BreakdownTreeCardProps = {
  data: Dashboard;
  month: string;
};

type TagRow = {
  tag: string;
  totalMinor: number;
  shareOfGroup: number;
};

function firstGroupWithSpendKey(groups: DashboardFilterGroupSummary[]): string | null {
  return groups.find((group) => group.total_minor > 0)?.key ?? null;
}

function matchesSearch(value: string, query: string): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query);
}

function filterGroupsForSearch(groups: DashboardFilterGroupSummary[], query: string, sort: BreakdownTagSort) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return groups.map((group) => ({ group, tags: listTagsForGroup(group, sort) }));
  }

  return groups
    .map((group) => {
      const groupMatches = matchesSearch(group.name, normalized);
      const tags = listTagsForGroup(group, sort).filter(
        (row) => groupMatches || matchesSearch(formatBreakdownTagLabel(row.tag), normalized) || matchesSearch(row.tag, normalized)
      );
      if (!groupMatches && tags.length === 0) return null;
      return { group, tags };
    })
    .filter((row): row is { group: DashboardFilterGroupSummary; tags: TagRow[] } => row !== null);
}

function sortToggleLabel(sort: BreakdownTagSort): string {
  return sort === "amount_desc" ? "Amount (high→low)" : "Amount (low→high)";
}

function nextSortToggle(sort: BreakdownTagSort): BreakdownTagSort {
  return sort === "amount_desc" ? "amount_asc" : "amount_desc";
}

export function BreakdownTreeCard({ data, month }: BreakdownTreeCardProps) {
  const expenseGroups = useMemo(
    () => sortExpenseFilterGroups(expenseFilterGroups(data.filter_groups)),
    [data.filter_groups]
  );
  const defaultGroupKey = useMemo(() => firstGroupWithSpendKey(expenseGroups), [expenseGroups]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    defaultGroupKey ? new Set([defaultGroupKey]) : new Set()
  );
  const [expandedTags, setExpandedTags] = useState<Set<string>>(() => new Set());
  const [expandedTos, setExpandedTos] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [tagSort, setTagSort] = useState<BreakdownTagSort>("amount_desc");

  useEffect(() => {
    const nextDefault = firstGroupWithSpendKey(expenseGroups);
    setExpandedGroups(nextDefault ? new Set([nextDefault]) : new Set());
    setExpandedTags(new Set());
    setExpandedTos(new Set());
    setSearchQuery("");
  }, [month, expenseGroups]);

  const visibleRows = useMemo(
    () => filterGroupsForSearch(expenseGroups, searchQuery, tagSort),
    [expenseGroups, searchQuery, tagSort]
  );

  const monthExpenseMinor = data.kpis.expense_total_minor;

  const expandAll = () => {
    setExpandedGroups(new Set(visibleRows.map((row) => row.group.key)));
    setExpandedTags(
      new Set(
        visibleRows.flatMap(({ group, tags }) =>
          tags.map((tagRow) => selectionKey({ filterGroupKey: group.key, filterGroupId: group.filter_group_id, filterGroupName: group.name, tag: tagRow.tag }))
        )
      )
    );
  };

  const collapseAll = () => {
    setExpandedGroups(new Set());
    setExpandedTags(new Set());
    setExpandedTos(new Set());
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const toggleTag = (selection: { filterGroupKey: string; filterGroupId: string; filterGroupName: string; tag: string }) => {
    const key = selectionKey(selection);
    setExpandedTags((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTo = (filterGroupKey: string, tag: string, toLabel: string) => {
    const key = toExpansionKey(filterGroupKey, tag, toLabel);
    setExpandedTos((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card className="w-full">
      <CardHeader className="gap-4">
        <CardTitle>Expense Breakdown Tree</CardTitle>
        <p className="text-sm text-muted-foreground">
          Expand tags to see ranked destinations (`to`), then expand a destination to see matching entries for {month}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={expandAll}>
            Expand all
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={collapseAll}>
            Collapse all
          </Button>
          <label className="flex min-w-[12rem] flex-1 items-center gap-2">
            <span className="sr-only">Search breakdown tree</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search groups or tags"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setTagSort(nextSortToggle(tagSort))}>
            {sortToggleLabel(tagSort)}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="muted text-sm">No expense groups match this search.</p>
        ) : (
          <div role="tree" aria-label={`Expense breakdown tree for ${month}`} className="space-y-2">
            {visibleRows.map(({ group, tags }) => {
              const groupExpanded = expandedGroups.has(group.key);
              const groupShare = monthExpenseMinor > 0 ? group.total_minor / monthExpenseMinor : 0;
              const groupColor = resolveGroupColor(group);

              return (
                <div key={group.key} role="treeitem" aria-expanded={groupExpanded} aria-level={1} className="rounded-lg border border-border/70">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/20"
                    onClick={() => toggleGroup(group.key)}
                  >
                    {groupExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: groupColor }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                    <span className="shrink-0 tabular-nums">{formatMinor(group.total_minor, data.currency_code)}</span>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatBreakdownShare(groupShare)}</span>
                  </button>

                  {groupExpanded ? (
                    <div role="group" className="space-y-1 border-t border-border/60 px-2 py-2">
                      {tags.length === 0 ? (
                        <p className="muted px-2 py-1 text-sm">No tags in this group.</p>
                      ) : (
                        tags.map((tagRow) => {
                          const selection = {
                            filterGroupKey: group.key,
                            filterGroupId: group.filter_group_id,
                            filterGroupName: group.name,
                            tag: tagRow.tag
                          };
                          const tagKey = selectionKey(selection);
                          const tagExpanded = expandedTags.has(tagKey);
                          const breakdown = getTagBreakdown(group, tagRow.tag);
                          const toItems = breakdown?.to_items ?? [];
                          const entryCount = breakdown?.entry_count;

                          return (
                            <div key={tagKey} role="treeitem" aria-expanded={tagExpanded} aria-level={2}>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted/20",
                                  tagExpanded && "bg-muted/10"
                                )}
                                onClick={() => toggleTag(selection)}
                              >
                                {toItems.length > 0 ? (
                                  tagExpanded ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                                  )
                                ) : (
                                  <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                                )}
                                <BreakdownTagLabel tag={tagRow.tag} className="min-w-0 flex-1 font-medium" />
                                <span className="shrink-0 tabular-nums">{formatMinor(tagRow.totalMinor, data.currency_code)}</span>
                                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                  {formatBreakdownShare(tagRow.shareOfGroup)}
                                </span>
                                {entryCount != null ? (
                                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                    {entryCount} {entryCount === 1 ? "entry" : "entries"}
                                  </span>
                                ) : null}
                              </button>

                              {tagExpanded && toItems.length > 0 ? (
                                <div className="space-y-1 pb-2 pl-6 pr-2" role="group">
                                  {toItems.map((toItem, toIndex) => {
                                    const toKey = toExpansionKey(group.key, tagRow.tag, toItem.label);
                                    const toExpanded = expandedTos.has(toKey);
                                    const barWidth =
                                      tagRow.totalMinor > 0 ? `${Math.max(4, (toItem.total_minor / tagRow.totalMinor) * 100)}%` : "0%";

                                    return (
                                      <div key={toKey} role="treeitem" aria-expanded={toExpanded} aria-level={3}>
                                        <button
                                          type="button"
                                          className={cn(
                                            "flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/20",
                                            toExpanded && "bg-muted/20"
                                          )}
                                          onClick={() => toggleTo(group.key, tagRow.tag, toItem.label)}
                                        >
                                          {toItem.entries.length > 0 ? (
                                            toExpanded ? (
                                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                            ) : (
                                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                            )
                                          ) : (
                                            <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
                                          )}
                                          <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{toIndex + 1}.</span>
                                          <span className="min-w-0 flex-1 truncate font-medium">{toItem.label}</span>
                                          <span className="shrink-0 tabular-nums">{formatMinor(toItem.total_minor, data.currency_code)}</span>
                                          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                            {formatBreakdownShare(toItem.share)}
                                          </span>
                                        </button>
                                        <div className="mx-3 mb-1 h-1.5 overflow-hidden rounded-full bg-muted/40">
                                          <div className="h-full rounded-full" style={{ width: barWidth, backgroundColor: CHART_COLORS.destination }} />
                                        </div>

                                        {toExpanded && toItem.entries.length > 0 ? (
                                          <div className="mb-2 ml-8 mr-1 overflow-hidden rounded-md border border-border/60" role="group">
                                            <table className="w-full text-sm">
                                              <thead className="bg-muted/30 text-xs text-muted-foreground">
                                                <tr>
                                                  <th className="px-3 py-1.5 text-left font-medium">Date</th>
                                                  <th className="px-3 py-1.5 text-left font-medium">Name</th>
                                                  <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {toItem.entries.map((entry) => (
                                                  <tr key={entry.id} className="border-t border-border/50">
                                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                                      {formatBreakdownEntryDate(entry.occurred_at)}
                                                      <span className="breakdown-entry-relative-age">
                                                        {" "}
                                                        ({formatBreakdownEntryRelativeAge(entry.occurred_at)})
                                                      </span>
                                                    </td>
                                                    <td className="max-w-[12rem] truncate px-3 py-1.5">{entry.name}</td>
                                                    <td className="px-3 py-1.5 text-right tabular-nums">
                                                      {formatMinor(entry.amount_minor, data.currency_code)}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
