import { Link, Outlet, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";

interface Tab {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    to: "/dashboard/studio/video",
    label: "Video",
    match: (p) => p.startsWith("/dashboard/studio/video"),
  },
  {
    to: "/dashboard/studio/blog/posts",
    label: "Blog",
    match: (p) => p.startsWith("/dashboard/studio/blog"),
  },
  {
    to: "/dashboard/studio/email/messages",
    label: "Email",
    match: (p) => p.startsWith("/dashboard/studio/email"),
  },
];

const STICKY: CSSProperties = {
  position: "sticky",
  top: 76,
  zIndex: 18,
  background: "var(--bg)",
  padding: "10px 0 12px",
  marginTop: -12,
  marginBottom: 4,
};

const WRAP: CSSProperties = {
  display: "inline-flex",
  padding: 4,
  background: "rgba(11,11,16,0.04)",
  borderRadius: 999,
};

const ITEM_BASE: CSSProperties = {
  padding: "7px 14px",
  borderRadius: 999,
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "background .15s, color .15s",
};

export function StudioLayout() {
  const location = useLocation();
  return (
    <>
      <div style={STICKY}>
        <nav style={WRAP} aria-label="Studio sub-navigation">
          {TABS.map((t) => {
            const active = t.match(location.pathname);
            return (
              <Link
                key={t.to}
                to={t.to}
                style={{
                  ...ITEM_BASE,
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--surface)" : "var(--muted)",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </>
  );
}
