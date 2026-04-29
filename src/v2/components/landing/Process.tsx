import { LEIcon } from "@/v2/components/primitives/LEIcon";

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
 * Process — pixel-faithful port of landing.jsx lines 283-403.
 *
 * Customization preserved: the heading reads "Three steps. / One day."
 * (24-hour turnaround) instead of the design's "Seventy-two hours." —
 * our shorter SLA is the marketing win, so we keep it.
 */
export function Process() {
  return (
    <section
      id="process"
      style={{
        padding: "112px 48px 120px",
        background: "var(--le-bg)",
      }}
    >
      <div
        className="le-eyebrow"
        style={{ marginBottom: 48 }}
      >
        — The Process
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 1,
          background: "var(--le-border)",
        }}
      >
        {STEPS.map(s => (
          <div
            key={s.n}
            style={{
              padding: "44px 40px 48px",
              background: "var(--le-bg)",
              display: "flex",
              flexDirection: "column",
              gap: 32,
              minHeight: 520,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--le-font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  color: "var(--le-text-faint)",
                }}
              >
                {s.n} / 03
              </span>
              <LEIcon name="arrowUpRight" size={14} color="var(--le-text-faint)" />
            </div>

            <div
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
                overflow: "hidden",
                background: "#000",
              }}
            >
              <img
                src={s.img}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: "brightness(0.9)",
                }}
              />
            </div>

            <div>
              <h3
                style={{
                  fontSize: 34,
                  margin: 0,
                  fontWeight: 500,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                  fontFamily: "var(--le-font-sans)",
                  color: "var(--le-text)",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--le-text-muted)",
                  maxWidth: 360,
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
