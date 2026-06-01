/**
 * CALLING SPEC:
 * - Purpose: render the `EntriesPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/EntriesPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `EntriesPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { DeleteIconButton } from "../components/DeleteIconButton";
import { EntryEditorModal, type EntryEditorSubmitPayload } from "../components/EntryEditorModal";
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { useAuth } from "../features/auth";
import { EntriesFilterToolbar } from "../features/entries/EntriesFilterToolbar";
import {
  EMPTY_ENTRY_LIST_FILTERS,
  countActiveEntryListFilters,
  entryListDateRangeError,
  entryListFiltersFromSearchParams,
  entryListFiltersToSearchParams,
  type EntryListFilters
} from "../features/entries/entriesFilters";
import {
  createEntry,
  deleteEntry,
  getEntry,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listEntries,
  listFilterGroups,
  listGroups,
  listTags,
  listUsers,
  updateEntry
} from "../lib/api";
import { formatMinorCompact } from "../lib/format";
import { resolveTagColor } from "../lib/tagColors";
import { invalidateEntryReadModels } from "../lib/queryInvalidation";
import { queryKeys } from "../lib/queryKeys";
import { stringOptionsAsTags } from "../lib/workspaceFilters";

type EditorState = { mode: "create" } | { mode: "edit"; entryId: string } | null;
const ENTRY_FLOW_LABEL_MAX_LENGTH = 18;
const MISSING_ENTITY_LABEL = "(unspecified)";
const MISSING_ENTITY_MARKER_LABEL = "Missing entity";
const ENTRIES_PAGE_SIZE = 200;
const ENTRIES_LOAD_AHEAD_ROOT_MARGIN = "360px 0px";

function kindLabel(kind: string) {
  if (kind === "INCOME") return "Income";
  if (kind === "TRANSFER") return "Transfer";
  return "Expense";
}

function kindSymbol(kind: string) {
  if (kind === "INCOME") return "+";
  if (kind === "TRANSFER") return "~";
  return "-";
}

function kindToneClass(kind: string) {
  if (kind === "INCOME") return "entries-amount-marker-income";
  if (kind === "TRANSFER") return "entries-amount-marker-transfer";
  return "entries-amount-marker-expense";
}

function normalizedCurrencyCode(currencyCode: string) {
  return currencyCode.trim().toUpperCase() || "CAD";
}

function normalizedEntityLabel(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function compactEntityLabel(value: string, maxLength: number = ENTRY_FLOW_LABEL_MAX_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  const ellipsis = "...";
  const remainingLength = Math.max(maxLength - ellipsis.length, 2);
  const prefixLength = Math.ceil(remainingLength / 2);
  const suffixLength = Math.max(remainingLength - prefixLength, 1);
  return `${value.slice(0, prefixLength)}${ellipsis}${value.slice(-suffixLength)}`;
}

function entryFlowLabel(fromEntity: string | null, toEntity: string | null): { display: string; full: string } | null {
  const normalizedFrom = normalizedEntityLabel(fromEntity);
  const normalizedTo = normalizedEntityLabel(toEntity);
  if (!normalizedFrom && !normalizedTo) {
    return null;
  }

  const fullFrom = normalizedFrom ?? MISSING_ENTITY_LABEL;
  const fullTo = normalizedTo ?? MISSING_ENTITY_LABEL;
  return {
    display: `${compactEntityLabel(fullFrom)} -> ${compactEntityLabel(fullTo)}`,
    full: `${fullFrom} -> ${fullTo}`
  };
}

export function EntriesPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [filters, setFilters] = useState<EntryListFilters>(() => entryListFiltersFromSearchParams(searchParams));
  const [editorState, setEditorState] = useState<EditorState>(null);
  const dateRangeError = entryListDateRangeError(filters);
  const activeFilterCount = countActiveEntryListFilters(filters);

  const currenciesQuery = useQuery({ queryKey: queryKeys.properties.currencies, queryFn: listCurrencies });
  const runtimeSettingsQuery = useQuery({ queryKey: queryKeys.settings.runtime, queryFn: getRuntimeSettings });
  const entitiesQuery = useQuery({ queryKey: queryKeys.properties.entities, queryFn: listEntities });
  const usersQuery = useQuery({ queryKey: queryKeys.properties.users, queryFn: listUsers });
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list,
    queryFn: listGroups,
    enabled: editorState !== null
  });
  const filterGroupsQuery = useQuery({
    queryKey: queryKeys.filterGroups.list,
    queryFn: listFilterGroups
  });
  const tagsQuery = useQuery({ queryKey: queryKeys.properties.tags, queryFn: listTags });
  const entryListFilters = useMemo(
    () => ({
      kind: filters.kind || undefined,
      source: filters.source || undefined,
      filter_group_id: filters.filterGroupId || undefined,
      start_date: filters.startDate || undefined,
      end_date: filters.endDate || undefined,
      from_entity: filters.fromEntities.length > 0 ? filters.fromEntities : undefined,
      to_entity: filters.toEntities.length > 0 ? filters.toEntities : undefined
    }),
    [
      filters.endDate,
      filters.filterGroupId,
      filters.fromEntities,
      filters.kind,
      filters.source,
      filters.startDate,
      filters.toEntities
    ]
  );
  const entriesQuery = useInfiniteQuery({
    queryKey: queryKeys.entries.list(entryListFilters),
    initialPageParam: 0,
    enabled: dateRangeError === null,
    queryFn: ({ pageParam }) =>
      listEntries({
        ...entryListFilters,
        limit: ENTRIES_PAGE_SIZE,
        offset: pageParam
      }),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((total, page) => total + page.items.length, 0);
      return loadedCount < lastPage.total ? loadedCount : undefined;
    }
  });

  const editingEntryId = editorState?.mode === "edit" ? editorState.entryId : "";
  const editingEntryQuery = useQuery({
    queryKey: queryKeys.entries.detail(editingEntryId),
    queryFn: () => getEntry(editingEntryId),
    enabled: Boolean(editingEntryId)
  });

  const currentUserId = auth.session?.user.id ?? usersQuery.data?.find((user) => user.is_current_user)?.id ?? "";

  const createEntryMutation = useMutation({
    mutationFn: createEntry,
    onSuccess: () => {
      invalidateEntryReadModels(queryClient);
      setEditorState(null);
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ entryId, payload }: { entryId: string; payload: EntryEditorSubmitPayload }) => updateEntry(entryId, payload),
    onSuccess: (_, variables) => {
      invalidateEntryReadModels(queryClient, variables.entryId);
      setEditorState(null);
    }
  });

  const deleteEntryMutation = useMutation({
    mutationFn: deleteEntry,
    onSuccess: () => {
      invalidateEntryReadModels(queryClient);
    }
  });

  const loadedEntries = useMemo(
    () => entriesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [entriesQuery.data]
  );

  const totalEntries = entriesQuery.data?.pages[entriesQuery.data.pages.length - 1]?.total ?? 0;
  const loadedEntryCount = loadedEntries.length;

  const filterCurrencies = useMemo(() => {
    const codes = new Set((currenciesQuery.data ?? []).map((currency) => currency.code));
    loadedEntries.forEach((entry) => codes.add(entry.currency_code));
    return Array.from(codes).sort();
  }, [currenciesQuery.data, loadedEntries]);

  const currencyFilterOptions = useMemo(
    () =>
      filterCurrencies.map((currency, index) => ({
        id: -1 - index,
        name: normalizedCurrencyCode(currency),
        color: null
      })),
    [filterCurrencies]
  );

  const entityFilterOptions = useMemo(() => {
    const names = new Set<string>();
    (entitiesQuery.data ?? []).forEach((entity) => names.add(entity.name));
    loadedEntries.forEach((entry) => {
      const fromEntity = normalizedEntityLabel(entry.from_entity);
      const toEntity = normalizedEntityLabel(entry.to_entity);
      if (fromEntity) {
        names.add(fromEntity);
      }
      if (toEntity) {
        names.add(toEntity);
      }
    });
    return stringOptionsAsTags(Array.from(names).sort((left, right) => left.localeCompare(right)));
  }, [entitiesQuery.data, loadedEntries]);

  const filteredEntries = useMemo(() => {
    const selectedTagSet = new Set(filters.tags.map((tagName) => tagName.trim().toLowerCase()).filter(Boolean));
    const selectedCurrencySet = new Set(filters.currencies.map((currencyCode) => currencyCode.trim().toUpperCase()).filter(Boolean));
    return loadedEntries.filter((entry) => {
      if (selectedTagSet.size > 0) {
        const hasMatchingTag = entry.tags.some((tag) => selectedTagSet.has(tag.name.trim().toLowerCase()));
        if (!hasMatchingTag) {
          return false;
        }
      }

      if (selectedCurrencySet.size > 0) {
        const entryCurrencyCode = normalizedCurrencyCode(entry.currency_code);
        if (!selectedCurrencySet.has(entryCurrencyCode)) {
          return false;
        }
      }

      return true;
    });
  }, [filters.currencies, filters.tags, loadedEntries]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (
      sentinel === null ||
      !entriesQuery.hasNextPage ||
      entriesQuery.isFetchingNextPage ||
      typeof IntersectionObserver !== "function"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }
        void entriesQuery.fetchNextPage();
      },
      { rootMargin: ENTRIES_LOAD_AHEAD_ROOT_MARGIN }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [entriesQuery.fetchNextPage, entriesQuery.hasNextPage, entriesQuery.isFetchingNextPage]);

  useEffect(() => {
    setFilters((state) => {
      const next = entryListFiltersFromSearchParams(searchParams);
      if (
        state.startDate === next.startDate &&
        state.endDate === next.endDate &&
        state.filterGroupId === next.filterGroupId &&
        state.fromEntities.join("\u0000") === next.fromEntities.join("\u0000") &&
        state.toEntities.join("\u0000") === next.toEntities.join("\u0000")
      ) {
        return state;
      }
      return {
        ...state,
        startDate: next.startDate,
        endDate: next.endDate,
        filterGroupId: next.filterGroupId,
        fromEntities: next.fromEntities,
        toEntities: next.toEntities
      };
    });
  }, [searchParams]);

  function updateFilters(update: Partial<EntryListFilters>) {
    setFilters((state) => {
      const next = { ...state, ...update };
      const nextSearchParams = entryListFiltersToSearchParams(next, searchParams);
      setSearchParams(nextSearchParams);
      return next;
    });
  }

  function clearFilters() {
    setFilters({ ...EMPTY_ENTRY_LIST_FILTERS });
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("filter_group_id");
    nextSearchParams.delete("start_date");
    nextSearchParams.delete("end_date");
    nextSearchParams.delete("from_entity");
    nextSearchParams.delete("to_entity");
    setSearchParams(nextSearchParams);
  }

  function handleEditorSubmit(payload: EntryEditorSubmitPayload) {
    if (editorState?.mode === "edit") {
      updateEntryMutation.mutate({
        entryId: editorState.entryId,
        payload
      });
      return;
    }

    createEntryMutation.mutate({
      kind: payload.kind,
      occurred_at: payload.occurred_at,
      name: payload.name,
      amount_minor: payload.amount_minor,
      currency_code: payload.currency_code,
      from_entity_id: payload.from_entity_id || undefined,
      from_entity: payload.from_entity || undefined,
      to_entity_id: payload.to_entity_id || undefined,
      to_entity: payload.to_entity || undefined,
      owner_user_id: payload.owner_user_id,
      direct_group_id: payload.direct_group_id || undefined,
      direct_group_member_role: payload.direct_group_member_role ?? undefined,
      markdown_body: payload.markdown_body || undefined,
      tags: payload.tags
    });
  }

  const editorSaveError =
    editorState?.mode === "edit"
      ? (updateEntryMutation.error as Error | null)?.message ?? null
      : (createEntryMutation.error as Error | null)?.message ?? null;

  const editorLoadError = editingEntryQuery.isError ? (editingEntryQuery.error as Error).message : null;

  return (
    <div className="page">
      <WorkspaceSection contentClassName="workspace-table-body">
        <EntriesFilterToolbar
          filters={filters}
          tagOptions={tagsQuery.data ?? []}
          currencyOptions={currencyFilterOptions}
          entityOptions={entityFilterOptions}
          filterGroups={filterGroupsQuery.data ?? []}
          dateRangeError={dateRangeError}
          activeFilterCount={activeFilterCount}
          visibleEntryCount={filteredEntries.length}
          totalEntryCount={totalEntries}
          onFiltersChange={updateFilters}
          onClearFilters={clearFilters}
          onAddEntry={() => setEditorState({ mode: "create" })}
        />

        <div className="table-shell">
          {!dateRangeError && entriesQuery.isLoading ? <p>Loading entries...</p> : null}
          {!dateRangeError && entriesQuery.isError ? <p className="error">{(entriesQuery.error as Error).message}</p> : null}

          {!dateRangeError && entriesQuery.data ? (
            <>
              <Table className="entries-table table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="entries-date-column">Date</TableHead>
                    <TableHead className="entries-name-column">Name</TableHead>
                    <TableHead className="entries-amount-column">Amount</TableHead>
                    <TableHead className="entries-tags-column">Tags</TableHead>
                    <TableHead className="entries-actions-column">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => {
                    const flowLabel = entryFlowLabel(entry.from_entity, entry.to_entity);

                    return (
                      <TableRow
                        key={entry.id}
                        className="entries-table-row"
                        onDoubleClick={() => setEditorState({ mode: "edit", entryId: entry.id })}
                      >
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
                        <TableCell className="entries-tags-column">
                          {entry.tags.length > 0 ? (
                            <div className="entries-tag-list">
                              {entry.tags.map((tag) => {
                                const color = resolveTagColor(tag.name, tag.color);
                                return (
                                  <Badge key={tag.id} variant="outline" className="entries-tag-pill" style={{ borderColor: color }} title={tag.name}>
                                    <span className="entries-tag-pill-color" aria-hidden="true" style={{ backgroundColor: color }} />
                                    <span className="entries-tag-pill-label">{tag.name}</span>
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
                                deleteEntryMutation.mutate(entry.id);
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="entries-load-more-shell">
                <p className="entries-load-more-status">
                  {entriesQuery.hasNextPage
                    ? `Loaded ${loadedEntryCount} of ${totalEntries} entries. Scroll to load more.`
                    : totalEntries > 0
                      ? `Loaded all ${totalEntries} entries.`
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
                <div ref={loadMoreRef} className="entries-load-more-sentinel" aria-hidden="true" />
              </div>
            </>
          ) : null}
        </div>
      </WorkspaceSection>

      <EntryEditorModal
        isOpen={editorState !== null}
        mode={editorState?.mode ?? "create"}
        entry={editorState?.mode === "edit" ? editingEntryQuery.data ?? null : null}
        currencies={currenciesQuery.data ?? []}
        entities={entitiesQuery.data ?? []}
        groups={groupsQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        currentUserId={currentUserId}
        defaultCurrencyCode={(runtimeSettingsQuery.data?.default_currency_code ?? "CAD").toUpperCase()}
        entryTaggingModel={runtimeSettingsQuery.data?.entry_tagging_model}
        isSaving={createEntryMutation.isPending || updateEntryMutation.isPending}
        loadError={editorLoadError}
        saveError={editorSaveError}
        onClose={() => setEditorState(null)}
        onSubmit={handleEditorSubmit}
      />
    </div>
  );
}
