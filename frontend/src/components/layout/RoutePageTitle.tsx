/**
 * CALLING SPEC:
 * - Purpose: render the visually hidden route page title for screen readers.
 * - Inputs: current pathname from React Router location.
 * - Outputs: an sr-only h1 landmark matching the active sidebar route.
 * - Side effects: React rendering only.
 */
import { useLocation } from "react-router-dom";

import { resolveRoutePageTitle } from "../../lib/appNavigation";

export function RoutePageTitle() {
  const { pathname } = useLocation();
  const title = resolveRoutePageTitle(pathname);

  return <h1 className="sr-only">{title}</h1>;
}
