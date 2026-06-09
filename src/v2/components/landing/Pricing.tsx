import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPricingTiers, type PricingTier } from "@/v2/data/pricing";

export function Pricing() {
  const [tiers, setTiers] = useState<PricingTier[]>([]);

  useEffect(() => {
    getPricingTiers().then(setTiers);
  }, []);

  return (
    <section
      id="pricing"
      style={{ background: "transparent", color: "var(--le-text)", padding: "clamp(56px, 12vw, 140px) clamp(16px, 5vw, 48px)" }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="le-eyebrow" style={{ marginBottom: 24 }}>— PRICING</div>
        <h2 className="le-display" style={{ fontSize: "clamp(44px, 5.5vw, 76px)", lineHeight: 0.98, margin: "0 0 64px", color: "var(--le-text)" }}>
          Priced per listing.
        </h2>
        <div className="le-pricing-grid">
          {tiers.map(t => (
            <div
              key={t.id}
              style={{
                padding: 32,
                background: "var(--le-bg-elev)",
                border: `1px solid ${t.isLead ? "var(--le-border-strong)" : "var(--le-border)"}`,
                borderRadius: 2,
              }}
            >
              <div className="le-eyebrow" style={{ marginBottom: 12 }}>{t.name}</div>
              <div className="le-display" style={{ fontSize: 56, lineHeight: 1, marginBottom: 8, color: "var(--le-text)" }}>
                {t.priceUsd > 0 ? `$${t.priceUsd.toLocaleString()}` : "Talk"}
              </div>
              <div style={{ fontSize: 14, color: "var(--le-text-muted)", marginBottom: 24 }}>{t.tagline}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px", display: "flex", flexDirection: "column", gap: 8 }}>
                {t.features.map(f => (
                  <li key={f} style={{ fontSize: 14, color: "var(--le-text-muted)", fontFamily: "var(--le-font-sans)" }}>
                    — {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/upload"
                style={t.isLead ? {
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: "100%", padding: "10px 16px", fontSize: 13, fontWeight: 500,
                  background: "var(--le-accent)", color: "var(--le-accent-fg)", borderRadius: 4,
                  textDecoration: "none", fontFamily: "var(--le-font-sans)", letterSpacing: "-0.005em",
                } : {
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: "100%", padding: "10px 16px", fontSize: 13, fontWeight: 500,
                  background: "transparent", color: "var(--le-text)", borderRadius: 4,
                  border: "1px solid var(--le-border-strong)",
                  textDecoration: "none", fontFamily: "var(--le-font-sans)", letterSpacing: "-0.005em",
                }}
              >
                {t.priceUsd > 0 ? "Get started →" : "Contact sales →"}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
