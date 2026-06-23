/**
 * CALLING SPEC:
 * - Purpose: keep floating select menus inside modal scroll-lock and focus boundaries.
 * - Inputs: dialog or page content containing controls that open floating menus.
 * - Outputs: a shared viewport-sized portal host and a hook returning its DOM node.
 * - Side effects: stores the mounted portal host element in React context.
 */
import { createContext, useContext, useState, type ReactNode } from "react";

const FloatingMenuPortalContext = createContext<HTMLElement | null>(null);

export function FloatingMenuPortalProvider({ children }: { children: ReactNode }) {
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);

  return (
    <FloatingMenuPortalContext.Provider value={portalNode}>
      {children}
      <div ref={setPortalNode} className="floating-menu-portal-host" />
    </FloatingMenuPortalContext.Provider>
  );
}

export function useFloatingMenuPortal() {
  return useContext(FloatingMenuPortalContext);
}
