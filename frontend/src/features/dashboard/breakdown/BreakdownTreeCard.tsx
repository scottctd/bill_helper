/**
 * CALLING SPEC:
 * - Purpose: render hierarchical expense breakdown tree (category -> sub-category -> destination -> entries).
 * - Inputs: top-level categories, currency metadata, and scope label.
 * - Outputs: expandable tree card with search, sort, and inline entry drill-down.
 * - Side effects: React rendering and local expand/collapse state only.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { formatMinor } from "../../../lib/format";
import { entryCategoryColor, formatEntryCategoryLabel } from "../../../lib/entryClassificationColors";
import type { DashboardCategoryChildSummary, DashboardCategorySummary, DashboardToBreakdownItem } from "../../../lib/types";
import { listOrEmpty } from "../../../lib/collections";
import { cn } from "../../../lib/utils";
import { CHART_COLORS } from "../helpers";
import {
  categoryChildRows,
  formatBreakdownEntryDate,
  formatBreakdownEntryRelativeAge,
  formatBreakdownShare,
  sortCategorySummaries,
  type CategorySort
} from "./breakdownHelpers";

export type BreakdownTreeCardProps = {
  categories: DashboardCategorySummary[];
  currencyCode: string;
  expenseTotalMinor: number;
  scopeLabel: string;
};

function firstCategoryWithSpend(categories: DashboardCategorySummary[]): string | null {
  return categories.find((cat) => cat.total_minor > 0)?.name ?? null;
}

function matchesSearch(value: string, query: string): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query);
}

function filterCategoriesForSearch(
  categories: DashboardCategorySummary[],
  query: string,
  sort: CategorySort
): Array<{ category: DashboardCategorySummary; children: DashboardCategoryChildSummary[] }> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return categories.map((cat) => ({ category: cat, children: categoryChildRows(cat) }));
  }

  return categories
    .map((cat) => {
      const catMatches = matchesSearch(cat.name, normalized);
      const children = categoryChildRows(cat).filter(
        (child) => catMatches || matchesSearch(child.name, normalized) || matchesSearch(child.path, normalized)
      );
      const destsMatch = cat.to_breakdown?.some(
        (dest) => catMatches || matchesSearch(dest.label, normalized)
      );
      if (!catMatches && children.length === 0 && !destsMatch) return null;
      return { category: cat, children };
    })
    .filter((row): row is { category: DashboardCategorySummary; children: DashboardCategoryChildSummary[] } => row !== null);
}

function sortToggleLabel(sort: CategorySort): string {
  return sort === "amount_desc" ? "Amount (high->low)" : "Amount (low->high)";
}

function nextSortToggle(sort: CategorySort): CategorySort {
  return sort === "amount_desc" ? "amount_asc" : "amount_desc";
}

function isUncategorized(category: DashboardCategorySummary): boolean {
  return category.name === "Uncategorized";
}

export function BreakdownTreeCard({ categories, currencyCode, expenseTotalMinor, scopeLabel }: BreakdownTreeCardProps) {
  const sortedCategories = useMemo(() => sortCategorySummaries(categories), [categories]);
  const defaultCategoryName = useMemo(() => firstCategoryWithSpend(sortedCategories), [sortedCategories]);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() =>
    defaultCategoryName ? new Set([defaultCategoryName]) : new Set()
  );
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(() => new Set());
  const [expandedDests, setExpandedDests] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [categorySort, setCategorySort] = useState<CategorySort>("amount_desc");

  useEffect(() => {
    const nextDefault = firstCategoryWithSpend(sortedCategories);
    setExpandedCategories(nextDefault ? new Set([nextDefault]) : new Set());
    setExpandedChildren(new Set());
    setExpandedDests(new Set());
    setSearchQuery("");
  }, [scopeLabel, sortedCategories]);

  const visibleRows = useMemo(
    () => filterCategoriesForSearch(sortedCategories, searchQuery, categorySort),
    [sortedCategories, searchQuery, categorySort]
  );

  const expandAll = () => {
    setExpandedCategories(new Set(visibleRows.map((row) => row.category.name)));
    setExpandedChildren(
      new Set(
        visibleRows.flatMap(({ category, children }) =>
          children.map((child) => child.path)
        )
      )
    );
  };

  const collapseAll = () => {
    setExpandedCategories(new Set());
    setExpandedChildren(new Set());
    setExpandedDests(new Set());
  };

  const toggleCategory = (name: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleChild = (path: string) => {
    setExpandedChildren((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleDest = (destKey: string) => {
    setExpandedDests((current) => {
      const next = new Set(current);
      if (next.has(destKey)) next.delete(destKey);
      else next.add(destKey);
      return next;
    });
  };

  /** Render destinations (to_breakdown items) for a given collection. */
  function renderDestinations(
    dests: DashboardToBreakdownItem[],
    parentKey: string,
    level: number
  ) {
    return dests.map((destItem) => {
      const destEntries = listOrEmpty(destItem.entries);
      const destKey = `${parentKey}:${destItem.label}`;
      const destExpanded = expandedDests.has(destKey);

      return (
        <div key={destKey} role="treeitem" aria-expanded={destExpanded} aria-level={level}>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-sm border border-border/60 bg-muted/10 px-3 py-2 text-left text-copy-14 transition-colors hover:bg-muted/20",
              destExpanded && "bg-muted/20"
            )}
            onClick={() => toggleDest(destKey)}
          >
            {destEntries.length > 0 ? (
              destExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )
            ) : (
              <span className="inline-block h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{destItem.label}</span>
            <span className="shrink-0 tabular-nums">{formatMinor(destItem.total_minor, currencyCode)}</span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {formatBreakdownShare(destItem.share)}
            </span>
          </button>

          {destExpanded && destEntries.length > 0 ? (
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
                  {destEntries.map((entry) => (
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
                        {formatMinor(entry.amount_minor, currencyCode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      );
    });
  }

  /** Render children (sub-categories) for a given category. */
  function renderChildren(
    category: DashboardCategorySummary,
    children: DashboardCategoryChildSummary[]
  ) {
    if (children.length === 0) {
      // Uncategorized or categories with no children: show to_breakdown directly
      if (listOrEmpty(category.to_breakdown).length > 0) {
        return (
          <div className="space-y-1 px-2 py-2" role="group">
            {renderDestinations(listOrEmpty(category.to_breakdown), category.name, 3)}
          </div>
        );
      }
      return <p className="muted px-4 py-2 text-sm">No breakdown available for this category.</p>;
    }

    return (
      <div className="space-y-1 border-t border-border/60 px-2 py-2" role="group">
        {children.map((child, childIndex) => {
          const childExpanded = expandedChildren.has(child.path);
          return (
            <div key={child.path} role="treeitem" aria-expanded={childExpanded} aria-level={2}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-copy-14 transition-colors hover:bg-muted/20",
                  childExpanded && "bg-muted/10"
                )}
                onClick={() => toggleChild(child.path)}
              >
                {listOrEmpty(child.to_breakdown).length > 0 ? (
                  childExpanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  )
                ) : (
                  <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{child.name}</span>
                <span className="shrink-0 tabular-nums">{formatMinor(child.total_minor, currencyCode)}</span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {formatBreakdownShare(child.share)}
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {child.entry_count} {child.entry_count === 1 ? "entry" : "entries"}
                </span>
              </button>

              {childExpanded && listOrEmpty(child.to_breakdown).length > 0 ? (
                <div className="space-y-1 pb-2 pl-6 pr-2" role="group">
                  {renderDestinations(listOrEmpty(child.to_breakdown), child.path, 3)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="gap-4">
        <CardTitle>Expense Breakdown Tree</CardTitle>
        <p className="text-sm text-muted-foreground">
          Expand a category to see sub-categories, then expand a sub-category to see destinations with matching entries for {scopeLabel}.
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
              placeholder="Search categories or destinations"
              className="h-9 w-full rounded-sm border border-input bg-background px-3 text-copy-14"
            />
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => setCategorySort(nextSortToggle(categorySort))}>
            {sortToggleLabel(categorySort)}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="muted text-sm">No categories match this search.</p>
        ) : (
          <div role="tree" aria-label={`Expense breakdown tree for ${scopeLabel}`} className="space-y-2">
            {visibleRows.map(({ category, children }) => {
              const catExpanded = expandedCategories.has(category.name);
              const catShare = expenseTotalMinor > 0 ? category.total_minor / expenseTotalMinor : 0;

              return (
                <div key={category.name} role="treeitem" aria-expanded={catExpanded} aria-level={1} className="rounded-md border border-border/70">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/20"
                    onClick={() => toggleCategory(category.name)}
                  >
                    {catExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: entryCategoryColor(category.name) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{formatEntryCategoryLabel(category.name)}</span>
                    <span className="shrink-0 tabular-nums">{formatMinor(category.total_minor, currencyCode)}</span>
                    <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatBreakdownShare(catShare)}</span>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {category.entry_count} {category.entry_count === 1 ? "entry" : "entries"}
                    </span>
                  </button>

                  {catExpanded ? renderChildren(category, children) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
