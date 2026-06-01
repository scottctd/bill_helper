/**
 * CALLING SPEC:
 * - Purpose: render the groups list workspace toolbar.
 * - Inputs: search and group-type filter state plus change handlers.
 * - Outputs: the groups table toolbar React tree.
 * - Side effects: user event wiring only.
 */
import { Plus } from "lucide-react";

import { TagMultiSelect } from "../../components/TagMultiSelect";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { Tag } from "../../lib/types";

type GroupsTableToolbarProps = {
  search: string;
  groupTypeOptions: Tag[];
  selectedGroupTypes: string[];
  onSearchChange: (value: string) => void;
  onGroupTypesChange: (nextGroupTypes: string[]) => void;
  onAddGroup: () => void;
};

export function GroupsTableToolbar({
  search,
  groupTypeOptions,
  selectedGroupTypes,
  onSearchChange,
  onGroupTypesChange,
  onAddGroup
}: GroupsTableToolbarProps) {
  return (
    <WorkspaceToolbar className="workspace-table-toolbar filter-row">
      <div className="table-toolbar-filters">
        <label className="field min-w-[220px] grow">
          <span>Search</span>
          <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Filter by name" />
        </label>
        <label className="field min-w-[180px]">
          <span>Types</span>
          <TagMultiSelect
            options={groupTypeOptions}
            value={selectedGroupTypes}
            ariaLabel="Group type filter"
            placeholder="All types"
            allowCreate={false}
            displayMode="compact"
            onChange={onGroupTypesChange}
          />
        </label>
      </div>
      <div className="table-toolbar-action filter-action">
        <Button type="button" size="icon" variant="outline" aria-label="Add group" onClick={onAddGroup}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </WorkspaceToolbar>
  );
}
