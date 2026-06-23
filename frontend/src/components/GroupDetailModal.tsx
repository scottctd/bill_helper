/**
 * CALLING SPEC:
 * - Purpose: render the `GroupDetailModal` React UI module.
 * - Inputs: callers that import `frontend/src/components/GroupDetailModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `GroupDetailModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { Link } from "react-router-dom";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";

import { DeleteIconButton } from "./DeleteIconButton";
import { StatBlock } from "./layout/StatBlock";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { formatMinor, formatMinorCompact } from "../lib/format";
import { GroupRuleEditorSection } from "../features/groups/GroupRuleEditorSection";
import type { GroupMemberRead, GroupRead, GroupSummary } from "../lib/types";

interface GroupDetailModalProps {
  isOpen: boolean;
  groupSummary: GroupSummary | null;
  groupDetail: GroupRead | null;
  isLoading: boolean;
  loadError?: string | null;
  deleteGroupError?: string | null;
  deleteMemberError?: string | null;
  isDeletingGroup: boolean;
  isDeletingMember: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAddMember: () => void;
  onOpenEntry: (entryId: string) => void;
  onRemoveMember: (membershipId: string) => void;
}

function groupRangeLabel(summary: GroupSummary): string {
  if (!summary.first_occurred_at || !summary.last_occurred_at) {
    return "No entries yet";
  }
  if (summary.first_occurred_at === summary.last_occurred_at) {
    return summary.first_occurred_at;
  }
  return `${summary.first_occurred_at} to ${summary.last_occurred_at}`;
}

function kindLabel(kind: GroupMemberRead["kind"]): string {
  if (kind === "INCOME") return "Income";
  if (kind === "TRANSFER") return "Transfer";
  return "Expense";
}

function kindSymbol(kind: GroupMemberRead["kind"]): string {
  if (kind === "INCOME") return "+";
  if (kind === "TRANSFER") return "~";
  return "-";
}

function kindToneClass(kind: GroupMemberRead["kind"]): string {
  if (kind === "INCOME") return "entries-amount-marker-income";
  if (kind === "TRANSFER") return "entries-amount-marker-transfer";
  return "entries-amount-marker-expense";
}

function renderMemberAmount(member: GroupMemberRead) {
  return (
    <span className="entries-amount-cell">
      <span className={`entries-amount-marker ${kindToneClass(member.kind)}`} aria-hidden="true">
        {kindSymbol(member.kind)}
      </span>
      <span className="sr-only">{kindLabel(member.kind)}</span>
      <span className="entries-amount-value">{formatMinorCompact(member.amount_minor)}</span>
      <span className="entries-amount-currency">{member.currency_code.trim().toUpperCase() || "CAD"}</span>
    </span>
  );
}

interface GroupStat {
  label: string;
  value: string;
  detail: string;
}

function formatCurrencyBucketSummary(buckets: Map<string, number>): { value: string; detail: string } {
  if (buckets.size === 0) {
    return { value: "-", detail: "No entry amounts yet" };
  }

  const formatted = Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, amountMinor]) => formatMinor(amountMinor, currencyCode));
  if (formatted.length === 1) {
    return { value: formatted[0], detail: "From listed members" };
  }
  return { value: "Mixed currencies", detail: formatted.join(" · ") };
}

function amountStatLabel(members: GroupMemberRead[], variant: "total" | "average"): string {
  const kinds = Array.from(new Set(members.map((member) => member.kind)));
  if (kinds.length !== 1) {
    return variant === "total" ? "Total" : "Average";
  }

  if (kinds[0] === "EXPENSE") {
    return variant === "total" ? "Total cost" : "Average cost";
  }
  if (kinds[0] === "INCOME") {
    return variant === "total" ? "Total income" : "Average income";
  }
  return variant === "total" ? "Total moved" : "Average transfer";
}

function buildGroupStats(summary: GroupSummary, members: GroupMemberRead[]): GroupStat[] {
  const totalBuckets = new Map<string, number>();
  const averageBuckets = new Map<string, number>();

  for (const member of members) {
    totalBuckets.set(member.currency_code, (totalBuckets.get(member.currency_code) ?? 0) + member.amount_minor);
  }

  for (const [currencyCode, totalMinor] of totalBuckets.entries()) {
    const count = members.filter((member) => member.currency_code === currencyCode).length;
    averageBuckets.set(currencyCode, Math.round(totalMinor / count));
  }

  const totalSummary = formatCurrencyBucketSummary(totalBuckets);
  const averageSummary = formatCurrencyBucketSummary(averageBuckets);

  const latestMember = [...members].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))[0];

  return [
    {
      label: amountStatLabel(members, "total"),
      value: totalSummary.value,
      detail: totalSummary.detail
    },
    {
      label: amountStatLabel(members, "average"),
      value: averageSummary.value,
      detail: averageSummary.detail
    },
    {
      label: "Latest",
      value: latestMember ? formatMinor(latestMember.amount_minor, latestMember.currency_code) : "-",
      detail: latestMember ? latestMember.occurred_at : "No amounts yet"
    },
    {
      label: "Coverage",
      value: summary.first_occurred_at && summary.last_occurred_at ? groupRangeLabel(summary) : "-",
      detail:
        summary.first_occurred_at && summary.last_occurred_at
          ? summary.first_occurred_at === summary.last_occurred_at
            ? "Single date"
            : "First to last member"
          : "No dated members"
    }
  ];
}

function sortMembers(members: GroupMemberRead[]): GroupMemberRead[] {
  return [...members].sort((left, right) => {
    const dateCompare = right.occurred_at.localeCompare(left.occurred_at);
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return left.entry_name.localeCompare(right.entry_name);
  });
}

function memberRowKeyDownHandler(event: React.KeyboardEvent<HTMLTableRowElement>, onOpen: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onOpen();
  }
}

function overrideLabel(override: GroupMemberRead["override"]): string {
  if (override === "include") return "Pinned";
  if (override === "exclude") return "Excluded";
  return "-";
}

function sourceBadgeVariant(source: GroupSummary["source"]): "secondary" | "outline" {
  return source === "rule" ? "outline" : "secondary";
}

export function GroupDetailModal({
  isOpen,
  groupSummary,
  groupDetail,
  isLoading,
  loadError = null,
  deleteGroupError = null,
  deleteMemberError = null,
  isDeletingGroup,
  isDeletingMember,
  onClose,
  onRename,
  onDelete,
  onAddMember,
  onOpenEntry,
  onRemoveMember
}: GroupDetailModalProps) {
  const members = sortMembers(groupDetail?.members ?? []);
  const stats = groupSummary ? buildGroupStats(groupSummary, members) : [];
  const isManual = groupSummary?.source === "manual";
  const isRule = groupSummary?.source === "rule";
  const memberCount = groupSummary?.member_count ?? members.length;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="groups-detail-modal">
        <div className="groups-detail-modal-shell">
          <DialogHeader className="groups-detail-modal-header">
            <div className="groups-detail-modal-header-main">
              <div className="groups-detail-modal-header-copy">
                <div className="groups-detail-modal-title-row">
                  <DialogTitle>{groupSummary ? groupSummary.name : "Group detail"}</DialogTitle>
                  {groupSummary ? (
                    <Badge variant={sourceBadgeVariant(groupSummary.source)}>{groupSummary.source}</Badge>
                  ) : null}
                </div>
                <DialogDescription className="groups-detail-modal-description">
                  {groupSummary
                    ? isManual
                      ? "Direct entry membership."
                      : "Rule matches with optional pin or exclude overrides."
                    : "Open a group from the table."}
                </DialogDescription>
                {groupSummary ? (
                  <div className="groups-detail-meta-chips" aria-label="Group summary">
                    <span className="groups-detail-meta-chip">
                      {memberCount === 1 ? "1 member" : `${memberCount} members`}
                    </span>
                    <span className="groups-detail-meta-chip">{groupRangeLabel(groupSummary)}</span>
                    {isRule && groupSummary.rule_summary ? (
                      <span className="groups-detail-meta-chip groups-detail-meta-chip-rule">{groupSummary.rule_summary}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {groupSummary ? (
                <div className="groups-detail-modal-actions">
                  <div className="groups-detail-modal-actions-primary">
                    <Button type="button" size="sm" onClick={onAddMember}>
                      <Plus className="mr-2 h-4 w-4" />
                      {isManual ? "Add member" : "Pin or exclude"}
                    </Button>
                    <Button asChild type="button" size="sm" variant="outline">
                      <Link to={`/entries?group_id=${groupSummary.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        View entries
                      </Link>
                    </Button>
                  </div>
                  <div className="groups-detail-modal-actions-secondary">
                    <Button type="button" size="sm" variant="outline" onClick={onRename}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Rename
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={onDelete} disabled={isDeletingGroup}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {groupSummary && stats.length > 0 ? (
              <div className="groups-detail-stats-block">
                <h3 className="groups-detail-stats-heading">Statistics</h3>
                <div className="groups-detail-stats-grid" aria-label="Group statistics">
                  {stats.map((stat) => (
                    <StatBlock key={stat.label} label={stat.label} value={stat.value} detail={stat.detail} />
                  ))}
                </div>
              </div>
            ) : null}
          </DialogHeader>

          <div className="groups-detail-modal-body">
            {deleteGroupError ? <p className="error">{deleteGroupError}</p> : null}

            {!groupSummary ? (
              <div className="groups-empty-state">
                <p className="groups-empty-title">No group selected</p>
                <p className="muted">Choose a group from the table first.</p>
              </div>
            ) : (
              <>
                <section className="groups-detail-panel">
                  <div className="groups-detail-panel-header">
                    <h3>{isManual ? "Members" : "Effective members"}</h3>
                    <p className="groups-detail-panel-count">
                      {members.length === 0 ? "No members loaded" : `${members.length} shown`}
                    </p>
                  </div>

                  <div className="groups-detail-panel-body">
                    {deleteMemberError ? <p className="error">{deleteMemberError}</p> : null}
                    {isLoading ? <p className="muted">Loading members...</p> : null}
                    {loadError ? <p className="error">{loadError}</p> : null}
                    {!isLoading && !loadError && !groupDetail ? (
                      <p className="muted">Group detail is not loaded yet.</p>
                    ) : null}
                    {!isLoading && !loadError && groupDetail && members.length === 0 ? (
                      <div className="groups-empty-state groups-detail-members-empty">
                        <p className="groups-empty-title">No members yet</p>
                        <p className="muted">
                          {isManual ? "Add entries to populate this group." : "No entries match this rule yet."}
                        </p>
                        <Button type="button" size="sm" variant="outline" onClick={onAddMember}>
                          {isManual ? "Add first member" : "Add override"}
                        </Button>
                      </div>
                    ) : null}
                    {!isLoading && !loadError && members.length > 0 ? (
                      <div className="groups-detail-members-table-shell">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="groups-detail-date-column">Date</TableHead>
                              <TableHead>Entry</TableHead>
                              <TableHead className="groups-detail-amount-column">Amount</TableHead>
                              {isRule ? <TableHead>Override</TableHead> : null}
                              <TableHead className="icon-action-column">
                                <span className="sr-only">Actions</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {members.map((member) => (
                              <TableRow
                                key={member.id}
                                className="groups-detail-member-row"
                                tabIndex={0}
                                onClick={() => onOpenEntry(member.entry_id)}
                                onKeyDown={(event) => memberRowKeyDownHandler(event, () => onOpenEntry(member.entry_id))}
                              >
                                <TableCell className="groups-detail-date-column">
                                  <span className="groups-detail-member-date">{member.occurred_at}</span>
                                </TableCell>
                                <TableCell>
                                  <div className="groups-detail-member-entry">
                                    <p className="groups-detail-member-name">{member.entry_name}</p>
                                    <p className="groups-detail-member-kind">{kindLabel(member.kind)}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="groups-detail-amount-column">{renderMemberAmount(member)}</TableCell>
                                {isRule ? (
                                  <TableCell>
                                    {member.override ? (
                                      <Badge variant="secondary">{overrideLabel(member.override)}</Badge>
                                    ) : (
                                      <span className="text-muted-foreground">Rule match</span>
                                    )}
                                  </TableCell>
                                ) : null}
                                <TableCell className="icon-action-column">
                                  <DeleteIconButton
                                    label={`Remove member ${member.entry_name}`}
                                    disabled={isDeletingMember}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onRemoveMember(member.id);
                                    }}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : null}
                  </div>
                </section>

                {isRule && groupDetail ? <GroupRuleEditorSection group={groupDetail} /> : null}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
