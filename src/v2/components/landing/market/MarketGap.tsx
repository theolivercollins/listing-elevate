/**
 * Visualization 2: The Opportunity Gap — Dynamic stat cards
 * 73% of sellers want video agents, only 11% offer it
 * Features: animated progress bars, count-up, animated gap arrow
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

export default function MarketGap() {
  const { ref, isInView } = useInView(0.15);
  const demand = useCountUp(73, 2000, isInView);
  const supply = useCountUp(11, 1600, isInView);
  const gap = useCountUp(62, 2400, isInView);

  return (
    <div ref={ref} className="px-6 sm:px-12 pb-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

        {/* Demand card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="p-8"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          <div className="flex items-center gap-2.5 mb-6">
            <AnimatedCircleCheck isInView={isInView} delay={0.3} size={16} />
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
              Seller demand
            </span>
          </div>

          <span
            className="font-bold tabular-nums block"
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(3.5rem, 10vw, 5.5rem)",
              color: WHITE,
              letterSpacing: "-0.04em",
              lineHeight: 0.85,
            }}
          >
            {demand}%
          </span>
          <span className="text-[12px] mt-2 block leading-relaxed" style={{ color: DIM }}>
            of sellers prefer agents who use video marketing
          </span>

          {/* Animated progress bar */}
          <div className="mt-6">
            <div className="w-full h-2" style={{ background: "var(--le-border)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={isInView ? { width: "73%" } : {}}
                transition={{ duration: 1.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="h-full relative"
                style={{ background: WHITE }}
              >
                {/* Glow pulse at the end of the bar */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={isInView ? { opacity: [0, 0.6, 0] } : {}}
                  transition={{ delay: 1.8, duration: 1.5, repeat: 2 }}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-4"
                  style={{ background: WHITE, filter: "blur(4px)" }}
                />
              </motion.div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 1.2 }}
            className="mt-4"
          >
            <span className="text-[10px]" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>
              Properties Online (2018)
            </span>
          </motion.div>
        </motion.div>

        {/* Supply card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="p-8"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          <div className="flex items-center gap-2.5 mb-6">
            <AnimatedCircleX isInView={isInView} delay={0.5} size={16} />
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
              Agent supply
            </span>
          </div>

          <span
            className="font-bold tabular-nums block"
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(3.5rem, 10vw, 5.5rem)",
              color: "var(--le-text-faint)",
              letterSpacing: "-0.04em",
              lineHeight: 0.85,
            }}
          >
            {supply}%
          </span>
          <span className="text-[12px] mt-2 block leading-relaxed" style={{ color: DIMMER }}>
            of agents actually offer video for their listings
          </span>

          {/* Tiny bar showing how small 11% is */}
          <div className="mt-6">
            <div className="w-full h-2" style={{ background: "var(--le-border)" }}>
              <motion.div
                initial={{ width: 0 }}
                animate={isInView ? { width: "11%" } : {}}
                transition={{ duration: 1.0, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
                style={{ background: "var(--le-text-faint)" }}
              />
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ delay: 1.2 }}
            className="mt-4"
          >
            <span className="text-[10px]" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>
              Properties Online (2018)
            </span>
          </motion.div>
        </motion.div>

        {/* Gap card — the opportunity */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="p-8 flex flex-col justify-between"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: WHITE }}>
              Your opportunity
            </span>

            <span
              className="font-bold tabular-nums block"
              style={{
                fontFamily: "var(--le-font-sans)",
                fontSize: "clamp(3.5rem, 10vw, 5.5rem)",
                color: WHITE,
                letterSpacing: "-0.04em",
                lineHeight: 0.85,
              }}
            >
              {gap}pt
            </span>
            <span className="text-[12px] mt-2 block leading-relaxed" style={{ color: DIM }}>
              gap between what sellers want and what agents deliver
            </span>

            {/* Animated gap visualization — two bars with arrow */}
            <div className="mt-6 relative">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2" style={{ background: "var(--le-border)" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={isInView ? { width: "100%" } : {}}
                    transition={{ duration: 1.2, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full"
                    style={{ background: WHITE }}
                  />
                </div>
                {/* Animated arrow */}
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={isInView ? { opacity: 1, scale: 1 } : {}}
                  transition={{ delay: 1.8, type: "spring", stiffness: 300 }}
                >
                  <svg width="20" height="12" viewBox="0 0 20 12" fill="none">
                    <motion.path
                      d="M0 6H16M16 6L11 1M16 6L11 11"
                      stroke={WHITE}
                      strokeWidth="1.5"
                      strokeLinecap="square"
                      initial={{ pathLength: 0 }}
                      animate={isInView ? { pathLength: 1 } : {}}
                      transition={{ duration: 0.4, delay: 2.0 }}
                    />
                  </svg>
                </motion.div>
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[9px] tabular-nums" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>11%</span>
                <span className="text-[9px] tabular-nums" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>73%</span>
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 1.2, duration: 0.4 }}
            className="mt-6 pt-5"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <span className="text-[13px] font-medium block" style={{ color: WHITE }}>
              Listing Elevate closes this gap.
            </span>
            <span className="text-[12px] block mt-1" style={{ color: DIM }}>
              Every listing gets immersive video — automatically.
            </span>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
