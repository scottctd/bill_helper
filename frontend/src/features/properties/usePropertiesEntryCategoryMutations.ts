/**
 * CALLING SPEC:
 * - Purpose: own entry-category taxonomy mutations and form handlers for properties.
 * - Inputs: properties form state, section actions, and TanStack Query client.
 * - Outputs: entry-category mutations and edit/delete action callbacks.
 * - Side effects: remote taxonomy writes and entry-category cache invalidation.
 */
import { type FormEvent } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";

import { createTaxonomyTerm, deleteTaxonomyTerm, updateTaxonomyTerm } from "../../lib/api";
import { ENTRY_CATEGORY_TAXONOMY_KEY } from "../../lib/catalogs";
import { invalidateTaxonomyReadModels } from "../../lib/queryInvalidation";
import type { TaxonomyTerm } from "../../lib/types";
import type { usePropertiesFormState } from "./usePropertiesFormState";
import type { usePropertiesSectionState } from "./usePropertiesSectionState";

type PropertiesForms = ReturnType<typeof usePropertiesFormState>;
type PropertiesSectionState = ReturnType<typeof usePropertiesSectionState>;

export function usePropertiesEntryCategoryMutations(
  queryClient: QueryClient,
  forms: PropertiesForms,
  sectionState: PropertiesSectionState
) {
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

  return {
    mutations: {
      createEntryCategoryTermMutation,
      updateEntryCategoryTermMutation,
      deleteEntryCategoryTermMutation
    },
    actions: {
      onCreateEntryCategoryTerm,
      saveEntryCategoryTerm,
      startEditEntryCategoryTerm,
      cancelEditEntryCategoryTerm,
      startDeleteEntryCategoryTerm,
      cancelDeleteEntryCategoryTerm,
      confirmDeleteEntryCategoryTerm
    }
  };
}
