/**
 * Visualization 1: Cost — Dynamic stat card with animated bars
 * Win more listings: Listing Elevate at $65 vs $450 industry average
 * Features: animated bars, count-up numbers, check/X icons for features
 */
import { motion } from "framer-motion";
import { useInView } from "@/v2/hooks/useInView";
import { useCountUp } from "@/v2/hooks/useCountUp";
import { AnimatedCircleCheck, AnimatedCircleX } from "@/v2/components/primitives/AnimatedIcons";

const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";
const DIMMER = "var(--le-text-faint)";
const LINE = "var(--le-border)";
const CARD_BG = "var(--le-bg-elev)";

export default function CostComparison() {
  const { ref, isInView } = useInView(0.15);
  const ourPrice = useCountUp(65, 1800, isInView);
  const avgPrice = useCountUp(450, 2200, isInView);
  const savings = useCountUp(86, 2400, isInView);

  return (
    <div ref={ref} className="pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Price comparison with animated bars */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="p-8"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <div className="flex items-center justify-between mb-6">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
              Cost per listing
            </span>
            <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-1" style={{ color: WHITE, border: `1px solid ${LINE}`, background: "var(--le-bg-sunken)", borderRadius: "var(--le-radius-pill)" }}>
              Listing Elevate
            </span>
          </div>

          {/* Big number */}
          <div className="mb-8">
            <span
              className="font-bold tabular-nums block"
              style={{
                fontFamily: "var(--le-font-sans)",
                fontSize: "clamp(4rem, 12vw, 6.5rem)",
                color: WHITE,
                letterSpacing: "-0.04em",
                lineHeight: 0.85,
              }}
            >
              ${ourPrice}
            </span>
            <span className="text-[13px] mt-2 block" style={{ color: DIM }}>
              starting price
            </span>
          </div>

          {/* Animated comparison bars */}
          <div className="space-y-5">
            {/* Our bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <AnimatedCircleCheck isInView={isInView} delay={0.4} size={14} />
                  <span className="text-[12px] font-medium" style={{ color: WHITE }}>Listing Elevate</span>
                </div>
                <span className="text-[12px] font-semibold tabular-nums" style={{ color: WHITE, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>${ourPrice}</span>
              </div>
              <div className="w-full h-3" style={{ background: "var(--le-border)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={isInView ? { width: "14.4%" } : {}}
                  transition={{ duration: 1.2, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full relative"
                  style={{ background: WHITE }}
                >
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={isInView ? { opacity: 1 } : {}}
                    transition={{ delay: 1.8 }}
                    className="absolute -right-1 -top-1 w-1 h-5"
                    style={{ background: WHITE, boxShadow: "0 0 8px var(--le-border-strong)" }}
                  />
                </motion.div>
              </div>
            </div>

            {/* Industry average bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <AnimatedCircleX isInView={isInView} delay={0.7} size={14} />
                  <span className="text-[12px]" style={{ color: DIM }}>Industry average</span>
                </div>
                <span className="text-[12px] tabular-nums" style={{ color: DIM, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>${avgPrice}</span>
              </div>
              <div className="w-full h-3" style={{ background: "var(--le-border)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={isInView ? { width: "100%" } : {}}
                  transition={{ duration: 1.6, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                  style={{ background: "var(--le-text-faint)" }}
                />
              </div>
            </div>

            {/* Premium bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <AnimatedCircleX isInView={isInView} delay={0.9} size={14} />
                  <span className="text-[12px]" style={{ color: DIMMER }}>Premium videography</span>
                </div>
                <span className="text-[12px] tabular-nums" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>$1,500</span>
              </div>
              <div className="w-full h-3" style={{ background: "var(--le-border)" }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={isInView ? { width: "100%" } : {}}
                  transition={{ duration: 2.0, delay: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full"
                  style={{ background: "var(--le-border-strong)" }}
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Right: Savings + what you get */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="p-8 flex flex-col justify-between"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: DIM }}>
              Your savings
            </span>

            <div className="flex items-end gap-2 mb-2">
              <span
                className="font-bold tabular-nums"
                style={{
                  fontFamily: "var(--le-font-sans)",
                  fontSize: "clamp(4rem, 12vw, 6.5rem)",
                  color: WHITE,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.85,
                }}
              >
                {savings}%
              </span>
              <span className="text-[15px] mb-1" style={{ color: DIM }}>less</span>
            </div>
            <span className="text-[13px] block" style={{ color: DIM }}>
              than the industry average
            </span>
          </div>

          {/* What you get for $65 */}
          <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${LINE}` }}>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-4" style={{ color: DIM }}>
              Included at $65
            </span>
            <div className="space-y-3">
              {[
                "Up to 60 photos processed",
                "16:9 + 9:16 formats",
                "AI voiceover included",
                "Unlimited minor edits",
              ].map((item, i) => (
                <motion.div
                  key={item}
                  initial={{ opacity: 0, x: -6 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.8 + i * 0.1, duration: 0.3 }}
                  className="flex items-center gap-3"
                >
                  <AnimatedCircleCheck isInView={isInView} delay={0.9 + i * 0.15} size={14} />
                  <span className="text-[12px]" style={{ color: DIM }}>{item}</span>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 1.6 }}
            className="mt-6 pt-4"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <span className="text-[10px]" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
              Source: HomeJab Real Estate Videography Pricing Guide (2024)
            </span>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
