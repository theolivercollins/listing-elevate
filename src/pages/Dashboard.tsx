import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import "@/v2/styles/v2.css";
import { DashboardSidebar, useDashboardSidebar } from "@/components/DashboardSidebar";
import { Icon } from "@/components/dashboard/icons";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useAuth } from "@/lib/auth";

interface TitleMeta {
  eyebrow?: string;
  title: string;
}

const PAGE_TITLES: Array<{ match: RegExp; title: TitleMeta }> = [
  { match: /^\/dashboard\/?$/, title: { eyebrow: "Studio · today", title: "Studio overview" } },
  { match: /^\/dashboard\/pipeline/, title: { eyebrow: "Live · auto-refresh 10s", title: "Pipeline" } },
  { match: /^\/dashboard\/properties/, title: { eyebrow: "Listings", title: "All listings" } },
  { match: /^\/dashboard\/users/, title: { eyebrow: "Workspace · Recasi", title: "Users" } },
  { match: /^\/dashboard\/finances/, title: { eyebrow: "All providers", title: "Finances" } },
  { match: /^\/dashboard\/logs/, title: { eyebrow: "Last 24 hours", title: "Pipeline logs" } },
  { match: /^\/dashboard\/development\/prompt-lab\/recipes/, title: { eyebrow: "Lab", title: "Recipe library" } },
  { match: /^\/dashboard\/development\/prompt-lab/, title: { eyebrow: "Lab", title: "Prompt lab" } },
  { match: /^\/dashboard\/development\/proposals/, title: { eyebrow: "Lab", title: "Prompt proposals" } },
  { match: /^\/dashboard\/development\/system-status/, title: { eyebrow: "Infrastructure", title: "System status" } },
  { match: /^\/dashboard\/development/, title: { eyebrow: "Lab", title: "Development" } },
  { match: /^\/dashboard\/rating-ledger/, title: { eyebrow: "Lab", title: "Rating ledger" } },
  { match: /^\/dashboard\/blog\/templates/, title: { eyebrow: "Content", title: "Blog templates" } },
  { match: /^\/dashboard\/blog\/images/, title: { eyebrow: "Content", title: "Image library" } },
  { match: /^\/dashboard\/blog/, title: { eyebrow: "Content", title: "Blog studio" } },
  { match: /^\/dashboard\/settings/, title: { eyebrow: "Workspace", title: "Settings" } },
];

function resolveTitle(pathname: string): TitleMeta {
  for (const entry of PAGE_TITLES) {
    if (entry.match.test(pathname)) return entry.title;
  }
  return { eyebrow: "Dashboard", title: "Listing Elevate" };
}

function DashboardTopBar() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const titleMeta = useMemo(() => resolveTitle(location.pathname), [location.pathname]);
  const stackColors = ["#9aa3b5", "#7a8499", "#5a6478", "#3a4458"];

  return (
    <header className="le-top-bar">
      <div className="le-top-bar-title">
        {titleMeta.eyebrow && <div className="le-top-eyebrow">{titleMeta.eyebrow}</div>}
        <div className="le-top-title">{titleMeta.title}</div>
      </div>
      <div style={{ flex: 1 }} />
      <div className="le-top-search">
        <Icon name="search" size={15} style={{ color: "var(--muted)" }} />
        <input placeholder="Search listings, agents, prompts…" aria-label="Search" />
        <span className="le-top-search-kbd">⌘K</span>
      </div>
      <div className="le-top-actions">
        <div className="le-avatar-stack" aria-hidden>
          {stackColors.map((c) => (
            <div key={c} className="le-stack-avatar" style={{ background: c }} />
          ))}
          <div className="le-stack-avatar is-more">+5</div>
        </div>
        <button type="button" className="le-top-iconbtn" title="Notifications" aria-label="Notifications">
          <Icon name="bell" size={16} />
          <span className="le-dot-badge" />
        </button>
        <ThemeToggle />
        <button
          type="button"
          className="le-cta-primary"
          onClick={() => navigate("/upload")}
          title={user?.email ?? "New listing"}
        >
          <Icon name="plus" size={14} />
          New listing
        </button>
      </div>
    </header>
  );
}

const Dashboard = () => {
  const [collapsed, setCollapsed] = useDashboardSidebar();
  return (
    <div className={`le-root le-dash-shell${collapsed ? " is-collapsed" : ""}`}>
      <DashboardSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} />
      <div className="le-dash-main">
        <DashboardTopBar />
        <main className="le-main-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

// Re-export Link for downstream pages that need the dashboard shell context
export { Link };
