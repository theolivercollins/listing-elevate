import CostComparison from "@/v2/components/landing/market/CostComparison";
import MarketGap from "@/v2/components/landing/market/MarketGap";
import TurnaroundSpeed from "@/v2/components/landing/market/TurnaroundSpeed";
import ConsumerDemand from "@/v2/components/landing/market/ConsumerDemand";
import MarketDomination from "@/v2/components/landing/market/MarketDomination";
// Archived for now — the pricing calculator lives in
// `src/v2/components/landing/market/PricingCalculator.tsx` and can be
// re-mounted by adding it back below. (User request, 2026-04-21.)
// import PricingCalculator from "@/v2/components/landing/market/PricingCalculator";
import { motion } from "framer-motion";
import { Reveal } from "@/v2/components/primitives/Reveal";
import { Ambient } from "@/v2/components/primitives/Ambient";

/**
 * MarketComparison — First impression + Win / Retain / Sell stack.
 *
 * Light-SaaS refresh (2026-06): removed full-bleed hairline dividers and
 * square-dot SectionHeaders. Rhythm is now vertical spacing with pill labels
 * matching the Pricing / SelectedWork section cadence. Gutters are wrapper-
 * managed at maxWidth 1200 — children no longer carry their own px-6 sm:px-12.
 *
 * Structure:
 *   Intro block  →  standard section padding + 1200 inner column
 *   Win prong    →  pill label "Win more listings" + CostComparison + MarketGap
 *   FirstImpression plate (contained media card)
 *   Retain prong →  pill label "Retain every client" + TurnaroundSpeed + ConsumerDemand
 *   Sell prong   →  pill label "Sell faster" + MarketDomination
 */

const DIM = "var(--le-text-muted)";

// Dot colors for pill labels — tasteful semantic tokens
const DOT_WIN = "var(--le-success)";      // green
const DOT_RETAIN = "var(--le-info)";      // blue
const DOT_SELL = "var(--le-warn)";        // amber

// Luxury modern home at dusk — full-bleed backdrop for the First
// Impression plate. Same treatment as Hero + FinalCTA (brightness(0.45)
// + dark gradient) so the type stays readable.
const FIRST_IMPRESSION_IMAGE =
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2400&q=85";

// Shared gutter wrapper — padding on the full-width outer div, maxWidth on
// the inner one (same pattern as the intro block) so the prong column aligns
// exactly with the "Own your market." heading at every viewport width.
function ProngWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "0 clamp(16px, 5vw, 48px)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

// Modern pill label — replaces the old square-dot + hairline SectionHeader
function PillLabel({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <Reveal>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          borderRadius: "var(--le-radius-pill)",
          background: "var(--le-bg-elev)",
          border: "1px solid var(--le-border)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--le-text)",
          fontFamily: "var(--le-font-sans)",
          marginBottom: 32,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--le-radius-pill)",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        {label}
      </div>
    </Reveal>
  );
}

// Wide rounded media plate between the turnaround timelines and the consumer
// demand / ROI cards — visual breather inside the Retain prong. Same media
// language as FirstImpression but shorter, with a single caption line.
const ONLINE_SHOWING_IMAGE =
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=2400&q=85";

