/**
 * CALLING SPEC:
 * - Purpose: own entry detail queries, editor state, and update mutation for EntryDetailPage.
 * - Inputs: route entry id, auth session, and TanStack Query client.
 * - Outputs: loaded entry, editor catalog data, and save handlers.
 * - Side effects: remote data fetching and cache invalidation on update.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { EntryEditorSubmitPayload } from "../../components/EntryEditorModal";
import { useAuth } from "../auth";
import {
  getEntry,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listGroups,
  listTags,
  listTaxonomyTerms,
  listUsers,
  updateEntry
} from "../../lib/api";
import { ENTRY_CATEGORY_TAXONOMY_KEY } from "../../lib/catalogs";
import { kindLabel, kindSymbol, formatMinor } from "../../lib/format";
import { invalidateEntryReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";

export function useEntryDetailPageModel(entryId: string | undefined) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const entryQuery = useQuery({
    queryKey: queryKeys.entries.detail(entryId ?? ""),
    queryFn: () => getEntry(entryId!),
    enabled: Boolean(entryId)
  });

  const currenciesQuery = useQuery({ queryKey: queryKeys.properties.currencies, queryFn: listCurrencies });
  const entitiesQuery = useQuery({ queryKey: queryKeys.properties.entities, queryFn: listEntities });
  const usersQuery = useQuery({ queryKey: queryKeys.properties.users, queryFn: listUsers });
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list,
    queryFn: listGroups,
    enabled: isEditorOpen
  });
  const tagsQuery = useQuery({ queryKey: queryKeys.properties.tags, queryFn: listTags });
  const categoryTermsQuery = useQuery({
    queryKey: queryKeys.properties.taxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY),
    queryFn: () => listTaxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY)
  });
  const runtimeSettingsQuery = useQuery({ queryKey: queryKeys.settings.runtime, queryFn: getRuntimeSettings });

  const currentUserId = auth.session?.user.id ?? usersQuery.data?.find((user) => user.is_current_user)?.id ?? "";

  const updateMutation = useMutation({
    mutationFn: (payload: EntryEditorSubmitPayload) => updateEntry(entryId!, payload),
    onSuccess: () => {
      if (!entryId) {
        return;
      }
      invalidateEntryReadModels(queryClient, entryId);
      setIsEditorOpen(false);
    }
  });

  const entry = entryQuery.data;
  const entrySummary =
    entry != null
      ? `${entry.occurred_at} | ${kindLabel(entry.kind)} ${kindSymbol(entry.kind)} | ${formatMinor(entry.amount_minor, entry.currency_code)}`
      : "";

  return {
    isEditorOpen,
    setIsEditorOpen,
    entrySummary,
    currentUserId,
    queries: {
      entryQuery,
      currenciesQuery,
      entitiesQuery,
      groupsQuery,
      tagsQuery,
      categoryTermsQuery,
      runtimeSettingsQuery
    },
    mutations: {
      updateMutation
    }
  };
}

export type EntryDetailPageModel = ReturnType<typeof useEntryDetailPageModel>;
