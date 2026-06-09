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
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "clamp(56px, 12vw, 140px) clamp(16px, 5vw, 48px)",
        background: "#000",
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
          filter: "brightness(0.5) saturate(1.05)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, rgba(5,7,14,0.78) 0%, rgba(5,7,14,0.35) 55%, rgba(5,7,14,0.15) 100%)",
          pointerEvents: "none",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        style={{ position: "relative", zIndex: 2, maxWidth: 1200, margin: "0 auto" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
          }}
        >
          <div style={{ width: 20, height: 1, background: "#fff" }} />
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.78)",
              fontFamily: "var(--le-font-sans)",
            }}
          >
            First impression
          </span>
        </div>
        <h2
          style={{
            fontFamily: "var(--le-font-sans)",
            fontSize: "clamp(3rem, 8vw, 7rem)",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            lineHeight: 0.94,
            color: "#fff",
            margin: 0,
            maxWidth: 980,
          }}
        >
          Your marketing is
          <br />
          your first impression.
        </h2>
        <p
          style={{
            marginTop: 32,
            fontFamily: "var(--le-font-sans)",
            fontSize: 18,
            lineHeight: 1.55,
            color: "rgba(255,255,255,0.72)",
            maxWidth: 560,
          }}
        >
          Sellers choose the agent who looks like they do more. Listing Elevate makes that agent you.
        </p>
      </motion.div>
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
          <div className="flex items-center gap-3 mb-6">
            <div className="w-5 h-px" style={{ background: WHITE }} />
            <span
              className="text-[11px] uppercase"
              style={{ color: DIM, letterSpacing: "0.22em" }}
            >
              The data
            </span>
          </div>
          <h2
            className="font-bold leading-[0.94] mb-6"
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(2.6rem, 7vw, 5.2rem)",
              color: WHITE,
              letterSpacing: "-0.035em",
            }}
          >
            Own your market.
          </h2>
          <p
            className="text-[15px] sm:text-[17px] max-w-2xl"
            style={{ color: DIM, lineHeight: 1.6 }}
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
