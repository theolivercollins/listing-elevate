import { Link, useLocation } from "react-router-dom";
import type { CSSProperties, ReactNode } from "react";

interface Tab {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    to: "/dashboard/development/prompt-lab",
    label: "Prompts",
    match: (p) =>
      p === "/dashboard/development/prompt-lab" ||
      /^\/dashboard\/development\/prompt-lab\/(?!recipes)[^/]+$/.test(p),
  },
  {
    to: "/dashboard/development/prompt-lab/recipes",
    label: "Recipes",
    match: (p) => p.startsWith("/dashboard/development/prompt-lab/recipes"),
  },
  {
    to: "/dashboard/development/proposals",
    label: "Proposals",
    match: (p) => p.startsWith("/dashboard/development/proposals"),
  },
  {
    to: "/dashboard/rating-ledger",
    label: "Rating ledger",
    match: (p) => p.startsWith("/dashboard/rating-ledger"),
  },
  {
    to: "/dashboard/development/learning",
    label: "Learning",
    match: (p) => p.startsWith("/dashboard/development/learning"),
  },
];

// Render the sub-nav above the PageHeading so its Y position is constant
// across all Lab pages (otherwise the nav appears to "bounce" because each
// page has a different PageHeading height). Sticks to the very top of the
// main scroll area so it stays visible while scrolling — the dashboard
// top bar was removed in the profile-menu rework so top:0 is the right
// anchor now (was top:76 from the old fixed top-bar era).
const STICKY: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 18,
  background: "var(--bg)",
  padding: "12px 0 12px",
  marginTop: -24,           // bleed back into the page padding so the row sits flush at the top
  marginBottom: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const WRAP: CSSProperties = {
  display: "inline-flex",
  padding: 4,
  background: "rgba(11,11,16,0.04)",
  borderRadius: "var(--radius-pill)",
};

const ITEM_BASE: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "var(--radius-pill)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "background .15s, color .15s",
};

export function LabSubNav({ rightSlot }: { rightSlot?: ReactNode } = {}) {
  const location = useLocation();
  return (
    <div style={STICKY}>
      <nav style={WRAP} aria-label="Lab sub-navigation">
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
      {rightSlot != null && <div style={{ flexShrink: 0 }}>{rightSlot}</div>}
    </div>
  );
}
