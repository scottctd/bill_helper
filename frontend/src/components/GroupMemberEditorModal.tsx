/**
 * CALLING SPEC:
 * - Purpose: render the `GroupMemberEditorModal` React UI module.
 * - Inputs: callers that import `frontend/src/components/GroupMemberEditorModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `GroupMemberEditorModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { useEffect, useMemo, useState } from "react";

import type { GroupMemberCreatePayload, GroupMemberOverride, GroupSource } from "../lib/types";
import { SingleSelect } from "./SingleSelect";
import { Button } from "./ui/button";
import { ModalShell } from "./ui/modal-shell";
import { NativeSelect } from "./ui/native-select";

interface MemberOption {
  id: string;
  label: string;
}

interface GroupMemberEditorModalProps {
  isOpen: boolean;
  groupName: string;
  groupSource: GroupSource;
  entryOptions: MemberOption[];
  isSaving: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSubmit: (payload: GroupMemberCreatePayload) => void;
}

export function GroupMemberEditorModal({
  isOpen,
  groupName,
  groupSource,
  entryOptions,
  isSaving,
  saveError = null,
  onClose,
  onSubmit
}: GroupMemberEditorModalProps) {
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [override, setOverride] = useState<GroupMemberOverride | "">("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedEntryId("");
    setOverride("");
    setFormError(null);
  }, [groupSource, isOpen]);

  const selectOptions = useMemo(
    () =>
      entryOptions.map((option) => ({
        value: option.id,
        label: option.label
      })),
    [entryOptions]
  );

  function submit() {
    if (!selectedEntryId) {
      setFormError("Select an entry.");
      return;
    }
    setFormError(null);
    onSubmit({
      entry_id: selectedEntryId,
      override: groupSource === "rule" && override ? override : undefined
    });
  }

  return (
    <ModalShell
      open={isOpen}
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="sm"
      title={groupSource === "manual" ? "Add Group Member" : "Pin or Exclude Entry"}
      description={
        groupSource === "manual" ? `Add an entry to ${groupName}.` : `Override rule membership for ${groupName}.`
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? "Saving..." : groupSource === "manual" ? "Add member" : "Save override"}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <label className="field min-w-0">
          <span>Entry</span>
          <SingleSelect
            value={selectedEntryId}
            options={selectOptions}
            placeholder="Select entry..."
            searchable
            searchPlaceholder="Search entries..."
            emptyLabel="No entries available."
            onChange={setSelectedEntryId}
          />
        </label>

        {groupSource === "rule" ? (
          <label className="field min-w-0">
            <span>Override</span>
            <NativeSelect
              value={override}
              onChange={(event) => setOverride(event.target.value as GroupMemberOverride | "")}
            >
              <option value="">Default (rule match)</option>
              <option value="include">Pin (include)</option>
              <option value="exclude">Exclude</option>
            </NativeSelect>
          </label>
        ) : null}

        {formError ? <p className="error">{formError}</p> : null}
        {saveError ? <p className="error">{saveError}</p> : null}
      </div>
    </ModalShell>
  );
}
