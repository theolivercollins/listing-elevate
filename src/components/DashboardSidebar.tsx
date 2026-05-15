import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
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
    label: "Ops",
    items: [
      {
        to: "/dashboard/studio",
        label: "Video studio",
        icon: "play",
        match: (p) => p.startsWith("/dashboard/studio"),
      },
      {
        to: "/dashboard/blog/posts",
        label: "Blog creator",
        icon: "image",
        match: (p) => p.startsWith("/dashboard/blog"),
      },
      { to: "/dashboard/finances", label: "Finances", icon: "dollar" },
      { to: "/dashboard/logs", label: "Logs", icon: "logs" },
      { to: "/dashboard/development/system-status", label: "System status", icon: "activity" },
      {
        to: "/dashboard/development/prompt-lab",
        label: "Lab",
        icon: "beaker",
        match: (p) =>
          p.startsWith("/dashboard/development/prompt-lab") ||
          p.startsWith("/dashboard/development/proposals") ||
          p.startsWith("/dashboard/development/learning") ||
          p.startsWith("/dashboard/rating-ledger"),
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

function UserMenu({
  collapsed,
  initials,
  displayName,
  email,
}: {
  collapsed: boolean;
  initials: string;
  displayName: string;
  email: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate("/");
  };

  const handleAccount = () => {
    setOpen(false);
    navigate("/account/profile");
  };

  const menu = open && (
    <div
      role="menu"
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        left: 0,
        right: 0,
        background: "var(--surface)",
        borderRadius: 12,
        boxShadow: "var(--shadow-lg)",
        border: "1px solid var(--line)",
        padding: 6,
        zIndex: 1100,
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleAccount}
        style={menuItemStyle}
      >
        <Icon name="user" size={14} />
        Account &amp; profile
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={handleSignOut}
        style={{ ...menuItemStyle, color: "var(--bad)" }}
      >
        <Icon name="external" size={14} />
        Sign out
      </button>
    </div>
  );

  if (collapsed) {
    return (
      <div ref={ref} style={{ position: "relative" }}>
        <button
          type="button"
          className="le-rail-avatar"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={email}
        >
          {initials}
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div className="le-sidebar-user">
        <Link
          to="/account/profile"
          className="le-sidebar-user-avatar"
          style={{ textDecoration: "none", color: "inherit" }}
          aria-label="Account & profile"
        >
          {initials}
        </Link>
        <Link
          to="/account/profile"
          className="le-sidebar-user-info"
          style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
        >
          <span className="le-sidebar-user-name" style={{ textTransform: "capitalize" }}>
            {displayName}
          </span>
          <span className="le-sidebar-user-email">{email}</span>
        </Link>
        <button
          type="button"
          className="le-sidebar-user-more"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account menu"
        >
          <Icon name="dots" size={14} />
        </button>
      </div>
      {menu}
    </div>
  );
}

const menuItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  textAlign: "left" as const,
  transition: "background .12s",
};

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
        <UserMenu
          collapsed={collapsed}
          initials={initials}
          displayName={displayName}
          email={email}
        />
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
