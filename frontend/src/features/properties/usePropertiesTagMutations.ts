/**
 * CALLING SPEC:
 * - Purpose: own tag CRUD mutations and tag form handlers for the properties workspace.
 * - Inputs: properties form state, section actions, and TanStack Query client.
 * - Outputs: tag mutations and tag edit/delete action callbacks.
 * - Side effects: remote tag writes and tag cache invalidation.
 */
import { type FormEvent } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";

import { createTag, deleteTag, updateTag } from "../../lib/api";
import { invalidateTagReadModels } from "../../lib/queryInvalidation";
import type { Tag } from "../../lib/types";
import type { usePropertiesFormState } from "./usePropertiesFormState";
import type { usePropertiesSectionState } from "./usePropertiesSectionState";

type PropertiesForms = ReturnType<typeof usePropertiesFormState>;
type PropertiesSectionState = ReturnType<typeof usePropertiesSectionState>;

export function usePropertiesTagMutations(
  queryClient: QueryClient,
  forms: PropertiesForms,
  sectionState: PropertiesSectionState
) {
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

  return {
    mutations: {
      createTagMutation,
      updateTagMutation,
      deleteTagMutation
    },
    actions: {
      onCreateTag,
      saveTag,
      startEditTag,
      cancelEditTag,
      startDeleteTag,
      cancelDeleteTag,
      confirmDeleteTag
    }
  };
}
