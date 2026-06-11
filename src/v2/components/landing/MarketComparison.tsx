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

/**
 * MarketComparison — First impression + Win / Retain / Sell stack.
 *
 * Structure ported from the Manus "Market Intelligence" design bundle,
 * with a First-Impression full-bleed editorial plate slotted in above
 * "Retain every client." The pricing calculator ("The math") was
 * archived per user request; its component file is still on disk.
 */

const LINE = "var(--le-border)";
const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";

// Luxury modern home at dusk — full-bleed backdrop for the First
// Impression plate. Same treatment as Hero + FinalCTA (brightness(0.45)
// + dark gradient) so the type stays readable.
const FIRST_IMPRESSION_IMAGE =
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2400&q=85";

function FirstImpression() {
  return (
    // Outer wrapper provides page-rhythm padding; the inner plate is contained.
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-6 sm:px-12 py-6 flex items-center gap-3">
      <div className="w-2 h-2" style={{ background: WHITE }} />
      <span
        className="text-[12px] uppercase font-semibold"
        style={{ color: WHITE, letterSpacing: "0.2em" }}
      >
        {label}
      </span>
      <div className="flex-1 h-px ml-2" style={{ background: LINE }} />
    </div>
  );
}

export function MarketComparison() {
  return (
    <section id="compare" style={{ background: "var(--le-bg)", color: "var(--le-text)" }}>
      {/* Intro headline */}
      <div
        className="px-6 sm:px-12 pt-10 sm:pt-14 pb-10 sm:pb-14"
        style={{ borderBottom: `1px solid ${LINE}` }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-4xl"
        >
          <div
            className="le-eyebrow"
            style={{ marginBottom: 24 }}
          >
            — The data
          </div>
          <h2
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(40px, 5vw, 64px)",
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: WHITE,
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

      {/* Win */}
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <SectionHeader label="Win more listings" />
        <CostComparison />
        <MarketGap />
      </div>

      {/* First impression — editorial plate above the Retain prong */}
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <FirstImpression />
      </div>

      {/* Retain */}
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <SectionHeader label="Retain every client" />
        <TurnaroundSpeed />
        <ConsumerDemand />
      </div>

      {/* Sell */}
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <SectionHeader label="Sell faster" />
        <MarketDomination />
      </div>

      {/* "The math" / PricingCalculator block archived per user request
          on 2026-04-21. Re-mount by uncommenting the PricingCalculator
          import above and restoring this block. */}
    </section>
  );
}
