/**
 * CALLING SPEC:
 * - Purpose: shared proposal review panel shell (header, controls, sidebar, card slots).
 * - Inputs: layout slot nodes and optional Dialog wrapper props.
 * - Outputs: full-height review UI shell reused by agent and import flows.
 * - Side effects: Dialog open state when not embedded; renders through ModalShell when modal.
 */

import type { CSSProperties, ReactNode } from "react";

import { ModalShell } from "../../components/ui/modal-shell";
import { useResizablePanel } from "../../hooks/useResizablePanel";
import { cn } from "../../lib/utils";

const REVIEW_SIDEBAR_DEFAULT_WIDTH = 340;
const REVIEW_SIDEBAR_MIN_WIDTH = 240;
const REVIEW_SIDEBAR_MAX_WIDTH = 520;

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
  activeCard
}: ReviewPanelProps) {
  const { panelWidth: sidebarWidth, handleMouseDown: handleSidebarResizeMouseDown } = useResizablePanel({
    storageKey: "agent-review-sidebar-width",
    defaultWidth: REVIEW_SIDEBAR_DEFAULT_WIDTH,
    minWidth: REVIEW_SIDEBAR_MIN_WIDTH,
    maxWidth: REVIEW_SIDEBAR_MAX_WIDTH,
    edge: "left"
  });

  if (!open && !embedded) {
    return null;
  }

  const shellStyle: CSSProperties | undefined = isSidebarCollapsed
    ? undefined
    : { gridTemplateColumns: `${sidebarWidth}px auto minmax(0, 1fr)` };

  const reviewShell = (
    <div className={cn("agent-review-modal-layout", embedded && "agent-review-modal-layout-embedded")}>
      {header}

      <div
        className={cn("agent-review-shell", isSidebarCollapsed && "is-sidebar-collapsed")}
        style={shellStyle}
      >
        {controls}

        {!isSidebarCollapsed ? (
          <>
            <aside id={sidebarId} className="agent-review-sidebar" style={{ width: sidebarWidth }}>
              <div className="agent-review-sidebar-scroll">{sidebar}</div>
            </aside>
            <div
              className="panel-resize-handle agent-review-sidebar-resize-handle"
              onMouseDown={handleSidebarResizeMouseDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize review list"
            />
          </>
        ) : null}

        <section className="agent-review-card-column">{activeCard}</section>
      </div>
    </div>
  );

  if (embedded) {
    return reviewShell;
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="fullscreen"
      contentClassName={dialogContentClassName}
    >
      {reviewShell}
    </ModalShell>
  );
}
