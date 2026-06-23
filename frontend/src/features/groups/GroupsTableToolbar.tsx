/**
 * CALLING SPEC:
 * - Purpose: render the groups list workspace toolbar.
 * - Inputs: search and group-source filter state plus change handlers.
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
  groupSourceOptions: Tag[];
  selectedGroupSources: string[];
  onSearchChange: (value: string) => void;
  onGroupSourcesChange: (nextGroupSources: string[]) => void;
  onAddGroup: () => void;
};

export function GroupsTableToolbar({
  search,
  groupSourceOptions,
  selectedGroupSources,
  onSearchChange,
  onGroupSourcesChange,
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
          <span>Sources</span>
          <TagMultiSelect
            options={groupSourceOptions}
            value={selectedGroupSources}
            ariaLabel="Group source filter"
            placeholder="All sources"
            allowCreate={false}
            displayMode="compact"
            onChange={onGroupSourcesChange}
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
