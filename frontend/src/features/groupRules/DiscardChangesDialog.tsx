/**
 * CALLING SPEC:
 * - Purpose: render the local discard-confirmation dialog used by the filters workspace.
 * - Inputs: callers that provide open state and discard/cancel handlers.
 * - Outputs: React UI for confirming unsaved-change loss.
 * - Side effects: React rendering and user event wiring.
 */
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";

interface DiscardChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DiscardChangesDialog({ open, onOpenChange, onConfirm }: DiscardChangesDialogProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Discard unsaved changes?"
      description="Your current filter-group edits will be lost if you continue."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Discard changes
          </Button>
        </>
      }
    />
  );
}
