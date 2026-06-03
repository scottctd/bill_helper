/**
 * CALLING SPEC:
 * - Purpose: shared proposal review panel shell (header, controls, sidebar, card, footer slots).
 * - Inputs: layout slot nodes and optional Dialog wrapper props.
 * - Outputs: full-height review UI shell reused by agent and import flows.
 * - Side effects: Dialog open state when not embedded.
 */

import type { ReactNode } from "react";

import { Dialog, DialogContent } from "../../components/ui/dialog";
import { cn } from "../../lib/utils";

export interface ReviewPanelProps {
  open: boolean;
  embedded?: boolean;
  onOpenChange: (open: boolean) => void;
  dialogContentClassName?: string;
  isSidebarCollapsed: boolean;
  sidebarId?: string;
  header: ReactNode;
  controls: ReactNode;
  sidebar: ReactNode;
  activeCard: ReactNode;
  footer?: ReactNode;
}

export function ReviewPanel({
  open,
  embedded = false,
  onOpenChange,
  dialogContentClassName,
  isSidebarCollapsed,
  sidebarId = "agent-review-sidebar",
  header,
  controls,
  sidebar,
  activeCard,
  footer
}: ReviewPanelProps) {
  if (!open && !embedded) {
    return null;
  }

  const reviewShell = (
    <div className={cn("agent-review-modal-layout", embedded && "agent-review-modal-layout-embedded")}>
      {header}

      <div className={cn("agent-review-shell", isSidebarCollapsed && "is-sidebar-collapsed")}>
        {controls}

        {!isSidebarCollapsed ? (
          <aside id={sidebarId} className="agent-review-sidebar">
            <div className="agent-review-sidebar-scroll">{sidebar}</div>
          </aside>
        ) : null}

        <section className="agent-review-card-column">{activeCard}</section>
      </div>

      {footer}
    </div>
  );

  if (embedded) {
    return reviewShell;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "agent-review-modal-content h-[96vh] w-[96vw] max-w-none overflow-hidden bg-card p-0 sm:w-[94vw] md:w-[92vw] lg:h-[94vh] lg:w-[88vw] xl:w-[78rem]",
          dialogContentClassName
        )}
      >
        {reviewShell}
      </DialogContent>
    </Dialog>
  );
}
