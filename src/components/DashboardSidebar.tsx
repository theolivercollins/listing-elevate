import { NavLink, useLocation, Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  GitBranch,
  Building2,
  FileText,
  DollarSign,
  Code2,
  Newspaper,
  Settings as SettingsIcon,
  Upload as UploadIcon,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";

type Item = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  match?: (pathname: string) => boolean;
};

const NAV: Item[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/dashboard/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/dashboard/properties", label: "Listings", icon: Building2 },
  { to: "/dashboard/logs", label: "Logs", icon: FileText },
  { to: "/dashboard/finances", label: "Finances", icon: DollarSign },
  {
    to: "/dashboard/development",
    label: "Development",
    icon: Code2,
    match: (p) => p.startsWith("/dashboard/development") || p.startsWith("/dashboard/rating-ledger"),
  },
  {
    to: "/dashboard/blog/posts",
    label: "Blog",
    icon: Newspaper,
    match: (p) => p.startsWith("/dashboard/blog"),
  },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

export function DashboardSidebar() {
  const location = useLocation();
  const { signOut } = useAuth();

  return (
    <aside
      className="le-dash-sidebar"
      aria-label="Dashboard navigation"
    >
      <div className="le-dash-sidebar__inner">
        {/* Brand */}
        <Link
          to="/dashboard"
          className="le-dash-sidebar__brand"
          aria-label="Listing Elevate — dashboard home"
        >
          <span className="le-dash-sidebar__brand-mark">
            <LELogoMark size={22} variant="light" />
          </span>
        </Link>

        {/* Nav rail */}
        <nav className="le-dash-sidebar__nav">
          {NAV.map((item) => {
            const active = item.match
              ? item.match(location.pathname)
              : item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={() =>
                  `le-dash-sidebar__item${active ? " le-dash-sidebar__item--active" : ""}`
                }
                aria-label={item.label}
                title={item.label}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                <span className="le-dash-sidebar__label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer — upload + sign-out */}
        <div className="le-dash-sidebar__footer">
          <Link
            to="/upload"
            className="le-dash-sidebar__item"
            aria-label="New video"
            title="New video"
          >
            <UploadIcon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            <span className="le-dash-sidebar__label">New video</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="le-dash-sidebar__item le-dash-sidebar__item--button"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
            <span className="le-dash-sidebar__label">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
