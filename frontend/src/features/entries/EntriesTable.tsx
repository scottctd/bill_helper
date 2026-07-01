/**
 * CALLING SPEC:
 * - Purpose: render the entries table, load-more footer, and entry color pills.
 * - Inputs: filtered entries, query status, and delete/edit callbacks from the page model.
 * - Outputs: table UI for the entries workspace.
 * - Side effects: user event wiring for row edit and delete actions.
 */
import { DeleteIconButton } from "../../components/DeleteIconButton";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { categoryPathLeaf, formatEntryLifecycle } from "../../lib/catalogs";
import { formatMinorCompact, kindLabel, kindSymbol } from "../../lib/format";
import { entryCategoryColor, entryLifecycleColor, formatEntryCategoryLabel } from "../../lib/entryClassificationColors";
import { resolveTagColor } from "../../lib/tagColors";
import type { Entry } from "../../lib/types";
import { listOrEmpty, nullishToNull } from "../../lib/collections";
import { getApiErrorMessage } from "../../lib/api/core";
import type { EntriesPageModel } from "./useEntriesPageModel";
import {
  MISSING_ENTITY_MARKER_LABEL,
  entryFlowLabel,
  kindToneClass,
  normalizedCurrencyCode
} from "./entriesDisplayHelpers";

interface EntriesTableProps {
  model: EntriesPageModel;
}

export function EntriesTable({ model }: EntriesTableProps) {
  const { entriesQuery } = model.queries;
  const { deleteEntryMutation } = model.mutations;

  return (
    <div className="table-shell">
      {!model.dateRangeError && entriesQuery.isLoading ? <p>Loading entries...</p> : null}
      {!model.dateRangeError && entriesQuery.isError ? (
        <p className="error">{getApiErrorMessage(entriesQuery.error)}</p>
      ) : null}

      {!model.dateRangeError && entriesQuery.data ? (
        <>
          <Table className="entries-table table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="entries-date-column">Date</TableHead>
                <TableHead className="entries-name-column">Name</TableHead>
                <TableHead className="entries-amount-column">Amount</TableHead>
                <TableHead className="entries-category-column">Category</TableHead>
                <TableHead className="entries-lifecycle-column">Lifecycle</TableHead>
                <TableHead className="entries-tags-column">Tags</TableHead>
                <TableHead className="entries-actions-column">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.filteredEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => model.setEditorState({ mode: "edit", entryId: entry.id })}
                  onDelete={() => deleteEntryMutation.mutate(entry.id)}
                />
              ))}
            </TableBody>
          </Table>

          <div className="entries-load-more-shell">
            <p className="entries-load-more-status">
              {entriesQuery.hasNextPage
                ? `Loaded ${model.loadedEntryCount} of ${model.totalEntries} entries. Scroll to load more.`
                : model.totalEntries > 0
                  ? `Loaded all ${model.totalEntries} entries.`
                  : "No entries found."}
            </p>
            {entriesQuery.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void entriesQuery.fetchNextPage()}
                disabled={entriesQuery.isFetchingNextPage}
                aria-label="Load more entries"
              >
                {entriesQuery.isFetchingNextPage ? "Loading more..." : "Load more"}
              </Button>
            ) : null}
            <div ref={model.loadMoreRef} className="entries-load-more-sentinel" aria-hidden="true" />
          </div>
        </>
      ) : null}
    </div>
  );
}

function EntryRow({
  entry,
  onEdit,
  onDelete
}: {
  entry: Entry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const flowLabel = entryFlowLabel(nullishToNull(entry.from_entity), nullishToNull(entry.to_entity));

  return (
    <TableRow className="entries-table-row" onDoubleClick={onEdit}>
      <TableCell className="entries-date-column">{entry.occurred_at}</TableCell>
      <TableCell className="entries-name-column entries-name-cell">
        <div className="entries-name-stack">
          <span className="entries-name-title">{entry.name}</span>
          {flowLabel ? (
            <span className="entries-name-flow" title={flowLabel.full}>
              {flowLabel.display}
            </span>
          ) : null}
          {entry.from_entity_missing || entry.to_entity_missing ? (
            <span>
              <Badge variant="outline">{MISSING_ENTITY_MARKER_LABEL}</Badge>
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="entries-amount-column">
        <span className="entries-amount-cell">
          <span className={`entries-amount-marker ${kindToneClass(entry.kind)}`} aria-hidden="true">
            {kindSymbol(entry.kind)}
          </span>
          <span className="sr-only">{kindLabel(entry.kind)}</span>
          <span className="entries-amount-value">{formatMinorCompact(entry.amount_minor)}</span>
          <span className="entries-amount-currency">{normalizedCurrencyCode(entry.currency_code)}</span>
        </span>
      </TableCell>
      <TableCell className="entries-category-column">
        <EntryColorPill
          label={formatEntryCategoryLabel(categoryPathLeaf(entry.category) ?? "Uncategorized")}
          color={entryCategoryColor(entry.category)}
          title={formatEntryCategoryLabel(entry.category ?? "Uncategorized")}
        />
      </TableCell>
      <TableCell className="entries-lifecycle-column">
        <EntryColorPill
          label={entry.lifecycle ? formatEntryLifecycle(entry.lifecycle) : "none"}
          color={entryLifecycleColor(entry.lifecycle)}
        />
      </TableCell>
      <TableCell className="entries-tags-column">
        {listOrEmpty(entry.tags).length > 0 ? (
          <div className="entries-tag-list">
            {listOrEmpty(entry.tags).map((tag) => {
              const color = resolveTagColor(tag.name, tag.color);
              return (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="entries-color-pill"
                  style={{ borderColor: color }}
                  title={tag.name}
                >
                  <span className="entries-color-pill-dot" aria-hidden="true" style={{ backgroundColor: color }} />
                  <span className="entries-color-pill-label">{tag.name}</span>
                </Badge>
              );
            })}
          </div>
        ) : (
          <span className="entries-tag-empty">-</span>
        )}
      </TableCell>
      <TableCell className="entries-actions-column">
        <div className="table-actions">
          <DeleteIconButton
            label={`Delete entry ${entry.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function EntryColorPill({ label, color, title = label }: { label: string; color: string; title?: string }) {
  return (
    <Badge variant="outline" className="entries-color-pill" style={{ borderColor: color }} title={title}>
      <span className="entries-color-pill-dot" aria-hidden="true" style={{ backgroundColor: color }} />
      <span className="entries-color-pill-label">{label}</span>
    </Badge>
  );
}
