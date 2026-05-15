import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Icon, type IconName } from "@/components/dashboard/icons";

const COLLAPSED_KEY = "le-dashboard-sidebar-collapsed";

interface SidebarItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  badge?: number;
  match?: (pathname: string) => boolean;
}

interface SidebarSection {
  label: string;
  items: SidebarItem[];
}

const SECTIONS: SidebarSection[] = [
  {
    label: "Studio",
    items: [
      { to: "/dashboard", label: "Overview", icon: "grid", end: true },
      { to: "/dashboard/pipeline", label: "Pipeline", icon: "pipeline" },
      { to: "/dashboard/properties", label: "Listings", icon: "home" },
      { to: "/dashboard/users", label: "Users", icon: "users" },
    ],
  },
  {
    label: "Lab",
    items: [
      { to: "/dashboard/development/prompt-lab", label: "Prompt lab", icon: "beaker" },
      { to: "/dashboard/development/prompt-lab/recipes", label: "Recipes", icon: "book" },
      { to: "/dashboard/development/proposals", label: "Proposals", icon: "branch" },
      { to: "/dashboard/rating-ledger", label: "Rating ledger", icon: "sliders" },
    ],
  },
  {
    label: "Ops",
    items: [
      { to: "/dashboard/finances", label: "Finances", icon: "dollar" },
      { to: "/dashboard/logs", label: "Logs", icon: "logs" },
      { to: "/dashboard/development/system-status", label: "System status", icon: "activity" },
      {
        to: "/dashboard/blog/posts",
        label: "Blog studio",
        icon: "image",
        match: (p) => p.startsWith("/dashboard/blog"),
      },
      { to: "/dashboard/settings", label: "Settings", icon: "settings" },
    ],
  },
];

function useCollapsedState() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    document.documentElement.dataset.leSidebarCollapsed = collapsed ? "1" : "0";
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

export function useDashboardSidebar() {
  return useCollapsedState();
}

export interface DashboardSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function DashboardSidebar({ collapsed, onToggleCollapsed }: DashboardSidebarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const initials = (user?.email ?? "Listing Elevate")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "LE";
  const displayName = user?.email?.split("@")[0]?.replace(/\./g, " ") ?? "Listing Elevate";
  const email = user?.email ?? "studio@listingelevate.com";

  return (
    <aside className="le-dash-sidebar">
      <Link to="/dashboard" className="le-sidebar-brand">
        <span className="le-sidebar-logo">
          <Icon name="logo" size={28} />
        </span>
        {!collapsed && (
          <span className="le-sidebar-brand-text">
            <span className="le-sidebar-brand-name">Listing Elevate</span>
            <span className="le-sidebar-brand-sub">Studio · v2.4</span>
          </span>
        )}
      </Link>

      {!collapsed && (
        <button type="button" className="le-workspace-switch">
          <span className="le-ws-avatar">R</span>
          <span className="le-ws-info">
            <span className="le-ws-name">Recasi</span>
            <span className="le-ws-sub">Production</span>
          </span>
          <Icon name="chevron-down" size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        </button>
      )}

      <nav className="le-sidebar-nav" aria-label="Dashboard navigation">
        {SECTIONS.map((section) => (
          <div className="le-sidebar-section" key={section.label}>
            {!collapsed && <div className="le-sidebar-section-label">{section.label}</div>}
            {section.items.map((item) => {
              const matched = item.match
                ? item.match(location.pathname)
                : item.end
                ? location.pathname === item.to
                : location.pathname === item.to ||
                  location.pathname.startsWith(item.to + "/");
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={() =>
                    [
                      "le-nav-item",
                      matched ? "is-active" : "",
                      collapsed ? "is-collapsed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <span className="le-nav-item-icon">
                    <Icon name={item.icon} size={17} strokeWidth={matched ? 1.9 : 1.6} />
                  </span>
                  {!collapsed && <span className="le-nav-item-label">{item.label}</span>}
                  {!collapsed && item.badge != null && (
                    <span className="le-nav-item-badge">{item.badge}</span>
                  )}
                  {collapsed && item.badge != null && <span className="le-nav-item-dot" />}
                  {collapsed && <span className="le-nav-tooltip">{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="le-sidebar-foot">
        {!collapsed ? (
          <Link to="/account" className="le-sidebar-user">
            <span className="le-sidebar-user-avatar">{initials}</span>
            <span className="le-sidebar-user-info">
              <span className="le-sidebar-user-name" style={{ textTransform: "capitalize" }}>
                {displayName}
              </span>
              <span className="le-sidebar-user-email">{email}</span>
            </span>
            <span className="le-sidebar-user-more" aria-hidden>
              <Icon name="dots" size={14} />
            </span>
          </Link>
        ) : (
          <Link to="/account" className="le-rail-avatar" title={email}>
            {initials}
          </Link>
        )}
        <button
          type="button"
          className="le-sidebar-collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon
            name={collapsed ? "chevron-right" : "chevron-down"}
            size={14}
            style={{ transform: collapsed ? "none" : "rotate(90deg)" }}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
