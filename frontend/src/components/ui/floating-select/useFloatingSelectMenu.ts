/**
 * CALLING SPEC:
 * - Purpose: core open-state, positioning, outside-click, and portal wiring for floating selects.
 * - Inputs: anchor ref, optional disabled flag, and menu width constraints.
 * - Outputs: refs, menu styles, open state setters, and portal target for select menus.
 * - Side effects: window pointerdown/scroll/resize listeners while the menu is open.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

import { useFloatingMenuPosition } from "../../../hooks/useFloatingMenuPosition";
import { useFloatingMenuPortal } from "../../FloatingMenuPortal";

interface UseFloatingSelectMenuArgs {
  anchorRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
  minMenuWidth?: number;
}

export function useFloatingSelectMenu({ anchorRef, disabled = false, minMenuWidth }: UseFloatingSelectMenuArgs) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const portalNode = useFloatingMenuPortal();
  const [isOpen, setIsOpen] = useState(false);
  const { menuRef, menuStyle } = useFloatingMenuPosition({
    anchorRef,
    open: isOpen,
    minWidth: minMenuWidth
  });

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (rootRef.current.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuRef]);

  function toggleMenu() {
    if (disabled) {
      return;
    }
    setIsOpen((open) => !open);
  }

  function openMenu() {
    if (disabled) {
      return;
    }
    setIsOpen(true);
  }

  function closeMenu() {
    setIsOpen(false);
  }

  return {
    rootRef,
    menuRef,
    menuStyle,
    portalNode,
    isOpen,
    setIsOpen,
    toggleMenu,
    openMenu,
    closeMenu,
    disabled
  };
}
