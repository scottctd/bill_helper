/**
 * CALLING SPEC:
 * - Purpose: render the accounts list workspace toolbar.
 * - Inputs: search, currency, owner, and status filter state plus change handlers.
 * - Outputs: the accounts table toolbar React tree.
 * - Side effects: user event wiring only.
 */
import { Plus } from "lucide-react";

import { TagMultiSelect } from "../../components/TagMultiSelect";
import { WorkspaceToolbar } from "../../components/layout/WorkspaceToolbar";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { NativeSelect } from "../../components/ui/native-select";
import type { Tag } from "../../lib/types";

export type AccountStatusFilter = "" | "active" | "inactive";

type AccountsTableToolbarProps = {
  accountSearch: string;
  currencyOptions: Tag[];
  ownerOptions: Tag[];
  selectedCurrencies: string[];
  selectedOwners: string[];
  statusFilter: AccountStatusFilter;
  onAccountSearchChange: (value: string) => void;
  onCurrenciesChange: (nextCurrencies: string[]) => void;
  onOwnersChange: (nextOwners: string[]) => void;
  onStatusFilterChange: (value: AccountStatusFilter) => void;
  onOpenCreateDialog: () => void;
};

export function AccountsTableToolbar({
  accountSearch,
  currencyOptions,
  ownerOptions,
  selectedCurrencies,
  selectedOwners,
  statusFilter,
  onAccountSearchChange,
  onCurrenciesChange,
  onOwnersChange,
  onStatusFilterChange,
  onOpenCreateDialog
}: AccountsTableToolbarProps) {
  return (
    <WorkspaceToolbar className="workspace-table-toolbar filter-row">
      <div className="table-toolbar-filters">
        <label className="field min-w-[200px] grow">
          <span>Search</span>
          <Input
            value={accountSearch}
            onChange={(event) => onAccountSearchChange(event.target.value)}
            placeholder="Filter by name"
          />
        </label>
        <label className="field min-w-[150px]">
          <span>Currencies</span>
          <TagMultiSelect
            options={currencyOptions}
            value={selectedCurrencies}
            ariaLabel="Currency filter"
            placeholder="All currencies"
            allowCreate={false}
            displayMode="compact"
            onChange={onCurrenciesChange}
          />
        </label>
        <label className="field min-w-[150px]">
          <span>Owners</span>
          <TagMultiSelect
            options={ownerOptions}
            value={selectedOwners}
            ariaLabel="Owner filter"
            placeholder="All owners"
            allowCreate={false}
            displayMode="compact"
            onChange={onOwnersChange}
          />
        </label>
        <label className="field min-w-[130px]">
          <span>Status</span>
          <NativeSelect value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as AccountStatusFilter)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </label>
      </div>
      <div className="table-toolbar-action filter-action">
        <Button type="button" size="icon" variant="outline" aria-label="Create account" onClick={onOpenCreateDialog}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </WorkspaceToolbar>
  );
}
