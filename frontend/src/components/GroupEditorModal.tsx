/**
 * CALLING SPEC:
 * - Purpose: render the `GroupEditorModal` React UI module.
 * - Inputs: callers that import `frontend/src/components/GroupEditorModal.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `GroupEditorModal`.
 * - Side effects: React rendering and user event wiring.
 */
import { useEffect, useState } from "react";

import type { GroupSource } from "../lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ModalShell } from "./ui/modal-shell";
import { NativeSelect } from "./ui/native-select";

const GROUP_SOURCE_OPTIONS: GroupSource[] = ["manual", "rule"];

interface GroupEditorModalProps {
  isOpen: boolean;
  mode: "create" | "rename";
  initialName?: string;
  initialGroupSource?: GroupSource;
  isSaving: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSubmit: (payload: { name: string; source: GroupSource }) => void;
}

export function GroupEditorModal({
  isOpen,
  mode,
  initialName = "",
  initialGroupSource = "manual",
  isSaving,
  saveError = null,
  onClose,
  onSubmit
}: GroupEditorModalProps) {
  const [name, setName] = useState(initialName);
  const [groupSource, setGroupSource] = useState<GroupSource>(initialGroupSource);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(initialName);
    setGroupSource(initialGroupSource);
    setFormError(null);
  }, [initialGroupSource, initialName, isOpen]);

  function submit() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setFormError("Group name is required.");
      return;
    }
    setFormError(null);
    onSubmit({ name: normalizedName, source: groupSource });
  }

  return (
    <ModalShell
      open={isOpen}
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="sm"
      title={mode === "create" ? "Create Group" : "Rename Group"}
      description={
        mode === "create"
          ? "Create a group now and add members or rules afterwards."
          : "Rename this group without changing its source."
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isSaving}>
            {isSaving ? "Saving..." : mode === "create" ? "Create group" : "Rename group"}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <label className="field min-w-0">
          <span>Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Monthly bills" />
        </label>

        <label className="field min-w-0">
          <span>Source</span>
          <NativeSelect
            value={groupSource}
            onChange={(event) => setGroupSource(event.target.value as GroupSource)}
            disabled={mode === "rename"}
          >
            {GROUP_SOURCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </label>

        {formError ? <p className="error">{formError}</p> : null}
        {saveError ? <p className="error">{saveError}</p> : null}
      </div>
    </ModalShell>
  );
}
