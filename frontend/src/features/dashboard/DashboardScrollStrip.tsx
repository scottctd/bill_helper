/**
 * CALLING SPEC:
 * - Purpose: shared horizontal scroll container for dashboard toolbar chip strips.
 * - Inputs: aria label, optional disabled state, scroll ref, keyboard handler, and chip children.
 * - Outputs: focusable scroll region with wheel-to-horizontal-scroll behavior.
 * - Side effects: non-passive wheel listener on the strip element.
 */

import { useCallback, useRef, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Normalize wheel delta to CSS pixels (handles line/page modes). */
function wheelAxisPixels(e: WheelEvent, axis: "x" | "y"): number {
  const raw = axis === "y" ? e.deltaY : e.deltaX;
  if (e.deltaMode === 1) {
    return raw * 16;
  }
  if (e.deltaMode === 2) {
    const page = axis === "y" ? window.innerHeight : window.innerWidth;
    return raw * (page || 800);
  }
  return raw;
}

/** Wheel over the strip scrolls horizontally and does not scroll the page, including at scroll extents. */
function attachScrollStripWheel(el: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();

    const py = wheelAxisPixels(e, "y");
    const px = wheelAxisPixels(e, "x");
    const delta = Math.abs(py) >= Math.abs(px) ? py : px;
    el.scrollBy({ left: delta, behavior: "auto" });
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}

export type DashboardScrollStripProps = {
  ariaLabel: string;
  disabled?: boolean;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  className?: string;
};

export function DashboardScrollStrip({
  ariaLabel,
  disabled = false,
  scrollRef,
  onKeyDown,
  empty = false,
  emptyMessage,
  children,
  className
}: DashboardScrollStripProps) {
  const wheelCleanupRef = useRef<(() => void) | null>(null);

  const setStripRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (wheelCleanupRef.current) {
        wheelCleanupRef.current();
        wheelCleanupRef.current = null;
      }
      scrollRef.current = node;
      if (node && !disabled) {
        wheelCleanupRef.current = attachScrollStripWheel(node);
      }
    },
    [disabled, scrollRef]
  );

  return (
    <div
      ref={setStripRef}
      className={cn(
        "dashboard-timeline-strip",
        disabled && "dashboard-timeline-strip-disabled",
        className
      )}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKeyDown}
      tabIndex={disabled ? -1 : 0}
    >
      {empty ? (
        <div className="dashboard-timeline-empty dashboard-timeline-empty-inline">{emptyMessage}</div>
      ) : (
        children
      )}
    </div>
  );
}
