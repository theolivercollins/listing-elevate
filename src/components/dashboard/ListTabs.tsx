// src/components/dashboard/ListTabs.tsx
//
// Shared tab-pill row for dashboard list pages (Blog + Email).
// Extracted from the byte-identical `tabBtnBase` implementations in
// BlogPostsList.tsx and EmailsList.tsx — rendered output is pixel-identical
// to the blog-side original.

import type { CSSProperties } from "react";

const tabBtnBase: CSSProperties = {
  padding: "8px 14px",
  borderRadius: "var(--radius-pill)",
  border: "none",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  transition: "background .2s",
  fontFamily: "var(--le-font-sans)",
};

export interface ListTabFilter<V extends string> {
  label: string;
  value: V;
}

export function ListTabs<V extends string>({
  filters,
  active,
  counts,
  onChange,
}: {
  filters: Array<ListTabFilter<V>>;
  active: V;
  counts: Record<V, number>;
  onChange: (value: V) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {filters.map(f => {
        const isActive = active === f.value;
        return (
          <button
            key={f.value}
            type="button"
            onClick={() => onChange(f.value)}
            style={{
              ...tabBtnBase,
              background: isActive ? "var(--ink)" : "transparent",
              color:      isActive ? "var(--surface)" : "var(--muted)",
            }}
          >
            {f.label}
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: "var(--radius-pill)",
                background: isActive ? "rgba(255,255,255,0.18)" : "rgba(15,24,60,0.05)",
              }}
            >
              {counts[f.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
