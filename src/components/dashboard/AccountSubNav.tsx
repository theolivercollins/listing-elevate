import { Link, useLocation } from "react-router-dom";
import type { CSSProperties } from "react";

interface Tab {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  {
    to: "/dashboard/account/profile",
    label: "Profile",
    match: (p) => p.startsWith("/dashboard/account/profile"),
  },
  {
    to: "/dashboard/account/billing",
    label: "Billing",
    match: (p) => p.startsWith("/dashboard/account/billing"),
  },
  {
    to: "/dashboard/account/listings",
    label: "Listings",
    match: (p) => p.startsWith("/dashboard/account/listings"),
  },
];

const STICKY: CSSProperties = {
  position: "sticky",
  top: 76,
  zIndex: 18,
  background: "var(--bg)",
  padding: "10px 0 12px",
  marginTop: 0,
  marginBottom: 20,
};

const WRAP: CSSProperties = {
  display: "inline-flex",
  padding: 4,
  background: "var(--line-2)",
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

export function AccountSubNav() {
  const location = useLocation();
  return (
    <div style={STICKY}>
      <nav style={WRAP} aria-label="Account sub-navigation">
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
  );
}
