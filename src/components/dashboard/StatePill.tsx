// src/components/dashboard/StatePill.tsx
//
// Shared state pill for dashboard list/detail pages (Blog + Email).
// Extracted from the byte-identical implementations in BlogPostsList.tsx and
// EmailsList.tsx — rendered output is pixel-identical to the blog-side
// original. Takes a color-map prop so each surface supplies its own states.

export interface StatePillSpec {
  label: string;
  color: string;
  bg: string;
}

export type StatePillMap = Record<string, StatePillSpec>;

export const BLOG_STATE_PILL_MAP: StatePillMap = {
  live:              { label: "Live",        color: "var(--good)",   bg: "rgba(47,138,85,0.10)"  },
  awaiting_approval: { label: "Draft",       color: "var(--warn)",   bg: "rgba(182,128,44,0.10)" },
  on_hold:           { label: "On hold",     color: "var(--muted)",  bg: "rgba(11,11,16,0.06)"   },
  quarantined:       { label: "Quarantined", color: "var(--bad)",    bg: "rgba(196,74,74,0.10)"  },
};

export const EMAIL_STATE_PILL_MAP: StatePillMap = {
  draft:   { label: "Draft",   color: "var(--warn)",  bg: "rgba(182,128,44,0.10)" },
  ready:   { label: "Ready",   color: "var(--ink-2)", bg: "rgba(15,24,60,0.06)"   },
  sending: { label: "Sending", color: "var(--warn)",  bg: "rgba(182,128,44,0.10)" },
  sent:    { label: "Sent",    color: "var(--good)",  bg: "rgba(47,138,85,0.10)"  },
  failed:  { label: "Failed",  color: "var(--bad)",   bg: "rgba(196,74,74,0.10)"  },
};

export function StatePill({ state, map }: { state: string; map: StatePillMap }) {
  const s = map[state] ?? { label: state, color: "var(--muted)", bg: "rgba(11,11,16,0.06)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        background: s.bg,
        color: s.color,
        fontFamily: "var(--le-font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: s.color,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
}
