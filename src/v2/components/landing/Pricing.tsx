import { useEffect, useState } from "react";
import { getPricingTiers, type PricingTier } from "@/v2/data/pricing";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";

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
              <LEButtonLink
                to="/upload"
                variant={t.isLead ? "primary" : "ghost"}
                size="sm"
                className={t.isLead ? "le-cta-primary-hover" : "le-cta-ghost-hover"}
                style={{ width: "100%", padding: "10px 16px" }}
              >
                {t.priceUsd > 0 ? "Get started →" : "Contact sales →"}
              </LEButtonLink>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
