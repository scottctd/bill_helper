/**
 * CALLING SPEC:
 * - Purpose: own entity-category and tag-type taxonomy mutations for the properties workspace.
 * - Inputs: properties form state, section actions, and TanStack Query client.
 * - Outputs: entity/tag-type taxonomy mutations and edit action callbacks.
 * - Side effects: remote taxonomy writes and taxonomy cache invalidation.
 */
import { type FormEvent } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";

import { createTaxonomyTerm, updateTaxonomyTerm } from "../../lib/api";
import { ENTITY_CATEGORY_TAXONOMY_KEY, TAG_TYPE_TAXONOMY_KEY } from "../../lib/catalogs";
import { invalidateTaxonomyReadModels } from "../../lib/queryInvalidation";
import type { TaxonomyTerm } from "../../lib/types";
import type { usePropertiesFormState } from "./usePropertiesFormState";
import type { usePropertiesSectionState } from "./usePropertiesSectionState";

type PropertiesForms = ReturnType<typeof usePropertiesFormState>;
type PropertiesSectionState = ReturnType<typeof usePropertiesSectionState>;

export function usePropertiesEntityTaxonomyMutations(
  queryClient: QueryClient,
  forms: PropertiesForms,
  sectionState: PropertiesSectionState
) {
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

  return {
    mutations: {
      createEntityCategoryTermMutation,
      updateEntityCategoryTermMutation,
      createTagTypeTermMutation,
      updateTagTypeTermMutation
    },
    actions: {
      onCreateEntityCategoryTerm,
      onCreateTagTypeTerm,
      saveEntityCategoryTerm,
      startEditEntityCategoryTerm,
      cancelEditEntityCategoryTerm,
      saveTagTypeTerm,
      startEditTagTypeTerm,
      cancelEditTagTypeTerm
    }
  };
}
