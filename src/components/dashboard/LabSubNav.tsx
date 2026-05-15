import { Link, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";

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

const WRAP: CSSProperties = {
  display: "inline-flex",
  padding: 4,
  background: "rgba(11,11,16,0.04)",
  borderRadius: 999,
  marginBottom: 24,
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

export function LabSubNav() {
  const location = useLocation();
  return (
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
  );
}
