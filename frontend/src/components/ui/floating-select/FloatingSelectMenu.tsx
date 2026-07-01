/**
 * CALLING SPEC:
 * - Purpose: portal-rendered floating menu surface shared by single, creatable, and multi selects.
 * - Inputs: open flag, portal node, positioned menu refs/styles, optional search header, and option content.
 * - Outputs: portaled SelectMenuSurface when open, otherwise null.
 * - Side effects: React portal mount into the floating menu portal or document.body.
 */

import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { SelectMenuSurface } from "../../SelectMenuSurface";

interface FloatingSelectMenuProps {
  open: boolean;
  portalNode: HTMLElement | null;
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  className: string;
  children: ReactNode;
  search?: ReactNode;
  role?: string;
  ariaLabel?: string;
}

export function FloatingSelectMenu({
  open,
  portalNode,
  menuRef,
  menuStyle,
  className,
  children,
  search,
  role,
  ariaLabel
}: FloatingSelectMenuProps) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <SelectMenuSurface
      className={className}
      role={role}
      aria-label={ariaLabel}
      menuRef={menuRef}
      menuStyle={menuStyle}
      search={search}
    >
      {children}
    </SelectMenuSurface>,
    portalNode ?? document.body
  );
}
