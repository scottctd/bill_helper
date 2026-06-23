/**
 * CALLING SPEC:
 * - Purpose: shared sidebar route labels for navigation and page landmarks.
 * - Inputs: none at module load; callers pass pathname strings for lookup.
 * - Outputs: nav item definitions and route title resolution helpers.
 * - Side effects: none.
 */
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Building2,
  CreditCard,
  FolderKanban,
  Home,
  Import,
  Layers3,
  Network,
  Settings2,
  Shield
} from "lucide-react";

export type AppNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/", label: "Agent", icon: Bot, end: true },
  { to: "/import", label: "Import", icon: Import },
  { to: "/accounts", label: "Accounts", icon: CreditCard },
  { to: "/entries", label: "Entries", icon: Layers3 },
  { to: "/groups", label: "Groups", icon: Network },
  { to: "/entities", label: "Entities", icon: Building2 },
  { to: "/properties", label: "Properties", icon: FolderKanban }
];

export const APP_SETTINGS_NAV_ITEM: AppNavItem = {
  to: "/settings",
  label: "Settings",
  icon: Settings2,
  end: true
};

export const APP_ADMIN_NAV_ITEM: AppNavItem = {
  to: "/admin",
  label: "Admin",
  icon: Shield,
  end: true
};

function matchesNavItem(pathname: string, item: AppNavItem): boolean {
  if (item.end) {
    return pathname === item.to;
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function resolveRoutePageTitle(pathname: string): string {
  if (pathname.startsWith("/entries/") && pathname !== "/entries") {
    return "Entry detail";
  }

  const navItems = [...APP_NAV_ITEMS, APP_SETTINGS_NAV_ITEM, APP_ADMIN_NAV_ITEM];
  const matched = navItems
    .filter((item) => matchesNavItem(pathname, item))
    .sort((left, right) => right.to.length - left.to.length)[0];

  return matched?.label ?? "Bill Helper";
}
