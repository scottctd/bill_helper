/**
 * CALLING SPEC:
 * - Purpose: provide the shared floating menu shell used by searchable single- and multi-select controls.
 * - Inputs: positioned menu styles, an optional search header, and selectable option content.
 * - Outputs: a fixed header plus an independently scrollable options region.
 * - Side effects: React rendering only.
 */
import type { CSSProperties, HTMLAttributes, ReactNode, RefObject } from "react";

interface SelectMenuSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  search?: ReactNode;
}

export function SelectMenuSurface({
  children,
  className = "",
  menuRef,
  menuStyle,
  search,
  ...props
}: SelectMenuSurfaceProps) {
  return (
    <div className={`select-menu-surface ${className}`} ref={menuRef} style={menuStyle} {...props}>
      {search ? <div className="select-menu-search">{search}</div> : null}
      <div className="select-menu-options">{children}</div>
    </div>
  );
}
