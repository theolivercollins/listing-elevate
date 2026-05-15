import { Outlet, Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "@/v2/styles/v2.css";
import { DashboardSidebar, useDashboardSidebar } from "@/components/DashboardSidebar";
import { Icon } from "@/components/dashboard/icons";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useAuth } from "@/lib/auth";
import { fetchLogs, fetchProperties } from "@/lib/api";

interface Notification {
  id: string;
  title: string;
  sub: string;
  time: string;
  level: "info" | "warn" | "error" | "success";
  href?: string;
}

function fmtAgo(d: Date): string {
  const m = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function useNotifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [logsRes, propsRes] = await Promise.all([
          fetchLogs({ level: "warn", limit: 5 }).catch(() => ({ logs: [] as Array<{ id?: string; timestamp?: string; created_at?: string; level: string; message: string; stage?: string; property_id?: string }> })),
          fetchProperties({ status: "needs_review", limit: 5 }).catch(() => ({ properties: [] as Array<{ id: string; address: string; updated_at: string }> })),
        ]);
        if (cancelled) return;
        const out: Notification[] = [];
        for (const p of propsRes.properties ?? []) {
          out.push({
            id: "prop_" + p.id,
            title: "Manual review needed",
            sub: p.address,
            time: fmtAgo(new Date(p.updated_at)),
            level: "warn",
            href: `/dashboard/properties/${p.id}`,
          });
        }
        for (const l of logsRes.logs ?? []) {
          const ts = l.timestamp ?? l.created_at;
          if (!ts) continue;
          out.push({
            id: "log_" + (l.id ?? `${ts}-${l.message.slice(0, 16)}`),
            title: (l.stage ?? l.level).replace(/_/g, " "),
            sub: l.message,
            time: fmtAgo(new Date(ts)),
            level: l.level === "error" ? "error" : l.level === "warn" ? "warn" : "info",
            href: l.property_id ? `/dashboard/properties/${l.property_id}` : "/dashboard/logs",
          });
        }
        setItems(out.slice(0, 8));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return { items, loading, unread: items.filter((i) => i.level === "warn" || i.level === "error").length };
}

function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { items, loading, unread } = useNotifications();
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="le-top-iconbtn"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && <span className="le-dot-badge" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: 360,
            maxHeight: 440,
            background: "var(--surface)",
            borderRadius: 16,
            boxShadow: "var(--shadow-lg)",
            border: "1px solid var(--line)",
            zIndex: 80,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--line-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Notifications</span>
            <Link
              to="/dashboard/logs"
              onClick={() => setOpen(false)}
              style={{ fontSize: 11.5, color: "var(--muted)", textDecoration: "none" }}
            >
              View all
            </Link>
          </div>
          <div style={{ overflowY: "auto", maxHeight: 380 }}>
            {loading && (
              <div style={{ padding: 18, fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
                Loading…
              </div>
            )}
            {!loading && items.length === 0 && (
              <div style={{ padding: 24, fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
                All clear — no notifications.
              </div>
            )}
            {items.map((n) => {
              const dot =
                n.level === "error"
                  ? "var(--bad)"
                  : n.level === "warn"
                  ? "var(--warn)"
                  : n.level === "success"
                  ? "var(--good)"
                  : "var(--muted-2)";
              const body = (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "8px 1fr auto",
                    gap: 10,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--line-2)",
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: dot, marginTop: 6 }} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        textTransform: "capitalize",
                      }}
                    >
                      {n.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        marginTop: 2,
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {n.sub}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted-2)", whiteSpace: "nowrap" }}>{n.time}</span>
                </div>
              );
              if (n.href) {
                return (
                  <Link
                    key={n.id}
                    to={n.href}
                    onClick={() => setOpen(false)}
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {body}
                  </Link>
                );
              }
              return <div key={n.id}>{body}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardTopBar() {
  return (
    <header className="le-top-bar">
      <div className="le-top-search">
        <Icon name="search" size={15} style={{ color: "var(--muted)" }} />
        <input placeholder="Search listings, agents, prompts…" aria-label="Search" />
        <span className="le-top-search-kbd">⌘K</span>
      </div>
      <div style={{ flex: 1 }} />
      <div className="le-top-actions">
        <NotificationsButton />
        <ThemeToggle />
      </div>
    </header>
  );
}

function useAuthGuard() {
  // currently unused but kept so future top-bar widgets can re-add user controls without re-wiring
  return useAuth();
}

const Dashboard = () => {
  const [collapsed, setCollapsed] = useDashboardSidebar();
  useAuthGuard();
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

export { Link };
