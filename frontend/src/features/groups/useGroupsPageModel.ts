/**
 * CALLING SPEC:
 * - Purpose: own queries, mutations, filters, and modal state for the groups page.
 * - Inputs: auth session and TanStack Query client.
 * - Outputs: group list state, detail modal state, entry editor wiring, and action handlers.
 * - Side effects: remote data fetching, cache invalidation, and optimistic list updates.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { EntryEditorSubmitPayload } from "../../components/EntryEditorModal";
import { buildDefaultRule } from "../groupRules/groupRuleUtils";
import { useAuth } from "../auth";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  deleteGroupMember,
  getEntry,
  getGroup,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listEntries,
  listGroups,
  listTags,
  listTaxonomyTerms,
  listUsers,
  updateEntry,
  updateGroup
} from "../../lib/api";
import { ENTRY_CATEGORY_TAXONOMY_KEY, includesFilter } from "../../lib/catalogs";
import { invalidateEntryReadModels, invalidateGroupReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import type { GroupMemberCreatePayload, GroupSummary } from "../../lib/types";
import { matchesSelectedValues, stringOptionsAsTags } from "../../lib/workspaceFilters";

const ENTRY_PICKER_FILTERS = {
  limit: 200,
  offset: 0
} as const;

export function useGroupsPageModel() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupSources, setSelectedGroupSources] = useState<string[]>([]);
  const deferredGroupSearch = useDeferredValue(groupSearch);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isRenameGroupOpen, setIsRenameGroupOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState("");

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list,
    queryFn: listGroups
  });

  const entryPickerQuery = useQuery({
    queryKey: queryKeys.entries.list(ENTRY_PICKER_FILTERS),
    queryFn: () => listEntries(ENTRY_PICKER_FILTERS)
  });

  const groupDetailQuery = useQuery({
    queryKey: queryKeys.groups.detail(selectedGroupId),
    queryFn: () => getGroup(selectedGroupId),
    enabled: isDetailOpen && Boolean(selectedGroupId)
  });

  const currenciesQuery = useQuery({
    queryKey: queryKeys.properties.currencies,
    queryFn: listCurrencies,
    enabled: Boolean(editingEntryId)
  });

  const runtimeSettingsQuery = useQuery({
    queryKey: queryKeys.settings.runtime,
    queryFn: getRuntimeSettings,
    enabled: Boolean(editingEntryId)
  });

  const entitiesQuery = useQuery({
    queryKey: queryKeys.properties.entities,
    queryFn: listEntities,
    enabled: Boolean(editingEntryId)
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.properties.users,
    queryFn: listUsers,
    enabled: Boolean(editingEntryId)
  });

  const tagsQuery = useQuery({
    queryKey: queryKeys.properties.tags,
    queryFn: listTags,
    enabled: Boolean(editingEntryId)
  });

  const categoryTermsQuery = useQuery({
    queryKey: queryKeys.properties.taxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY),
    queryFn: () => listTaxonomyTerms(ENTRY_CATEGORY_TAXONOMY_KEY),
    enabled: Boolean(editingEntryId)
  });

  const editingEntryQuery = useQuery({
    queryKey: queryKeys.entries.detail(editingEntryId),
    queryFn: () => getEntry(editingEntryId),
    enabled: Boolean(editingEntryId)
  });

  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }
    const selectionStillExists = (groupsQuery.data ?? []).some((group) => group.id === selectedGroupId);
    if (!selectionStillExists) {
      setSelectedGroupId("");
      setIsDetailOpen(false);
      setIsRenameGroupOpen(false);
      setIsAddMemberOpen(false);
    }
  }, [groupsQuery.data, selectedGroupId]);

  const createGroupMutation = useMutation({
    mutationFn: (payload: { name: string; source: GroupSummary["source"] }) =>
      createGroup({
        name: payload.name,
        source: payload.source,
        ...(payload.source === "rule" ? { rule: buildDefaultRule() } : {})
      }),
    onSuccess: (group) => {
      queryClient.setQueryData<GroupSummary[]>(queryKeys.groups.list, (current) => {
        const existing = current ?? [];
        return [group, ...existing.filter((candidate) => candidate.id !== group.id)];
      });
      invalidateGroupReadModels(queryClient);
      setSelectedGroupId(group.id);
      setIsCreateGroupOpen(false);
      setIsDetailOpen(true);
    }
  });

  const renameGroupMutation = useMutation({
    mutationFn: (payload: { name: string }) => updateGroup(selectedGroupId, payload),
    onSuccess: (group) => {
      queryClient.setQueryData<GroupSummary[]>(queryKeys.groups.list, (current) => {
        return (current ?? []).map((candidate) => (candidate.id === group.id ? group : candidate));
      });
      invalidateGroupReadModels(queryClient, undefined, selectedGroupId);
      setIsRenameGroupOpen(false);
    }
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: string) => deleteGroup(groupId),
    onSuccess: (_result, groupId) => {
      queryClient.setQueryData<GroupSummary[]>(queryKeys.groups.list, (current) => {
        return (current ?? []).filter((candidate) => candidate.id !== groupId);
      });
      invalidateGroupReadModels(queryClient);
      setSelectedGroupId("");
      setIsDetailOpen(false);
      setIsRenameGroupOpen(false);
      setIsAddMemberOpen(false);
    }
  });

  const addGroupMemberMutation = useMutation({
    mutationFn: (payload: GroupMemberCreatePayload) => addGroupMember(selectedGroupId, payload),
    onSuccess: () => {
      invalidateGroupReadModels(queryClient, undefined, selectedGroupId);
      setIsAddMemberOpen(false);
    }
  });

  const deleteGroupMemberMutation = useMutation({
    mutationFn: (membershipId: string) => deleteGroupMember(selectedGroupId, membershipId),
    onSuccess: () => {
      invalidateGroupReadModels(queryClient, undefined, selectedGroupId);
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ entryId, payload }: { entryId: string; payload: EntryEditorSubmitPayload }) => updateEntry(entryId, payload),
    onSuccess: (_result, variables) => {
      invalidateEntryReadModels(queryClient, variables.entryId);
      setEditingEntryId("");
    }
  });

  const groupSourceFilterOptions = useMemo(
    () =>
      stringOptionsAsTags(
        Array.from(new Set((groupsQuery.data ?? []).map((group) => group.source))).sort((left, right) =>
          left.localeCompare(right)
        )
      ),
    [groupsQuery.data]
  );

  const filteredGroups = useMemo(() => {
    return (groupsQuery.data ?? []).filter((group) => {
      if (!includesFilter(group.name, deferredGroupSearch) && !includesFilter(group.id, deferredGroupSearch)) {
        return false;
      }
      return matchesSelectedValues(group.source, selectedGroupSources);
    });
  }, [deferredGroupSearch, groupsQuery.data, selectedGroupSources]);

  const selectedGroupSummary = useMemo(
    () => groupsQuery.data?.find((group) => group.id === selectedGroupId) ?? null,
    [groupsQuery.data, selectedGroupId]
  );

  const currentUserId = auth.session?.user.id ?? usersQuery.data?.find((user) => user.is_current_user)?.id ?? "";

  const memberEntryIds = useMemo(() => {
    return new Set((groupDetailQuery.data?.members ?? []).map((member) => member.entry_id));
  }, [groupDetailQuery.data]);

  const entryOptions = useMemo(() => {
    return (entryPickerQuery.data?.items ?? [])
      .filter((entry) => !memberEntryIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        label: `${entry.occurred_at} · ${entry.name}`
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [entryPickerQuery.data, memberEntryIds]);

  function openGroupDetail(groupId: string) {
    setSelectedGroupId(groupId);
    setIsRenameGroupOpen(false);
    setIsAddMemberOpen(false);
    setIsDetailOpen(true);
  }

  function handleEntryEditorSubmit(payload: EntryEditorSubmitPayload) {
    if (!editingEntryId) {
      return;
    }
    updateEntryMutation.mutate({ entryId: editingEntryId, payload });
  }

  return {
    groupSearch,
    setGroupSearch,
    selectedGroupSources,
    setSelectedGroupSources,
    selectedGroupId,
    isDetailOpen,
    setIsDetailOpen,
    isCreateGroupOpen,
    setIsCreateGroupOpen,
    isRenameGroupOpen,
    setIsRenameGroupOpen,
    isAddMemberOpen,
    setIsAddMemberOpen,
    editingEntryId,
    setEditingEntryId,
    groupSourceFilterOptions,
    filteredGroups,
    selectedGroupSummary,
    currentUserId,
    entryOptions,
    queries: {
      groupsQuery,
      groupDetailQuery,
      editingEntryQuery,
      currenciesQuery,
      runtimeSettingsQuery,
      entitiesQuery,
      tagsQuery,
      categoryTermsQuery
    },
    mutations: {
      createGroupMutation,
      renameGroupMutation,
      deleteGroupMutation,
      addGroupMemberMutation,
      deleteGroupMemberMutation,
      updateEntryMutation
    },
    actions: {
      openGroupDetail,
      handleEntryEditorSubmit
    }
  };
}

export type GroupsPageModel = ReturnType<typeof useGroupsPageModel>;
