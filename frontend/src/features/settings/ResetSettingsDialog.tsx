/**
 * CALLING SPEC:
 * - Purpose: render the `ResetSettingsDialog` React UI module.
 * - Inputs: callers that import `frontend/src/features/settings/ResetSettingsDialog.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `ResetSettingsDialog`.
 * - Side effects: React rendering and user event wiring.
 */
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";

interface ResetSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function ResetSettingsDialog({ open, onOpenChange, onConfirm, isPending }: ResetSettingsDialogProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Reset all runtime overrides?"
      description="This clears saved runtime overrides and restores the effective values from the server configuration."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Resetting..." : "Reset to server defaults"}
          </Button>
        </>
      }
    >
      <div className="grid gap-2 text-sm text-foreground">
        <p className="muted">
          This affects currencies, agent models and memory, provider overrides, import concurrency, attachment limits, and
          reliability settings.
        </p>
        <p className="muted">Use this when you want the app to follow the server defaults again.</p>
      </div>
    </ModalShell>
  );
}
