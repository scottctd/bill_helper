/**
 * CALLING SPEC:
 * - Purpose: edit rule metadata and rule trees for one unified rule group.
 * - Inputs: loaded group detail, tag catalog, and save callbacks.
 * - Outputs: embedded rule editor UI for the group detail modal.
 * - Side effects: React Query mutation for group updates.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { GroupRuleEditorPanel } from "../groupRules/GroupRuleEditorPanel";
import {
  createExistingEditorSession,
  isEditorSessionDirty,
  toGroupRuleSubmitPayload,
  updateSessionFormState,
  type GroupRuleEditorFormState,
  type GroupRuleEditorSession
} from "../groupRules/groupRuleEditorState";
import { listTags, updateGroup } from "../../lib/api";
import { invalidateGroupReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import type { GroupRead } from "../../lib/types";

interface GroupRuleEditorSectionProps {
  group: GroupRead;
}

export function GroupRuleEditorSection({ group }: GroupRuleEditorSectionProps) {
  const queryClient = useQueryClient();
  const tagsQuery = useQuery({
    queryKey: queryKeys.properties.tags,
    queryFn: listTags
  });
  const [session, setSession] = useState<GroupRuleEditorSession>(() => createExistingEditorSession(group));

  useEffect(() => {
    setSession(createExistingEditorSession(group));
  }, [group]);

  const updateMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof toGroupRuleSubmitPayload>) => updateGroup(group.id, payload),
    onSuccess: (updatedGroup) => {
      setSession(createExistingEditorSession(updatedGroup));
      invalidateGroupReadModels(queryClient, undefined, group.id);
    }
  });

  const isDirty = useMemo(() => isEditorSessionDirty(session), [session]);
  const canSubmit = session.formState.name.trim().length > 0;

  function handleChange(nextFormState: GroupRuleEditorFormState) {
    setSession((current) => updateSessionFormState(current, nextFormState));
  }

  function handleSubmit() {
    if (!canSubmit || updateMutation.isPending) {
      return;
    }
    updateMutation.mutate(toGroupRuleSubmitPayload(session.formState));
  }

  return (
    <section className="groups-detail-section groups-detail-rule-editor">
      <div className="groups-detail-section-header">
        <div>
          <h3>Rule editor</h3>
          <p>Edit saved rule, color, and description.</p>
        </div>
      </div>
      <div className="groups-detail-section-body">
        <GroupRuleEditorPanel
          session={session}
          tags={tagsQuery.data ?? []}
          preferredTagName={tagsQuery.data?.[0]?.name}
          isDirty={isDirty}
          isPending={updateMutation.isPending}
          canSubmit={canSubmit}
          submitLabel="Save rule group"
          submitPendingLabel="Saving..."
          onSubmit={handleSubmit}
          mutationError={updateMutation.isError ? (updateMutation.error as Error).message : null}
          tagLoadError={tagsQuery.isError ? (tagsQuery.error as Error).message : null}
          onChange={handleChange}
        />
      </div>
    </section>
  );
}
