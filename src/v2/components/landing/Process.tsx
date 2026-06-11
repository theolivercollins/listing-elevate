import { Reveal } from "@/v2/components/primitives/Reveal";
import { Section } from "@/v2/components/landing/Section";

// Exact image URLs from landing.jsx (IMG_SHOWCASE_1/2/3).
const IMG_SHOWCASE_1 =
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1600&q=80";
const IMG_SHOWCASE_2 =
  "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=80";
const IMG_SHOWCASE_3 =
  "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1600&q=80";

interface Step {
  n: string;
  title: string;
  body: string;
  img: string;
}

const STEPS: Step[] = [
  {
    n: "01",
    title: "Upload",
    body: "Drop 20–60 photos. We handle exposure, orientation, and metadata. Takes a minute.",
    img: IMG_SHOWCASE_1,
  },
  {
    n: "02",
    title: "Direct",
    body: "Our model scripts the shot plan — camera work, room order, voice, and mood.",
    img: IMG_SHOWCASE_2,
  },
  {
    n: "03",
    title: "Deliver",
    body: "A human editor reviews. You receive 16:9 and 9:16 cuts, ready to broadcast.",
    img: IMG_SHOWCASE_3,
  },
];

/**
 * Process — SaaS-style step cards on a tinted band (WS1+WS2+WS3, 2026-06-11).
 *
 * Cards: white on the tinted surface (#f4f6fb), radius 18, border + shadow-sm,
 * le-card-lift hover. Step number chip replaces the old "01 / 03" text.
 */
export function Process() {
  return (
    <Section
      id="process"
      eyebrow="— The Process"
      title="Three steps. One day."
      tint
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 24,
        }}
      >
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.12}>
            <div
              className="le-card-lift"
              style={{
                padding: 28,
                background: "var(--le-surface-card, #fff)",
                border: "1px solid var(--le-border)",
                borderRadius: 18,
                boxShadow: "var(--le-shadow-sm)",
                display: "flex",
                flexDirection: "column",
                gap: 24,
                height: "100%",
              }}
            >
              {/* Step number chip */}
              <div
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "1px solid var(--le-border-strong)",
                  background: "var(--le-surface-card, #fff)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--le-font-sans)",
                  color: "var(--le-text)",
                  flexShrink: 0,
                }}
              >
                {s.n}
              </div>

              {/* Property image */}
              <div
                className="le-img-zoom"
                style={{
                  width: "100%",
                  aspectRatio: "4 / 3",
                  overflow: "hidden",
                  background: "var(--le-bg-sunken)",
                  borderRadius: 12,
                }}
              >
                <img
                  src={s.img}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              </div>

              {/* Text */}
              <div>
                <h3
                  style={{
                    fontSize: 24,
                    margin: 0,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    lineHeight: 1,
                    fontFamily: "var(--le-font-sans)",
                    color: "var(--le-text)",
                  }}
                >
                  {s.title}
                </h3>
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--le-text-muted)",
                    fontFamily: "var(--le-font-sans)",
                    margin: "12px 0 0",
                  }}
                >
                  {s.body}
                </p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
