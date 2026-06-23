/**
 * CALLING SPEC:
 * - Purpose: provide the `usePropertiesPageModel` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/properties/usePropertiesPageModel.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `usePropertiesPageModel`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  createTag,
  createTaxonomyTerm,
  deleteTag,
  deleteTaxonomyTerm,
  updateTag,
  updateTaxonomyTerm
} from "../../lib/api";
import {
  ENTITY_CATEGORY_TAXONOMY_KEY,
  ENTRY_CATEGORY_TAXONOMY_KEY,
  TAG_TYPE_TAXONOMY_KEY,
  taxonomyTermNames,
  uniqueOptionValues
} from "../../lib/catalogs";
import { invalidateTagReadModels, invalidateTaxonomyReadModels } from "../../lib/queryInvalidation";
import type { Tag, TaxonomyTerm } from "../../lib/types";
import { stringOptionsAsTags, UNCATEGORIZED_FILTER_LABEL } from "../../lib/workspaceFilters";
import { usePropertiesFilteredData } from "./usePropertiesFilteredData";
import { usePropertiesFormState } from "./usePropertiesFormState";
import { usePropertiesQueries } from "./usePropertiesQueries";
import { usePropertiesSectionState } from "./usePropertiesSectionState";

export function usePropertiesPageModel() {
  const queryClient = useQueryClient();
  const queryState = usePropertiesQueries();
  const sectionState = usePropertiesSectionState();
  const forms = usePropertiesFormState();

  const { queries, options } = queryState;
  const { entryCategoriesLabel, entityCategoriesLabel, tagTypesLabel } = queryState.labels;
  const deletingTag = (queries.tagsQuery.data ?? []).find((tag) => tag.id === forms.deletingTagId) ?? null;
  const deletingEntryCategoryTerm =
    (queries.entryCategoryTermsQuery.data ?? []).find(
      (term) => term.id === forms.deletingEntryCategoryTermId
    ) ?? null;

  const filtered = usePropertiesFilteredData({
    sectionSearch: sectionState.sectionSearch,
    selectedTagTypes: sectionState.selectedTagTypes,
    currencyStatusFilter: sectionState.currencyStatusFilter,
    tags: queries.tagsQuery.data,
    currencies: queries.currenciesQuery.data,
    entityCategoryTerms: queries.entityCategoryTermsQuery.data,
    tagTypeTerms: queries.tagTypeTermsQuery.data
  });

  const tagTypeFilterOptions = useMemo(() => {
    const typeNames = uniqueOptionValues([
      ...taxonomyTermNames(queries.tagTypeTermsQuery.data),
      ...(queries.tagsQuery.data ?? []).map((tag) => tag.type)
    ]);
    if ((queries.tagsQuery.data ?? []).some((tag) => !tag.type?.trim())) {
      typeNames.push(UNCATEGORIZED_FILTER_LABEL);
    }
    return stringOptionsAsTags(typeNames);
  }, [queries.tagTypeTermsQuery.data, queries.tagsQuery.data]);

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      forms.setNewTagName("");
      forms.setNewTagType("");
      forms.setNewTagColor("");
      forms.setNewTagDescription("");
      sectionState.actions.closeCreatePanel("tags");
      invalidateTagReadModels(queryClient);
    }
  });

  const updateTagMutation = useMutation({
    mutationFn: ({
      tagId,
      name,
      color,
      description,
      type
    }: {
      tagId: number;
      name: string;
      color: string;
      description: string;
      type: string;
    }) => updateTag(tagId, { name, color: color || null, description: description || null, type: type || null }),
    onSuccess: () => {
      forms.setEditingTagId(null);
      forms.setEditingTagName("");
      forms.setEditingTagType("");
      forms.setEditingTagColor("");
      forms.setEditingTagDescription("");
      invalidateTagReadModels(queryClient);
    }
  });

  const deleteTagMutation = useMutation({
    mutationFn: deleteTag,
    onSuccess: (_data, deletedTagId) => {
      if (forms.editingTagId === deletedTagId) {
        forms.setEditingTagId(null);
        forms.setEditingTagName("");
        forms.setEditingTagType("");
        forms.setEditingTagColor("");
        forms.setEditingTagDescription("");
      }
      forms.setDeletingTagId(null);
      invalidateTagReadModels(queryClient);
    }
  });

  const createEntryCategoryTermMutation = useMutation({
    mutationFn: ({
      name,
      description,
      parentTermId,
      defaultLifecycle
    }: {
      name: string;
      description: string | null;
      parentTermId: string | null;
      defaultLifecycle: string | null;
    }) =>
      createTaxonomyTerm(ENTRY_CATEGORY_TAXONOMY_KEY, {
        name,
        description,
        parent_term_id: parentTermId,
        default_lifecycle: defaultLifecycle
      }),
    onSuccess: () => {
      forms.setNewEntryCategoryTermName("");
      forms.setNewEntryCategoryTermDescription("");
      forms.setNewEntryCategoryParentId("");
      forms.setNewEntryCategoryDefaultLifecycle("");
      sectionState.actions.closeCreatePanel("entryCategories");
      invalidateTaxonomyReadModels(queryClient, ENTRY_CATEGORY_TAXONOMY_KEY);
    }
  });

  const updateEntryCategoryTermMutation = useMutation({
    mutationFn: ({
      termId,
      name,
      description,
      defaultLifecycle
    }: {
      termId: string;
      name: string;
      description: string | null;
      defaultLifecycle: string | null;
    }) =>
      updateTaxonomyTerm(ENTRY_CATEGORY_TAXONOMY_KEY, termId, {
        name,
        description,
        default_lifecycle: defaultLifecycle
      }),
    onSuccess: () => {
      forms.setEditingEntryCategoryTermId("");
      forms.setEditingEntryCategoryTermName("");
      forms.setEditingEntryCategoryTermDescription("");
      forms.setEditingEntryCategoryDefaultLifecycle("");
      invalidateTaxonomyReadModels(queryClient, ENTRY_CATEGORY_TAXONOMY_KEY);
    }
  });

  const deleteEntryCategoryTermMutation = useMutation({
    mutationFn: (termId: string) => deleteTaxonomyTerm(ENTRY_CATEGORY_TAXONOMY_KEY, termId),
    onSuccess: () => {
      forms.setDeletingEntryCategoryTermId("");
      invalidateTaxonomyReadModels(queryClient, ENTRY_CATEGORY_TAXONOMY_KEY);
    }
  });

  const createEntityCategoryTermMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createTaxonomyTerm(ENTITY_CATEGORY_TAXONOMY_KEY, { name, description }),
    onSuccess: () => {
      forms.setNewEntityCategoryTermName("");
      forms.setNewEntityCategoryTermDescription("");
      sectionState.actions.closeCreatePanel("entityCategories");
      invalidateTaxonomyReadModels(queryClient, ENTITY_CATEGORY_TAXONOMY_KEY);
    }
  });

  const updateEntityCategoryTermMutation = useMutation({
    mutationFn: ({ termId, name, description }: { termId: string; name: string; description?: string | null }) =>
      updateTaxonomyTerm(ENTITY_CATEGORY_TAXONOMY_KEY, termId, { name, description }),
    onSuccess: () => {
      forms.setEditingEntityCategoryTermId("");
      forms.setEditingEntityCategoryTermName("");
      forms.setEditingEntityCategoryTermDescription("");
      invalidateTaxonomyReadModels(queryClient, ENTITY_CATEGORY_TAXONOMY_KEY);
    }
  });

  const createTagTypeTermMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createTaxonomyTerm(TAG_TYPE_TAXONOMY_KEY, { name, description }),
    onSuccess: () => {
      forms.setNewTagTypeTermName("");
      forms.setNewTagTypeTermDescription("");
      sectionState.actions.closeCreatePanel("tagCategories");
      invalidateTaxonomyReadModels(queryClient, TAG_TYPE_TAXONOMY_KEY);
    }
  });

  const updateTagTypeTermMutation = useMutation({
    mutationFn: ({ termId, name, description }: { termId: string; name: string; description?: string | null }) =>
      updateTaxonomyTerm(TAG_TYPE_TAXONOMY_KEY, termId, { name, description }),
    onSuccess: () => {
      forms.setEditingTagTypeTermId("");
      forms.setEditingTagTypeTermName("");
      forms.setEditingTagTypeTermDescription("");
      invalidateTaxonomyReadModels(queryClient, TAG_TYPE_TAXONOMY_KEY);
    }
  });

  function onCreateTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = forms.newTagName.trim();
    if (!name) {
      return;
    }
    createTagMutation.mutate({
      name,
      type: forms.newTagType.trim() || undefined,
      color: forms.newTagColor.trim() || undefined,
      description: forms.newTagDescription.trim() || undefined
    });
  }

  function onCreateEntityCategoryTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = forms.newEntityCategoryTermName.trim();
    if (!name) {
      return;
    }
    createEntityCategoryTermMutation.mutate({
      name,
      description: forms.newEntityCategoryTermDescription.trim() || undefined
    });
  }

  function onCreateEntryCategoryTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = forms.newEntryCategoryTermName.trim();
    if (!name) {
      return;
    }
    createEntryCategoryTermMutation.mutate({
      name,
      description: forms.newEntryCategoryTermDescription.trim() || null,
      parentTermId: forms.newEntryCategoryParentId || null,
      defaultLifecycle: forms.newEntryCategoryParentId
        ? forms.newEntryCategoryDefaultLifecycle || null
        : null
    });
  }

  function onCreateTagTypeTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = forms.newTagTypeTermName.trim();
    if (!name) {
      return;
    }
    createTagTypeTermMutation.mutate({
      name,
      description: forms.newTagTypeTermDescription.trim() || undefined
    });
  }

  function saveTag(tagId: number) {
    const name = forms.editingTagName.trim();
    if (!name) {
      return;
    }
    updateTagMutation.mutate({
      tagId,
      name,
      color: forms.editingTagColor.trim(),
      description: forms.editingTagDescription.trim(),
      type: forms.editingTagType.trim()
    });
  }

  function startEditTag(tag: Tag) {
    forms.setEditingTagId(tag.id);
    forms.setEditingTagName(tag.name);
    forms.setEditingTagType(tag.type ?? "");
    forms.setEditingTagColor(tag.color ?? "");
    forms.setEditingTagDescription(tag.description ?? "");
  }

  function cancelEditTag() {
    forms.setEditingTagId(null);
    forms.setEditingTagName("");
    forms.setEditingTagType("");
    forms.setEditingTagColor("");
    forms.setEditingTagDescription("");
  }

  function startDeleteTag(tag: Tag) {
    forms.setDeletingTagId(tag.id);
    deleteTagMutation.reset();
  }

  function cancelDeleteTag() {
    forms.setDeletingTagId(null);
    deleteTagMutation.reset();
  }

  function confirmDeleteTag() {
    if (forms.deletingTagId === null) {
      return;
    }
    deleteTagMutation.mutate(forms.deletingTagId);
  }

  function saveEntryCategoryTerm(termId: string) {
    const name = forms.editingEntryCategoryTermName.trim();
    if (!name) {
      return;
    }
    updateEntryCategoryTermMutation.mutate({
      termId,
      name,
      description: forms.editingEntryCategoryTermDescription.trim() || null,
      defaultLifecycle: forms.editingEntryCategoryDefaultLifecycle || null
    });
  }

  function startEditEntryCategoryTerm(term: TaxonomyTerm) {
    forms.setEditingEntryCategoryTermId(term.id);
    forms.setEditingEntryCategoryTermName(term.name);
    forms.setEditingEntryCategoryTermDescription(term.description ?? "");
    forms.setEditingEntryCategoryDefaultLifecycle(term.default_lifecycle ?? "");
  }

  function cancelEditEntryCategoryTerm() {
    forms.setEditingEntryCategoryTermId("");
    forms.setEditingEntryCategoryTermName("");
    forms.setEditingEntryCategoryTermDescription("");
    forms.setEditingEntryCategoryDefaultLifecycle("");
  }

  function startDeleteEntryCategoryTerm(term: TaxonomyTerm) {
    forms.setDeletingEntryCategoryTermId(term.id);
    deleteEntryCategoryTermMutation.reset();
  }

  function cancelDeleteEntryCategoryTerm() {
    forms.setDeletingEntryCategoryTermId("");
    deleteEntryCategoryTermMutation.reset();
  }

  function confirmDeleteEntryCategoryTerm() {
    if (!forms.deletingEntryCategoryTermId) {
      return;
    }
    deleteEntryCategoryTermMutation.mutate(forms.deletingEntryCategoryTermId);
  }

  function saveEntityCategoryTerm(termId: string) {
    const name = forms.editingEntityCategoryTermName.trim();
    if (!name) {
      return;
    }
    updateEntityCategoryTermMutation.mutate({
      termId,
      name,
      description: forms.editingEntityCategoryTermDescription.trim() || null
    });
  }

  function startEditEntityCategoryTerm(term: TaxonomyTerm) {
    forms.setEditingEntityCategoryTermId(term.id);
    forms.setEditingEntityCategoryTermName(term.name);
    forms.setEditingEntityCategoryTermDescription(term.description ?? "");
  }

  function cancelEditEntityCategoryTerm() {
    forms.setEditingEntityCategoryTermId("");
    forms.setEditingEntityCategoryTermName("");
    forms.setEditingEntityCategoryTermDescription("");
  }

  function saveTagTypeTerm(termId: string) {
    const name = forms.editingTagTypeTermName.trim();
    if (!name) {
      return;
    }
    updateTagTypeTermMutation.mutate({
      termId,
      name,
      description: forms.editingTagTypeTermDescription.trim() || null
    });
  }

  function startEditTagTypeTerm(term: TaxonomyTerm) {
    forms.setEditingTagTypeTermId(term.id);
    forms.setEditingTagTypeTermName(term.name);
    forms.setEditingTagTypeTermDescription(term.description ?? "");
  }

  function cancelEditTagTypeTerm() {
    forms.setEditingTagTypeTermId("");
    forms.setEditingTagTypeTermName("");
    forms.setEditingTagTypeTermDescription("");
  }

  const coreSections = [
    { id: "tags" as const, label: "Tags" },
    { id: "currencies" as const, label: "Currencies" }
  ];

  const taxonomySections = [
    { id: "entryCategories" as const, label: entryCategoriesLabel },
    { id: "entityCategories" as const, label: entityCategoriesLabel },
    { id: "tagCategories" as const, label: tagTypesLabel }
  ];

  return {
    activeSection: sectionState.activeSection,
    setActiveSection: sectionState.setActiveSection,
    sectionSearch: sectionState.sectionSearch,
    selectedTagTypes: sectionState.selectedTagTypes,
    setSelectedTagTypes: sectionState.setSelectedTagTypes,
    currencyStatusFilter: sectionState.currencyStatusFilter,
    setCurrencyStatusFilter: sectionState.setCurrencyStatusFilter,
    tagTypeFilterOptions,
    createPanelOpen: sectionState.createPanelOpen,
    coreSections,
    taxonomySections,
    entryCategoriesLabel,
    entityCategoriesLabel,
    tagTypesLabel,
    queries,
    filtered,
    options,
    forms: {
      newTagName: forms.newTagName,
      setNewTagName: forms.setNewTagName,
      newTagType: forms.newTagType,
      setNewTagType: forms.setNewTagType,
      newTagColor: forms.newTagColor,
      setNewTagColor: forms.setNewTagColor,
      newTagDescription: forms.newTagDescription,
      setNewTagDescription: forms.setNewTagDescription,
      editingTagId: forms.editingTagId,
      editingTagName: forms.editingTagName,
      setEditingTagName: forms.setEditingTagName,
      editingTagType: forms.editingTagType,
      setEditingTagType: forms.setEditingTagType,
      editingTagColor: forms.editingTagColor,
      setEditingTagColor: forms.setEditingTagColor,
      editingTagDescription: forms.editingTagDescription,
      setEditingTagDescription: forms.setEditingTagDescription,
      deletingTagId: forms.deletingTagId,
      newEntryCategoryTermName: forms.newEntryCategoryTermName,
      setNewEntryCategoryTermName: forms.setNewEntryCategoryTermName,
      newEntryCategoryTermDescription: forms.newEntryCategoryTermDescription,
      setNewEntryCategoryTermDescription: forms.setNewEntryCategoryTermDescription,
      newEntryCategoryParentId: forms.newEntryCategoryParentId,
      setNewEntryCategoryParentId: forms.setNewEntryCategoryParentId,
      newEntryCategoryDefaultLifecycle: forms.newEntryCategoryDefaultLifecycle,
      setNewEntryCategoryDefaultLifecycle: forms.setNewEntryCategoryDefaultLifecycle,
      editingEntryCategoryTermId: forms.editingEntryCategoryTermId,
      editingEntryCategoryTermName: forms.editingEntryCategoryTermName,
      setEditingEntryCategoryTermName: forms.setEditingEntryCategoryTermName,
      editingEntryCategoryTermDescription: forms.editingEntryCategoryTermDescription,
      setEditingEntryCategoryTermDescription: forms.setEditingEntryCategoryTermDescription,
      editingEntryCategoryDefaultLifecycle: forms.editingEntryCategoryDefaultLifecycle,
      setEditingEntryCategoryDefaultLifecycle: forms.setEditingEntryCategoryDefaultLifecycle,
      newEntityCategoryTermName: forms.newEntityCategoryTermName,
      setNewEntityCategoryTermName: forms.setNewEntityCategoryTermName,
      newEntityCategoryTermDescription: forms.newEntityCategoryTermDescription,
      setNewEntityCategoryTermDescription: forms.setNewEntityCategoryTermDescription,
      editingEntityCategoryTermId: forms.editingEntityCategoryTermId,
      editingEntityCategoryTermName: forms.editingEntityCategoryTermName,
      setEditingEntityCategoryTermName: forms.setEditingEntityCategoryTermName,
      editingEntityCategoryTermDescription: forms.editingEntityCategoryTermDescription,
      setEditingEntityCategoryTermDescription: forms.setEditingEntityCategoryTermDescription,
      newTagTypeTermName: forms.newTagTypeTermName,
      setNewTagTypeTermName: forms.setNewTagTypeTermName,
      newTagTypeTermDescription: forms.newTagTypeTermDescription,
      setNewTagTypeTermDescription: forms.setNewTagTypeTermDescription,
      editingTagTypeTermId: forms.editingTagTypeTermId,
      editingTagTypeTermName: forms.editingTagTypeTermName,
      setEditingTagTypeTermName: forms.setEditingTagTypeTermName,
      editingTagTypeTermDescription: forms.editingTagTypeTermDescription,
      setEditingTagTypeTermDescription: forms.setEditingTagTypeTermDescription
    },
    actions: {
      setSectionSearchValue: sectionState.actions.setSectionSearchValue,
      toggleCreatePanel: sectionState.actions.toggleCreatePanel,
      closeCreatePanel: sectionState.actions.closeCreatePanel,
      onCreateTag,
      onCreateEntryCategoryTerm,
      onCreateEntityCategoryTerm,
      onCreateTagTypeTerm,
      saveTag,
      startEditTag,
      cancelEditTag,
      startDeleteTag,
      cancelDeleteTag,
      confirmDeleteTag,
      saveEntryCategoryTerm,
      startEditEntryCategoryTerm,
      cancelEditEntryCategoryTerm,
      startDeleteEntryCategoryTerm,
      cancelDeleteEntryCategoryTerm,
      confirmDeleteEntryCategoryTerm,
      saveEntityCategoryTerm,
      startEditEntityCategoryTerm,
      cancelEditEntityCategoryTerm,
      saveTagTypeTerm,
      startEditTagTypeTerm,
      cancelEditTagTypeTerm
    },
    mutations: {
      createTagMutation,
      updateTagMutation,
      deleteTagMutation,
      createEntryCategoryTermMutation,
      updateEntryCategoryTermMutation,
      deleteEntryCategoryTermMutation,
      createEntityCategoryTermMutation,
      updateEntityCategoryTermMutation,
      createTagTypeTermMutation,
      updateTagTypeTermMutation
    },
    deleteTargets: {
      tag: deletingTag,
      entryCategoryTerm: deletingEntryCategoryTerm
    }
  };
}

export type PropertiesPageModel = ReturnType<typeof usePropertiesPageModel>;
