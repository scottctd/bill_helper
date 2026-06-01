/**
 * CALLING SPEC:
 * - Purpose: render the `AccountsTableSection` React UI module.
 * - Inputs: callers that import `frontend/src/features/accounts/AccountsTableSection.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `AccountsTableSection`.
 * - Side effects: React rendering and user event wiring.
 */
import { DeleteIconButton } from "../../components/DeleteIconButton";
import type { Account } from "../../lib/types";
import { Badge } from "../../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { formatMinor } from "../../lib/format";
import { toDateLabel } from "./helpers";

interface AccountsTableSectionProps {
  accounts: Account[] | undefined;
  filteredAccounts: Account[];
  accountSearch: string;
  selectedAccountId: string;
  onSelectAccount: (accountId: string) => void;
  onEditAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => void;
  ownerNameForId: (ownerUserId: string) => string;
  isLoading: boolean;
  errorMessage: string | null;
}

export function AccountsTableSection(props: AccountsTableSectionProps) {
  const {
    accounts,
    filteredAccounts,
    accountSearch,
    selectedAccountId,
    onSelectAccount,
    onEditAccount,
    onDeleteAccount,
    ownerNameForId,
    isLoading,
    errorMessage
  } = props;

  return (
    <div className="table-shell">
      {isLoading ? <p>Loading accounts...</p> : null}
      {errorMessage ? <p className="error">{errorMessage}</p> : null}

      {accounts ? (
        filteredAccounts.length ? (
          <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="icon-action-column">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map((account) => (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer"
                    data-state={account.id === selectedAccountId ? "selected" : undefined}
                    onClick={() => onSelectAccount(account.id)}
                    onDoubleClick={() => onEditAccount(account.id)}
                  >
                    <TableCell className="font-medium">{account.name}</TableCell>
                    <TableCell>{ownerNameForId(account.owner_user_id)}</TableCell>
                    <TableCell>{account.currency_code}</TableCell>
                    <TableCell>{formatMinor(account.balance_minor, account.currency_code)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          account.is_active
                            ? "border-success/45 bg-success/15 text-success-foreground"
                            : "border-border/80 bg-muted/45 text-muted-foreground"
                        }
                      >
                        {account.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>{toDateLabel(account.updated_at)}</TableCell>
                    <TableCell className="icon-action-column">
                      <div className="table-actions">
                        <DeleteIconButton
                          label={`Delete account ${account.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteAccount(account.id);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        ) : (
          <p className="muted">{accountSearch.trim() ? "No accounts match this search." : "No accounts yet."}</p>
        )
      ) : null}
    </div>
  );
}
