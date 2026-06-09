import { Link } from "react-router-dom";

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
          <span className="le-mono" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--le-text-muted)" }}>
            Founding agents
          </span>
          <span style={{ fontFamily: "var(--le-font-sans)", fontSize: 15, color: "var(--le-text)" }}>
            50% off your first three videos. First 50 signups.
          </span>
        </div>
        <Link to="/upload" style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", padding: "8px 16px", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 4, textDecoration: "none", fontFamily: "var(--le-font-sans)", letterSpacing: "-0.005em" }}>
          Claim spot →
        </Link>
      </div>
    </section>
  );
}