function OnlineShowingPlate() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 24,
        margin: "clamp(24px, 4vw, 48px) 0",
        aspectRatio: "21 / 7",
        minHeight: 260,
      }}
    >
      <img
        src={ONLINE_SHOWING_IMAGE}
        alt=""
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "brightness(0.8)",
        }}
      />
      {/* Bottom scrim for caption legibility */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(7,8,12,0) 45%, rgba(7,8,12,0.62) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "clamp(20px, 4vw, 48px)",
          right: "clamp(20px, 4vw, 48px)",
          bottom: "clamp(20px, 3vw, 36px)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(22px, 2.6vw, 32px)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              color: "#fff",
            }}
          >
            The first showing happens online now.
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--le-font-sans)",
              fontSize: 14,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.75)",
              maxWidth: 520,
            }}
          >
            Buyers tour your listing from their phone before they ever pick up the phone.
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FirstImpression() {
  return (
    // Outer wrapper uses prong-consistent spacing
    <div
      style={{
        padding: "clamp(40px, 8vw, 96px) clamp(16px, 5vw, 48px)",
      }}
    >
      {/* Rounded contained media plate */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 24,
          maxWidth: 1440,
          margin: "0 auto",
        }}
      >
        <img
          src={FIRST_IMPRESSION_IMAGE}
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "brightness(0.72)",
          }}
        />
        {/* Left-to-right scrim so white headline stays readable on the left */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, rgba(7,8,12,0.72) 0%, rgba(7,8,12,0.25) 60%, rgba(7,8,12,0.05) 100%)",
            pointerEvents: "none",
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "relative",
            zIndex: 2,
            maxWidth: 1200,
            margin: "0 auto",
            padding: "clamp(40px, 7vw, 96px)",
          }}
        >
          <div
            className="le-eyebrow"
            style={{ color: "rgba(255,255,255,0.78)", marginBottom: 24 }}
          >
            — First impression
          </div>
          <h2
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(40px, 5vw, 64px)",
              fontWeight: 600,
              letterSpacing: "-0.03em",
              lineHeight: 1.02,
              color: "#fff",
              margin: "0 0 32px",
              maxWidth: 980,
            }}
          >
            Your marketing is
            <br />
            your first impression.
          </h2>
          <p
            style={{
              marginTop: 0,
              fontFamily: "var(--le-font-sans)",
              fontSize: 16,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.72)",
              maxWidth: 560,
            }}
          >
            Sellers choose the agent who looks like they do more. Listing Elevate makes that agent you.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

export function MarketComparison() {
  return (
    <section
      id="compare"
      style={{
        background: "var(--le-bg)",
        color: "var(--le-text)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ── Ambient aura — softer brand-blue wash behind all content ── */}
      <Ambient intensity="softer" />

      {/* ── Intro block ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: "clamp(48px, 7vw, 88px) clamp(16px, 5vw, 48px) clamp(24px, 4vw, 48px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          style={{ maxWidth: 1200, margin: "0 auto" }}
        >
          <div className="le-eyebrow" style={{ marginBottom: 24 }}>
            — The data
          </div>
          <h2
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(40px, 5vw, 64px)",
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: "var(--le-text)",
              margin: "0 0 24px",
            }}
          >
            Own your market.
          </h2>
          <p
            style={{ color: DIM, lineHeight: 1.6, fontSize: 16, maxWidth: 640, margin: 0 }}
          >
            Here's the data behind why agents who use Listing Elevate win, retain, and sell more listings.
          </p>
        </motion.div>
      </div>

      {/* ── Win prong ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: "clamp(48px, 8vw, 96px)", position: "relative", zIndex: 1 }}>
        <ProngWrapper>
          <PillLabel label="Win more listings" dotColor={DOT_WIN} />
          <CostComparison />
          <MarketGap />
        </ProngWrapper>
      </div>

      {/* ── First impression plate ──────────────────────────────────── */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <FirstImpression />
      </div>

      {/* ── Retain prong ────────────────────────────────────────────── */}
      <div style={{ marginBottom: "clamp(48px, 8vw, 96px)", position: "relative", zIndex: 1 }}>
        <ProngWrapper>
          <PillLabel label="Retain every client" dotColor={DOT_RETAIN} />
          <TurnaroundSpeed />
          <OnlineShowingPlate />
          <ConsumerDemand />
        </ProngWrapper>
      </div>

      {/* ── Sell prong ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: "clamp(48px, 8vw, 96px)", position: "relative", zIndex: 1 }}>
        <ProngWrapper>
          <PillLabel label="Sell faster" dotColor={DOT_SELL} />
          <MarketDomination />
        </ProngWrapper>
      </div>

      {/* "The math" / PricingCalculator block archived per user request
          on 2026-04-21. Re-mount by uncommenting the PricingCalculator
          import above and restoring this block. */}
    </section>
  );
}
