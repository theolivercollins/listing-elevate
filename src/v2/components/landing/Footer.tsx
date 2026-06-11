import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { Reveal } from "@/v2/components/primitives/Reveal";

/**
 * Footer — light SaaS redesign (2026-06-11).
 *
 * Content wrapped in maxWidth 1200 with shared horizontal gutters so the
 * left edge aligns with every Section above it.
 */
export function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--le-border)",
        padding: "0 clamp(16px, 5vw, 48px)",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Reveal
          delay={0}
          style={{
            padding: "clamp(32px, 6vw, 40px) 0",
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
            <LELogoMark size={14} variant="dark" />
          </div>
          <div className="le-flexwrap-sm" style={{ display: "flex", gap: 28 }}>
            <a href="#process" style={{ color: "inherit", textDecoration: "none" }}>
              Process
            </a>
            <a href="#showcase" style={{ color: "inherit", textDecoration: "none" }}>
              Showcase
            </a>
            <a href="#pricing" style={{ color: "inherit", textDecoration: "none" }}>
              Pricing
            </a>
            <a href="#faq" style={{ color: "inherit", textDecoration: "none" }}>
              FAQ
            </a>
            <span>Terms</span>
            <span>Privacy</span>
          </div>
          <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 11 }}>
            © 2026 Listing Elevate, Inc.
          </span>
        </Reveal>
      </div>
    </footer>
  );
}
