import { motion } from "framer-motion";
import { LEIcon } from "@/v2/components/primitives/LEIcon";
import { LEButtonLink } from "@/v2/components/primitives/LEButton";
import { LECyclingWord } from "@/v2/components/primitives/LECyclingWord";
import { SiteNav } from "@/v2/components/SiteNav";
import { useLoginDialog } from "@/v2/components/auth/LoginDialogContext";
import { usePrefersReducedMotion } from "@/v2/hooks/usePrefersReducedMotion";
import { Ambient } from "@/v2/components/primitives/Ambient";

// Full-bleed luxury-interior reference — matches landing.jsx line 7.
const HERO_IMAGE =
  "https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=2400&q=85";

// Easing matches MarketComparison.tsx for site-wide motion coherence.
const EASE = [0.22, 1, 0.36, 1] as const;

// Staggered entrance — above-the-fold, so `animate` not `whileInView`.
function fadeProps(delay: number, reduced: boolean) {
  if (reduced) return { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } };
  return {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay: delay / 1000, ease: EASE },
  };
}

const PROOF_POINTS = [
  "No crew, no scheduling",
  "Human-reviewed edit",
  "16:9 + 9:16 delivered",
] as const;

/**
 * Hero — light SaaS split layout (2026-06-11).
 *
 * Structure: white section, two-column grid — copy on the left,
 * framed media card with the interior photo on the right (stacks on
 * narrow viewports via `.le-hero-grid`). No dark scrims, no
 * full-bleed background image.
 *
 * Nav lives in the shared `SiteNav` primitive (fixed at viewport top).
 */
export function Hero() {
  const { openLogin } = useLoginDialog();
  const reduced = usePrefersReducedMotion();

  return (
    <section
      style={{
        position: "relative",
        background: "var(--le-bg)",
        paddingTop: 120,
        paddingBottom: 64,
        paddingLeft: "clamp(16px, 5vw, 48px)",
        paddingRight: "clamp(16px, 5vw, 48px)",
        overflow: "hidden",
      }}
    >
      {/* Ambient layer — brand-blue aura + masked dot texture (animated, reduced-motion safe) */}
      <Ambient dots />

      {/* NAV — shared, fixed at viewport top. */}
      <SiteNav />

      {/* Split grid — copy left, media right (stacks <960px) */}
      <div className="le-hero-grid" style={{ maxWidth: 1200, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <div>

        {/* Eyebrow */}
        <motion.div {...fadeProps(0, reduced)}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: "var(--le-text-muted)",
              marginBottom: 28,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            <span
              style={{
                width: 18,
                height: 1,
                background: "var(--le-border-strong)",
                display: "inline-block",
              }}
            />
            Listing Elevate · Cinematic · On demand
          </div>
        </motion.div>

        {/* Headline */}
        <motion.div {...fadeProps(80, reduced)}>
          <h1
            style={{
              fontSize: "clamp(44px, 4.8vw, 68px)",
              lineHeight: 1.0,
              margin: 0,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              fontFamily: "var(--le-font-sans)",
              color: "var(--le-text)",
            }}
          >
            <LECyclingWord words={["Win", "Sell", "Retain"]} /> more listings.
          </h1>
        </motion.div>

        {/* Lede — one sentence */}
        <motion.div {...fadeProps(160, reduced)}>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.55,
              maxWidth: 480,
              marginTop: 28,
              color: "var(--le-text-muted)",
              fontWeight: 400,
              fontFamily: "var(--le-font-sans)",
            }}
          >
            Upload photos. Get a directed, edited, cinematic listing video back within 24&nbsp;hours.
          </p>
        </motion.div>

        {/* CTAs */}
        <motion.div {...fadeProps(240, reduced)}>
          <div
            className="le-flexcol-sm"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 28,
              marginTop: 36,
            }}
          >
            <LEButtonLink
              to="/upload"
              variant="primary"
              size="lg"
              className="le-cta-primary-hover"
            >
              Start a video <LEIcon name="arrow" size={14} color="currentColor" />
            </LEButtonLink>
            <button type="button" onClick={openLogin} className="le-cta-textlink">
              Sign in to your account
              <LEIcon name="arrowUpRight" size={12} color="currentColor" />
            </button>
          </div>
        </motion.div>

        {/* Proof-point row */}
        <motion.div {...fadeProps(320, reduced)}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            {PROOF_POINTS.map((point, i) => (
              <div key={point} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && (
                  <span
                    aria-hidden
                    style={{
                      width: 1,
                      height: 12,
                      background: "var(--le-border-strong)",
                      display: "inline-block",
                      margin: "0 16px",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--le-text-muted)",
                    fontFamily: "var(--le-font-sans)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--le-success)",
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  {point}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
        </div>

        {/* Framed media card — photo beside the copy */}
        <motion.div
          {...(reduced
            ? { initial: { opacity: 1, scale: 1 }, animate: { opacity: 1, scale: 1 } }
            : {
                initial: { opacity: 0, x: 24, scale: 0.985 },
                animate: { opacity: 1, x: 0, scale: 1 },
                transition: { duration: 0.7, delay: 0.35, ease: EASE },
              })}
          style={{
            borderRadius: 18,
            overflow: "hidden",
            aspectRatio: "4 / 3.4",
            boxShadow: "var(--le-shadow-lg)",
            border: "1px solid var(--le-border)",
            position: "relative",
          }}
        >
          <img
            src={HERO_IMAGE}
            alt="Luxury interior listing"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />

          {/* Floating stat chip — bottom-left */}
          <div
            style={{
              position: "absolute",
              bottom: 20,
              left: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              background: "rgba(255,255,255,0.96)",
              border: "1px solid var(--le-border)",
              borderRadius: 999,
              boxShadow: "var(--le-shadow-md)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--le-success)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--le-text)",
                fontFamily: "var(--le-font-sans)",
                whiteSpace: "nowrap",
              }}
            >
              Delivered in under 24 hours
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
