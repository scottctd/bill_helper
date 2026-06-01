/**
 * CALLING SPEC:
 * - Purpose: render the `CurrenciesSection` React UI module.
 * - Inputs: callers that import `frontend/src/features/properties/sections/CurrenciesSection.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `CurrenciesSection`.
 * - Side effects: React rendering and user event wiring.
 */
import type { Currency } from "../../../lib/types";
import { WorkspaceToolbar } from "../../../components/layout/WorkspaceToolbar";
import { Input } from "../../../components/ui/input";
import { NativeSelect } from "../../../components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import type { CurrencyStatusFilter } from "../types";

interface CurrenciesSectionProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: CurrencyStatusFilter;
  onStatusFilterChange: (value: CurrencyStatusFilter) => void;
  currencies: Currency[] | undefined;
  hasAnyCurrencies: boolean;
  isLoading: boolean;
  isError: boolean;
  queryErrorMessage: string | null;
}

export function CurrenciesSection(props: CurrenciesSectionProps) {
  const { search, onSearchChange, statusFilter, onStatusFilterChange, currencies, hasAnyCurrencies, isLoading, isError, queryErrorMessage } =
    props;

  return (
    <div className="table-shell">
      <div className="table-shell-header">
        <div>
          <h3 className="table-shell-title">Currencies</h3>
          <p className="table-shell-subtitle">Read-only catalog used by entries and accounts.</p>
        </div>
      </div>
      <WorkspaceToolbar className="workspace-table-toolbar filter-row">
        <div className="table-toolbar-filters">
          <label className="field min-w-[220px] grow">
            <span>Search</span>
            <Input placeholder="Filter by code or name" value={search} onChange={(event) => onSearchChange(event.target.value)} />
          </label>
          <label className="field min-w-[130px]">
            <span>Status</span>
            <NativeSelect value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as CurrencyStatusFilter)}>
              <option value="">All</option>
              <option value="built-in">Built-in</option>
              <option value="placeholder">Placeholder</option>
            </NativeSelect>
          </label>
        </div>
      </WorkspaceToolbar>

      {isLoading ? <p>Loading currencies...</p> : null}
      {isError ? <p className="error">{queryErrorMessage}</p> : null}

      {currencies ? (
        currencies.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currencies.map((currency) => (
                <TableRow key={currency.code}>
                  <TableCell>{currency.code}</TableCell>
                  <TableCell>{currency.name}</TableCell>
                  <TableCell>{currency.is_placeholder ? "Placeholder" : "Built-in"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="muted">{hasAnyCurrencies ? "No currencies match the current search." : "No currencies yet."}</p>
        )
      ) : null}
    </div>
  );
}
