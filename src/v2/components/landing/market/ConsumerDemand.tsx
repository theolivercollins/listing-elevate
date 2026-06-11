/**
 * Visualization 4: ROI & Consumer Demand
 * 84% want more video + ROI math with animated check/X icons
 */
import { motion } from "framer-motion";
import { useInView } from "@/v2/hooks/useInView";
import { useCountUp } from "@/v2/hooks/useCountUp";
import { AnimatedCircleCheck } from "@/v2/components/primitives/AnimatedIcons";

const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";
const DIMMER = "var(--le-text-faint)";
const LINE = "var(--le-border)";
const CARD_BG = "var(--le-bg-elev)";

export default function ConsumerDemand() {
  const { ref, isInView } = useInView(0.15);
  const pct = useCountUp(84, 2000, isInView);

  return (
    <div ref={ref} className="pb-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Consumer demand card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="p-8"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: DIM }}>
            Consumer demand for video
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
              {pct}%
            </span>
          </div>
          <span className="text-[13px] block" style={{ color: DIM }}>
            of consumers want more video from brands they support
          </span>

          {/* Animated segmented bar — 10 segments, 8.4 fill */}
          <div className="mt-6 flex gap-1">
            {Array.from({ length: 10 }).map((_, i) => (
              <motion.div
                key={i}
                initial={{ scaleY: 0 }}
                animate={isInView ? { scaleY: 1 } : {}}
                transition={{
                  delay: 0.3 + i * 0.08,
                  duration: 0.4,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="flex-1 h-3 origin-bottom"
                style={{
                  background: i < 8 ? WHITE : i === 8 ? "var(--le-text-faint)" : "var(--le-border)",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] tabular-nums" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>0%</span>
            <span className="text-[9px] tabular-nums" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>100%</span>
          </div>

          {/* What this means */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.9, duration: 0.4 }}
            className="mt-6 pt-5"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <span className="text-[13px] font-medium block" style={{ color: WHITE }}>
              Your clients expect video. Listing Elevate delivers it.
            </span>
            <span className="text-[12px] block mt-1" style={{ color: DIM }}>
              Every listing, every time — keeping clients happy and coming back.
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 1.2 }}
            className="mt-5"
          >
            <span className="text-[10px]" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
              Source: Wyzowl State of Video Marketing (2026)
            </span>
          </motion.div>
        </motion.div>

        {/* Right: ROI card with animated checks */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="p-8 flex flex-col justify-between"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: DIM }}>
              The ROI math
            </span>

            <div className="flex items-end gap-2 mb-2">
              <span
                className="font-bold"
                style={{
                  fontFamily: "var(--le-font-sans)",
                  fontSize: "clamp(4rem, 12vw, 6.5rem)",
                  color: WHITE,
                  letterSpacing: "-0.04em",
                  lineHeight: 0.85,
                }}
              >
                &lt;1%
              </span>
            </div>
            <span className="text-[13px] block" style={{ color: DIM }}>
              of your commission — that's what Listing Elevate costs
            </span>
          </div>

          {/* Visual commission bar */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px]" style={{ color: DIM }}>$65 of ~$9,000 commission</span>
            </div>
            <div className="w-full h-3 relative" style={{ background: "var(--le-border)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={isInView ? { width: "0.72%" } : {}}
                transition={{ duration: 1.0, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="h-full relative"
                style={{ background: WHITE, minWidth: "4px" }}
              >
                {/* Pulse indicator */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={isInView ? { opacity: [0, 0.8, 0] } : {}}
                  transition={{ delay: 1.6, duration: 1.2, repeat: 3 }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-5"
                  style={{ background: WHITE, filter: "blur(6px)" }}
                />
              </motion.div>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5" style={{ background: WHITE }} />
                <span className="text-[10px]" style={{ color: WHITE, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>$65 Listing Elevate</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5" style={{ background: "var(--le-border)" }} />
                <span className="text-[10px]" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>~$9K commission</span>
              </div>
            </div>
          </div>

          {/* Proof points with animated checks */}
          <div className="mt-8 pt-6 space-y-3.5" style={{ borderTop: `1px solid ${LINE}` }}>
            {[
              { label: "Listing Elevate cost", value: "$65" },
              { label: "Avg. commission ($400K home)", value: "~$9,000" },
              { label: "Cost as % of return", value: "<1%" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: 8 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.8 + i * 0.12, duration: 0.35 }}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <AnimatedCircleCheck isInView={isInView} delay={0.9 + i * 0.18} size={12} />
                  <span className="text-[12px]" style={{ color: DIM }}>{item.label}</span>
                </div>
                <span className="text-[12px] font-medium tabular-nums" style={{ color: WHITE, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>{item.value}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
