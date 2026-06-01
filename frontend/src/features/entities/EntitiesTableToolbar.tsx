/**
 * CALLING SPEC:
 * - Purpose: render the entities list workspace toolbar.
 * - Inputs: search value, category filter state, and change handlers.
 * - Outputs: the entities table toolbar React tree.
 * - Side effects: user event wiring only.
 */
import { Plus } from "lucide-react";

import { TagMultiSelect } from "../../components/TagMultiSelect";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { Tag } from "../../lib/types";

type EntitiesTableToolbarProps = {
  search: string;
  categoryOptions: Tag[];
  selectedCategories: string[];
  onSearchChange: (value: string) => void;
  onCategoriesChange: (nextCategories: string[]) => void;
  onToggleCreatePanel: () => void;
};

export function EntitiesTableToolbar({
  search,
  categoryOptions,
  selectedCategories,
  onSearchChange,
  onCategoriesChange,
  onToggleCreatePanel
}: EntitiesTableToolbarProps) {
  return (
    <WorkspaceToolbar className="workspace-table-toolbar filter-row">
      <div className="table-toolbar-filters">
        <label className="field min-w-[220px] grow">
          <span>Search</span>
          <Input placeholder="Filter by name" value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </label>
        <label className="field min-w-[180px]">
          <span>Categories</span>
          <TagMultiSelect
            options={categoryOptions}
            value={selectedCategories}
            ariaLabel="Category filter"
            placeholder="All categories"
            allowCreate={false}
            displayMode="compact"
            onChange={onCategoriesChange}
          />
        </label>
      </div>
      <div className="table-toolbar-action filter-action">
        <Button type="button" size="icon" variant="outline" aria-label="Add entity" onClick={onToggleCreatePanel}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </WorkspaceToolbar>
  );
}
