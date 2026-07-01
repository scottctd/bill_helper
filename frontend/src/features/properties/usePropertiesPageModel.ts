/**
 * CALLING SPEC:
 * - Purpose: provide the `usePropertiesPageModel` React hook or UI state helper.
 * - Inputs: callers that import `frontend/src/features/properties/usePropertiesPageModel.ts` and pass module-defined arguments or framework events.
 * - Outputs: hooks and state helpers exported by `usePropertiesPageModel`.
 * - Side effects: client-side state coordination and query wiring.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { taxonomyTermNames, uniqueOptionValues } from "../../lib/catalogs";
import { stringOptionsAsTags, UNCATEGORIZED_FILTER_LABEL } from "../../lib/workspaceFilters";
import { usePropertiesEntryCategoryMutations } from "./usePropertiesEntryCategoryMutations";
import { usePropertiesEntityTaxonomyMutations } from "./usePropertiesEntityTaxonomyMutations";
import { usePropertiesFilteredData } from "./usePropertiesFilteredData";
import { usePropertiesFormState } from "./usePropertiesFormState";
import { usePropertiesQueries } from "./usePropertiesQueries";
import { usePropertiesSectionState } from "./usePropertiesSectionState";
import { usePropertiesTagMutations } from "./usePropertiesTagMutations";

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

  const tagMutations = usePropertiesTagMutations(queryClient, forms, sectionState);
  const entryCategoryMutations = usePropertiesEntryCategoryMutations(queryClient, forms, sectionState);
  const entityTaxonomyMutations = usePropertiesEntityTaxonomyMutations(queryClient, forms, sectionState);

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
      ...tagMutations.actions,
      ...entryCategoryMutations.actions,
      ...entityTaxonomyMutations.actions
    },
    mutations: {
      ...tagMutations.mutations,
      ...entryCategoryMutations.mutations,
      ...entityTaxonomyMutations.mutations
    },
    deleteTargets: {
      tag: deletingTag,
      entryCategoryTerm: deletingEntryCategoryTerm
    }
  };
}

export type PropertiesPageModel = ReturnType<typeof usePropertiesPageModel>;
