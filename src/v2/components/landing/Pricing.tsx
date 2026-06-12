import { useEffect, useState } from "react";
import { getPricingTiers, type PricingTier } from "@/v2/data/pricing";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { Reveal } from "@/v2/components/primitives/Reveal";
import { Section } from "@/v2/components/landing/Section";

// Inline SVG check — 14px, stroke var(--le-text-muted). No extra deps.
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ flexShrink: 0, marginTop: 2 }}
    >
      <polyline
        points="2,7 6,11 12,4"
        stroke="var(--le-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Pricing() {
  const [tiers, setTiers] = useState<PricingTier[]>([]);

  useEffect(() => {
    getPricingTiers().then(setTiers);
  }, []);

  return (
    <Section
      id="pricing"
      eyebrow="— PRICING"
      title="Priced per listing."
      tint
      ambient="softer"
    >
      <div className="le-pricing-grid">
        {tiers.map((t, i) => (
          <Reveal key={t.id} delay={0.1 + i * 0.1}>
            <div
              className="le-card-lift"
              style={{
                position: "relative",
                padding: 32,
                paddingTop: t.isLead ? 44 : 32,
                background: "var(--le-surface-card, #fff)",
                border: t.isLead
                  ? "1px solid var(--le-border-strong)"
                  : "1px solid var(--le-border)",
                borderRadius: "var(--le-r-lg)",
                boxShadow: t.isLead ? "var(--le-shadow-md)" : undefined,
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              {/* "Most popular" badge — classic SaaS tier cue */}
              {t.isLead && (
                <div
                  style={{
                    position: "absolute",
                    top: -12,
                    left: 24,
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: "var(--le-accent)",
                    color: "var(--le-accent-fg)",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontFamily: "var(--le-font-sans)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Most popular
                </div>
              )}

              <div className="le-eyebrow" style={{ marginBottom: 12 }}>
                {t.name}
              </div>
              <div
                className="le-display"
                style={{
                  fontSize: 56,
                  lineHeight: 1,
                  marginBottom: 8,
                  color: "var(--le-text)",
                }}
              >
                {t.priceUsd > 0 ? `$${t.priceUsd.toLocaleString()}` : "Talk"}
              </div>
              <div
                style={{
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "var(--le-text-muted)",
                  marginBottom: 24,
                }}
              >
                {t.tagline}
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 0 32px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {t.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "var(--le-text-muted)",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    <CheckIcon />
                    {f}
                  </li>
                ))}
              </ul>
              <LEButtonLink
                to="/upload"
                variant={t.isLead ? "primary" : "ghost"}
                size="sm"
                className={t.isLead ? "le-cta-primary-hover" : "le-cta-ghost-hover"}
                style={{ width: "100%", marginTop: "auto" }}
              >
                {t.priceUsd > 0 ? "Get started →" : "Contact sales →"}
              </LEButtonLink>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
