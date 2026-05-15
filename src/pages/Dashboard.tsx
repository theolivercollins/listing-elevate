import { Outlet, Link } from "react-router-dom";
import { Search, Bell, HelpCircle, User } from "lucide-react";
import "@/v2/styles/v2.css";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useAuth } from "@/lib/auth";

function DashboardTopBar() {
  const { user } = useAuth();
  const initial = user?.email?.[0]?.toUpperCase() ?? "U";
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 md:px-10">
      <div
        className="hidden h-10 w-full max-w-[420px] items-center gap-2 rounded-full border border-border bg-card px-4 md:flex"
        style={{ boxShadow: "var(--le-card-shadow)" }}
      >
        <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        <input
          type="search"
          placeholder="Search listings, agents, or jobs…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
          <span
            className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--le-tile-rose-ink)" }}
          />
        </button>
        <ThemeToggle />
        <Link
          to="/account"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-foreground transition hover:bg-muted"
          aria-label="Account"
          title={user?.email ?? "Account"}
        >
          {initial ? initial : <User className="h-4 w-4" />}
        </Link>
      </div>
    </div>
  );
}

const Dashboard = () => {
  return (
    <div
      className="le-root le-dash-shell"
      style={{
        color: "var(--le-text)",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <DashboardSidebar />
      <div className="le-dash-main">
        <DashboardTopBar />
        <main className="mx-auto w-full max-w-[1440px] px-6 pb-12 pt-2 md:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
