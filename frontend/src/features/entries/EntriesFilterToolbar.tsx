/**
 * CALLING SPEC:
 * - Purpose: render the two-row entries list filter toolbar.
 * - Inputs: filter state, option catalogs, validation errors, and change handlers.
 * - Outputs: the entries filter toolbar React tree.
 * - Side effects: user event wiring only.
 */
import { Plus } from "lucide-react";

import { SingleSelect, type SingleSelectOption } from "../../components/SingleSelect";
import { TagMultiSelect } from "../../components/TagMultiSelect";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import type { Tag } from "../../lib/types";

import type { EntryListFilters } from "./entriesFilters";

type EntriesFilterToolbarProps = {
  filters: EntryListFilters;
  tagOptions: Tag[];
  currencyOptions: Tag[];
  entityOptions: Tag[];
  categoryOptions: SingleSelectOption[];
  dateRangeError: string | null;
  activeFilterCount: number;
  visibleEntryCount: number;
  totalEntryCount: number;
  onFiltersChange: (update: Partial<EntryListFilters>) => void;
  onClearFilters: () => void;
  onAddEntry: () => void;
};

export function EntriesFilterToolbar({
  filters,
  tagOptions,
  currencyOptions,
  entityOptions,
  categoryOptions,
  dateRangeError,
  activeFilterCount,
  visibleEntryCount,
  totalEntryCount,
  onFiltersChange,
  onClearFilters,
  onAddEntry
}: EntriesFilterToolbarProps) {
  const statusLabel =
    totalEntryCount > 0
      ? activeFilterCount > 0
        ? `Showing ${visibleEntryCount} of ${totalEntryCount} entries · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`
        : `Showing ${visibleEntryCount} of ${totalEntryCount} entries`
      : activeFilterCount > 0
        ? "No entries found · filters active"
        : "No entries found";

  return (
    <WorkspaceToolbar className="entries-filter-toolbar">
      <div className="entries-filter-toolbar-grid">
        <div className="entries-filter-toolbar-row entries-filter-toolbar-row-scope">
          <label className="field entries-filter-date-field">
            <span>From date</span>
            <Input
              type="date"
              value={filters.startDate}
              onChange={(event) => onFiltersChange({ startDate: event.target.value })}
            />
          </label>
          <label className="field entries-filter-date-field">
            <span>To date</span>
            <Input
              type="date"
              value={filters.endDate}
              onChange={(event) => onFiltersChange({ endDate: event.target.value })}
            />
          </label>
          <label className="field entries-filter-entity-field">
            <span>From entity</span>
            <TagMultiSelect
              options={entityOptions}
              value={filters.fromEntities}
              ariaLabel="From entity filter"
              placeholder="All sources"
              allowCreate={false}
              displayMode="compact"
              onChange={(nextEntities) => onFiltersChange({ fromEntities: nextEntities })}
            />
          </label>
          <label className="field entries-filter-entity-field">
            <span>To entity</span>
            <TagMultiSelect
              options={entityOptions}
              value={filters.toEntities}
              ariaLabel="To entity filter"
              placeholder="All destinations"
              allowCreate={false}
              displayMode="compact"
              onChange={(nextEntities) => onFiltersChange({ toEntities: nextEntities })}
            />
          </label>
          <label className="field entries-filter-category-field">
            <span>Category</span>
            <SingleSelect
              options={categoryOptions}
              value={filters.category}
              ariaLabel="Category filter"
              placeholder="All categories"
              searchable
              searchPlaceholder="Search categories..."
              minMenuWidth={320}
              onChange={(category) => onFiltersChange({ category })}
            />
          </label>
        </div>

        <div className="entries-filter-toolbar-row entries-filter-toolbar-row-refine">
          <div className="entries-filter-toolbar-refine-filters">
            <label className="field entries-filter-kind-field">
              <span>Kind</span>
              <NativeSelect value={filters.kind} onChange={(event) => onFiltersChange({ kind: event.target.value })}>
                <option value="">All</option>
                <option value="EXPENSE">- Expense</option>
                <option value="INCOME">+ Income</option>
                <option value="TRANSFER">~ Transfer</option>
              </NativeSelect>
            </label>
            <label className="field entries-filter-source-field">
              <span>Source text</span>
              <Input
                value={filters.source}
                onChange={(event) => onFiltersChange({ source: event.target.value })}
              />
            </label>
            <label className="field entries-filter-tags-field">
              <span>Tags</span>
              <TagMultiSelect
                options={tagOptions}
                value={filters.tags}
                ariaLabel="Tag filter"
                placeholder="All tags"
                allowCreate={false}
                displayMode="compact"
                onChange={(nextTags) => onFiltersChange({ tags: nextTags })}
              />
            </label>
            <label className="field entries-filter-currencies-field">
              <span>Currencies</span>
              <TagMultiSelect
                options={currencyOptions}
                value={filters.currencies}
                ariaLabel="Currency filter"
                placeholder="All currencies"
                allowCreate={false}
                displayMode="compact"
                onChange={(nextCurrencies) => onFiltersChange({ currencies: nextCurrencies })}
              />
            </label>
          </div>
          <div className="entries-filter-toolbar-action filter-action">
            <Button type="button" size="icon" variant="outline" aria-label="Add entry" onClick={onAddEntry}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {dateRangeError ? <p className="entries-filter-date-error error">{dateRangeError}</p> : null}

      <div className="entries-filter-toolbar-status">
        <p className="entries-filter-status-label muted">{statusLabel}</p>
        {activeFilterCount > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </WorkspaceToolbar>
  );
}
