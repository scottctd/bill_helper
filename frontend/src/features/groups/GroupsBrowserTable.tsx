/**
 * CALLING SPEC:
 * - Purpose: render the groups browser table with source filters and detail actions.
 * - Inputs: groups page model fields for list data and open-detail callbacks.
 * - Outputs: groups table UI for the groups workspace.
 * - Side effects: keyboard and click handlers for row selection.
 */
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { groupRangeLabel } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { GroupsPageModel } from "./useGroupsPageModel";
import { getApiErrorMessage } from "../../lib/api/core";

interface GroupsBrowserTableProps {
  model: GroupsPageModel;
}

function rowKeyDownHandler(event: React.KeyboardEvent<HTMLTableRowElement>, onOpen: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onOpen();
  }
}

export function GroupsBrowserTable({ model }: GroupsBrowserTableProps) {
  const { groupsQuery } = model.queries;
  const groupsError = groupsQuery.isError ? getApiErrorMessage(groupsQuery.error) : null;

  return (
    <div className="table-shell">
      {groupsQuery.isLoading ? <p>Loading groups...</p> : null}
      {groupsError ? <p className="error">{groupsError}</p> : null}

      {!groupsQuery.isLoading && !groupsError && model.filteredGroups.length === 0 ? (
        <div className="groups-empty-state">
          <p className="groups-empty-title">No groups found</p>
          <p className="muted">Try another filter or create a new group.</p>
        </div>
      ) : null}

      {!groupsQuery.isLoading && !groupsError && model.filteredGroups.length > 0 ? (
        <div className="groups-browser-table-shell">
          <Table className="groups-browser-table">
            <TableHeader>
              <TableRow>
                <TableHead className="groups-browser-group-column">Group</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Date range</TableHead>
                <TableHead className="groups-browser-action-column">
                  <span className="sr-only">Open detail</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.filteredGroups.map((group) => {
                const isActive = model.isDetailOpen && group.id === model.selectedGroupId;
                return (
                  <TableRow
                    key={group.id}
                    className={cn("groups-browser-row", isActive && "is-active")}
                    tabIndex={0}
                    onDoubleClick={() => model.actions.openGroupDetail(group.id)}
                    onKeyDown={(event) => rowKeyDownHandler(event, () => model.actions.openGroupDetail(group.id))}
                  >
                    <TableCell className="groups-browser-group-column">
                      <div className="groups-browser-group-cell">
                        <p className="groups-browser-group-name">{group.name}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{group.source}</Badge>
                    </TableCell>
                    <TableCell>{group.member_count}</TableCell>
                    <TableCell>{group.rule_summary ?? "-"}</TableCell>
                    <TableCell>{groupRangeLabel(group)}</TableCell>
                    <TableCell className="groups-browser-action-column">
                      <Button
                        type="button"
                        size="sm"
                        variant={isActive ? "secondary" : "ghost"}
                        onClick={(event) => {
                          event.stopPropagation();
                          model.actions.openGroupDetail(group.id);
                        }}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
