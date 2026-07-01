/**
 * CALLING SPEC:
 * - Purpose: own queries, mutations, filters, and handlers for the entries page.
 * - Inputs: auth session, URL search params, and TanStack Query client.
 * - Outputs: entries list state, editor state, filter options, and action handlers.
 * - Side effects: remote data fetching, cache invalidation, and URL param updates.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import type { EntryEditorSubmitPayload } from "../../components/EntryEditorModal";
import { useAuth } from "../auth";
import {
  createEntry,
  deleteEntry,
  getEntry,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listEntries,
  listGroups,
  listTags,
  listTaxonomyTerms,
  listUsers,
  updateEntry
} from "../../lib/api";
import {
  ENTRY_CATEGORY_TAXONOMY_KEY,
  buildCategoryFilterOptions,
  categoryPathLeaf
} from "../../lib/catalogs";
import { entryCategoryColor } from "../../lib/entryClassificationColors";
import { invalidateEntryReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import { listOrEmpty } from "../../lib/collections";
import { stringOptionsAsTags } from "../../lib/workspaceFilters";
import {
  EMPTY_ENTRY_LIST_FILTERS,
  countActiveEntryListFilters,
  entryListDateRangeError,
  entryListFiltersFromSearchParams,
  entryListFiltersToSearchParams,
  type EntryListFilters
} from "./entriesFilters";
import { normalizedCurrencyCode } from "./entriesDisplayHelpers";
import { getApiErrorMessage } from "../../lib/api/core";

type EditorState = { mode: "create" } | { mode: "edit"; entryId: string } | null;

const ENTRIES_PAGE_SIZE = 200;
const ENTRIES_LOAD_AHEAD_ROOT_MARGIN = "360px 0px";

export function useEntriesPageModel() {
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
  const tagsQuery = useQuery({ queryKey: queryKeys.properties.tags, queryFn: listTags });
  const categoryTermsQuery = useQuery({
    queryKey: queryKeys.properties.taxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY),
    queryFn: () => listTaxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY)
  });

  const entryListFilters = useMemo(
    () => ({
      kind: filters.kind || undefined,
      source: filters.source || undefined,
      category: filters.category || undefined,
      group_id: filters.groupId || undefined,
      start_date: filters.startDate || undefined,
      end_date: filters.endDate || undefined,
      from_entity: filters.fromEntities.length > 0 ? filters.fromEntities : undefined,
      to_entity: filters.toEntities.length > 0 ? filters.toEntities : undefined
    }),
    [
      filters.endDate,
      filters.category,
      filters.groupId,
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
        color: null,
        entry_count: 0
      })),
    [filterCurrencies]
  );

  const entityFilterOptions = useMemo(() => {
    const names = new Set<string>();
    (entitiesQuery.data ?? []).forEach((entity) => names.add(entity.name));
    loadedEntries.forEach((entry) => {
      const fromEntity = entry.from_entity?.trim();
      const toEntity = entry.to_entity?.trim();
      if (fromEntity) {
        names.add(fromEntity);
      }
      if (toEntity) {
        names.add(toEntity);
      }
    });
    return stringOptionsAsTags(Array.from(names).sort((left, right) => left.localeCompare(right)));
  }, [entitiesQuery.data, loadedEntries]);

  const categoryFilterOptions = useMemo(
    () =>
      buildCategoryFilterOptions(categoryTermsQuery.data).map((option) => ({
        value: option.value,
        label: option.label,
        color: entryCategoryColor(option.path)
      })),
    [categoryTermsQuery.data]
  );

  const filteredEntries = useMemo(() => {
    const selectedTagSet = new Set(filters.tags.map((tagName) => tagName.trim().toLowerCase()).filter(Boolean));
    const selectedCurrencySet = new Set(filters.currencies.map((currencyCode) => currencyCode.trim().toUpperCase()).filter(Boolean));
    return loadedEntries.filter((entry) => {
      if (selectedTagSet.size > 0) {
        const hasMatchingTag = listOrEmpty(entry.tags).some((tag) => selectedTagSet.has(tag.name.trim().toLowerCase()));
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
        state.category === next.category &&
        state.groupId === next.groupId &&
        state.fromEntities.join("\u0000") === next.fromEntities.join("\u0000") &&
        state.toEntities.join("\u0000") === next.toEntities.join("\u0000")
      ) {
        return state;
      }
      return {
        ...state,
        startDate: next.startDate,
        endDate: next.endDate,
        category: next.category,
        groupId: next.groupId,
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
    nextSearchParams.delete("group_id");
    nextSearchParams.delete("category");
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
      group_ids: payload.group_ids.length > 0 ? payload.group_ids : undefined,
      markdown_body: payload.markdown_body || undefined,
      tags: payload.tags
    });
  }

  const editorSaveError =
    editorState?.mode === "edit"
      ? updateEntryMutation.isError
        ? getApiErrorMessage(updateEntryMutation.error)
        : null
      : createEntryMutation.isError
        ? getApiErrorMessage(createEntryMutation.error)
        : null;

  const editorLoadError = editingEntryQuery.isError ? getApiErrorMessage(editingEntryQuery.error) : null;

  return {
    filters,
    dateRangeError,
    activeFilterCount,
    filteredEntries,
    totalEntries,
    loadedEntryCount,
    loadMoreRef,
    editorState,
    setEditorState,
    currentUserId,
    currencyFilterOptions,
    entityFilterOptions,
    categoryFilterOptions,
    editorSaveError,
    editorLoadError,
    queries: {
      entriesQuery,
      currenciesQuery,
      entitiesQuery,
      groupsQuery,
      tagsQuery,
      categoryTermsQuery,
      runtimeSettingsQuery,
      editingEntryQuery
    },
    mutations: {
      createEntryMutation,
      updateEntryMutation,
      deleteEntryMutation
    },
    actions: {
      updateFilters,
      clearFilters,
      handleEditorSubmit
    }
  };
}

export type EntriesPageModel = ReturnType<typeof useEntriesPageModel>;
