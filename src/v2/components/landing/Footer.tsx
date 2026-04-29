import { LELogoMark } from "@/v2/components/primitives/LELogoMark";

/**
 * Footer — pixel-faithful port of landing.jsx lines 582-606.
 *
 * Uses inert <span>s for the link list (matching the design) because
 * the legal/route targets (/terms, /privacy) do not exist in this
 * shell. Left slot holds the white logo mark for the dark background.
 */
export function Footer() {
  return (
    <footer
      style={{
        padding: "40px 48px",
        borderTop: "1px solid var(--le-border)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 12,
        color: "var(--le-text-muted)",
        fontFamily: "var(--le-font-sans)",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <LELogoMark size={14} variant="light" />
      </div>
      <div style={{ display: "flex", gap: 28 }}>
        <span>Process</span>
        <span>Showcase</span>
        <span>Pricing</span>
        <span>FAQ</span>
        <span>Terms</span>
        <span>Privacy</span>
      </div>
      <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 11 }}>
        © 2026 Listing Elevate, Inc.
      </span>
    </footer>
  );
}
