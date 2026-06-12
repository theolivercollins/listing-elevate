import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { AccentDot } from "@/v2/components/primitives/AccentDot";
import { Reveal } from "@/v2/components/primitives/Reveal";

export function FounderOffer() {
  return (
    <section
      style={{
        background: "var(--le-bg-sunken)",
        color: "var(--le-text)",
        padding: "24px clamp(16px, 5vw, 48px)",
        borderTop: "1px solid var(--le-border)",
        borderBottom: "1px solid var(--le-border)",
      }}
    >
      <Reveal>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <AccentDot animated />
            <span className="le-mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--le-text-muted)" }}>
              Founding agents
            </span>
            <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 15, color: "var(--le-text)" }}>
              50% off your first three videos. First 50 signups.
            </span>
          </div>
          <LEButtonLink to="/upload" variant="primary" size="sm" className="le-cta-primary-hover">
            Claim spot →
          </LEButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
