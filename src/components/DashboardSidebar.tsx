import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { fetchLogs, fetchProperties } from "@/lib/api";
import { Icon, type IconName } from "@/components/dashboard/icons";
import { Moon, Sun } from "lucide-react";

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

/**
 * Agent (non-admin) nav — 5 items total, single section.
 * Brand sub-label: "Client studio" (no version string).
 */
const AGENT_SECTIONS: SidebarSection[] = [
  {
    label: "Studio",
    items: [
      { to: "/dashboard", label: "Home", icon: "grid", end: true },
      { to: "/upload", label: "Order a video", icon: "upload" },
      { to: "/dashboard/account/listings", label: "My listings", icon: "home" },
      { to: "/dashboard/account/billing", label: "Billing", icon: "dollar" },
      { to: "/dashboard/account/profile", label: "Profile", icon: "user" },
    ],
  },
];

/**
 * Operator (admin) nav — 3 sections: Operate / Studio / Business.
 *
 * Labels renamed from legacy values (Pipeline→Orders, Users→Agents,
 * Overview→Today). URLs are unchanged — no redirects needed.
 */
const OPERATOR_SECTIONS: SidebarSection[] = [
  {
    label: "Operate",
    items: [
      { to: "/dashboard", label: "Today", icon: "grid", end: true },
      { to: "/dashboard/pipeline", label: "Orders", icon: "pipeline" },
      { to: "/dashboard/properties", label: "Listings", icon: "home" },
      { to: "/dashboard/users", label: "Agents", icon: "users" },
    ],
  },
  {
    label: "Studio",
    items: [
      {
        to: "/dashboard/studio/video",
        label: "Video",
        icon: "play",
        match: (p) => p === "/dashboard/studio" || p.startsWith("/dashboard/studio/video"),
      },
      {
        to: "/dashboard/studio/blog/posts",
        label: "Blog",
        icon: "book",
        match: (p) =>
          p.startsWith("/dashboard/studio/blog") || p.startsWith("/dashboard/blog"),
      },
      {
        to: "/dashboard/studio/email/messages",
        label: "Email",
        icon: "delivered",
        match: (p) =>
          p.startsWith("/dashboard/studio/email") ||
          p.startsWith("/dashboard/blog/emails") ||
          p.startsWith("/dashboard/blog/email-templates"),
      },
    ],
  },
  {
    label: "Business",
    items: [
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

/**
 * getSections — returns the nav section set for the given role.
 * @param role "admin" for operators; anything else for agents.
 */
export function getSections(role: string | null | undefined): SidebarSection[] {
  return role === "admin" ? OPERATOR_SECTIONS : AGENT_SECTIONS;
}

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

/**
 * useUnreadCount — operator-only badge.
 *
 * Agents do not have access to /api/logs (admin-gated endpoint) and the
 * "needs_review" pipeline concept doesn't map to the agent IA. Passing
 * isAdmin=false skips both API calls entirely so agents never fire the
 * wasted round-trip to the ungated logs endpoint.
 */
function useUnreadCount(isAdmin: boolean): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!isAdmin) return; // agents: no badge, no calls
    let cancelled = false;
    (async () => {
      try {
        const [logsRes, propsRes] = await Promise.all([
          fetchLogs({ level: "warn", limit: 5 }).catch(() => ({ logs: [] as Array<{ level: string }> })),
          fetchProperties({ status: "needs_review", limit: 5 }).catch(() => ({ properties: [] as Array<unknown> })),
        ]);
        if (cancelled) return;
        const warns = (logsRes.logs ?? []).filter((l) => l.level === "warn" || l.level === "error").length;
        const reviews = (propsRes.properties ?? []).length;
        setUnread(warns + reviews);
      } catch {
        /* swallow — badge is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);
  return unread;
}

function UserMenu({
  collapsed,
  initials,
  displayName,
  email,
  isAdmin,
}: {
  collapsed: boolean;
  initials: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const unread = useUnreadCount(isAdmin);
  const isDark = theme === "dark";

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
    navigate("/dashboard/account/profile");
  };

  const handleNotifications = () => {
    setOpen(false);
    navigate("/dashboard/logs");
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
        borderRadius: "var(--le-r-lg)",
        boxShadow: "var(--shadow-lg)",
        border: "1px solid var(--line)",
        padding: 6,
        zIndex: 1100,
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleNotifications}
        style={menuItemStyle}
      >
        <Icon name="bell" size={14} />
        <span style={{ flex: 1 }}>Notifications</span>
        {unread > 0 && (
          <span
            aria-label={`${unread} unread`}
            style={{
              minWidth: 18,
              padding: "0 6px",
              height: 18,
              borderRadius: 999,
              background: "var(--warn)",
              color: "var(--surface)",
              fontSize: 10.5,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {unread}
          </span>
        )}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={isDark}
        onClick={toggleTheme}
        style={menuItemStyle}
      >
        {isDark ? <Sun size={14} strokeWidth={1.7} /> : <Moon size={14} strokeWidth={1.7} />}
        <span style={{ flex: 1 }}>{isDark ? "Light mode" : "Dark mode"}</span>
      </button>
      <div style={{ height: 1, background: "var(--line-2)", margin: "4px 6px" }} />
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
          to="/dashboard/account/profile"
          className="le-sidebar-user-avatar"
          style={{ textDecoration: "none", color: "inherit" }}
          aria-label="Account & profile"
        >
          {initials}
        </Link>
        <Link
          to="/dashboard/account/profile"
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
  borderRadius: "var(--le-r-sm)",
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
  const { user, profile } = useAuth();
  const location = useLocation();
  const isAdmin = profile?.role === "admin";
  const sections = getSections(profile?.role);
  const brandSub = isAdmin ? "Operator studio" : "Client studio";

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
            <span className="le-sidebar-brand-sub">{brandSub}</span>
          </span>
        )}
      </Link>

      <nav className="le-sidebar-nav" aria-label="Dashboard navigation">
        {sections.map((section) => (
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
          isAdmin={isAdmin}
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
