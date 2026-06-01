/**
 * CALLING SPEC:
 * - Purpose: render the `Sidebar` React UI module.
 * - Inputs: callers that import `frontend/src/components/Sidebar.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `Sidebar`.
 * - Side effects: React rendering and user event wiring.
 */
import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import { PanelLeft, PanelLeftClose } from "lucide-react";

import { AuthSessionCard, useAuth } from "../features/auth";
import { usePrefetchDashboard } from "../features/dashboard/usePrefetchDashboard";
import { APP_ADMIN_NAV_ITEM, APP_NAV_ITEMS, APP_SETTINGS_NAV_ITEM } from "../lib/appNavigation";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface SidebarProps {
  collapsed: boolean;
  width: number;
  onToggle: () => void;
}

export function Sidebar({ collapsed, width, onToggle }: SidebarProps) {
  const auth = useAuth();
  const { prefetchCoreDashboard } = usePrefetchDashboard();
  const sidebarStyle = (!collapsed ? { "--sidebar-width": `${width}px` } : undefined) as CSSProperties | undefined;

  return (
    <aside className={cn("sidebar", collapsed && "sidebar-collapsed")} style={sidebarStyle}>
      <div className="sidebar-header">
        {!collapsed ? <span className="sidebar-title">Bill Helper</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="sidebar-nav">
        {APP_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn("sidebar-link", isActive && "sidebar-link-active")}
              title={collapsed ? item.label : undefined}
              onMouseEnter={item.to === "/dashboard" ? () => prefetchCoreDashboard() : undefined}
              onFocus={item.to === "/dashboard" ? () => prefetchCoreDashboard() : undefined}
            >
              <Icon className="sidebar-link-icon" />
              {!collapsed ? <span className="sidebar-link-label">{item.label}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <NavLink
          to={APP_SETTINGS_NAV_ITEM.to}
          end={APP_SETTINGS_NAV_ITEM.end}
          className={({ isActive }) => cn("sidebar-link", isActive && "sidebar-link-active")}
          title={collapsed ? APP_SETTINGS_NAV_ITEM.label : undefined}
        >
          <APP_SETTINGS_NAV_ITEM.icon className="sidebar-link-icon" />
          {!collapsed ? <span className="sidebar-link-label">{APP_SETTINGS_NAV_ITEM.label}</span> : null}
        </NavLink>
        {auth.status === "authenticated" && auth.session?.user.is_admin ? (
          <NavLink
            to={APP_ADMIN_NAV_ITEM.to}
            end={APP_ADMIN_NAV_ITEM.end}
            className={({ isActive }) => cn("sidebar-link", isActive && "sidebar-link-active")}
            title={collapsed ? APP_ADMIN_NAV_ITEM.label : undefined}
          >
            <APP_ADMIN_NAV_ITEM.icon className="sidebar-link-icon" />
            {!collapsed ? <span className="sidebar-link-label">{APP_ADMIN_NAV_ITEM.label}</span> : null}
          </NavLink>
        ) : null}
        <AuthSessionCard collapsed={collapsed} />
      </div>
    </aside>
  );
}
