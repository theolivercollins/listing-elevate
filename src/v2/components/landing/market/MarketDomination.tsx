/**
 * Visualization 5: Own Your Market — Seller FOMO
 * Animated check/X comparison (BonnieBoard-style draw-in)
 * Scroll-triggered flywheel + annual math
 */
import { motion } from "framer-motion";
import { useInView } from "@/v2/hooks/useInView";
import { AnimatedCircleCheck, AnimatedCircleX } from "@/v2/components/primitives/AnimatedIcons";

const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";
const DIMMER = "var(--le-text-faint)";
const LINE = "var(--le-border)";
const CARD_BG = "var(--le-bg-elev)";

export default function MarketDomination() {
  const { ref, isInView } = useInView(0.1);

  return (
    <div ref={ref} className="pb-10">

      {/* Top row: How it works — 3 step cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
        {[
          {
            step: "01",
            title: "They see your listings",
            desc: "Listing Elevate content appears in their feed — immersive, branded, impossible to scroll past.",
          },
          {
            step: "02",
            title: "They compare agents",
            desc: "Their neighbor's agent used static photos. You used Listing Elevate. The difference is visceral.",
          },
          {
            step: "03",
            title: "They call you first",
            desc: "When it's time to sell, they already know who does more. You're the obvious choice.",
          },
        ].map((item, i) => (
          <motion.div
            key={item.step}
            initial={{ opacity: 0, y: 16 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.55, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="p-8"
            style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
          >
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-4" style={{ color: DIMMER, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
              {item.step}
            </span>
            <span className="text-[15px] font-semibold block mb-3" style={{ color: WHITE }}>
              {item.title}
            </span>
            <span className="text-[12px] block leading-relaxed" style={{ color: DIM }}>
              {item.desc}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Bottom row: Comparison + Flywheel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Side-by-side perception with animated checks/X */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="p-8"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: DIM }}>
            What sellers see
          </span>

          <div className="grid grid-cols-2 gap-6">
            {/* With Listing Elevate */}
            <div>
              <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-1 inline-block mb-5" style={{ color: WHITE, border: `1px solid ${LINE}`, background: "var(--le-bg-sunken)", borderRadius: 999 }}>
                With Listing Elevate
              </span>
              <div className="space-y-4">
                {[
                  "Immersive AI video tour",
                  "Engineered for retention",
                  "Social-ready content",
                  "Retargeted to sellers",
                ].map((item, i) => (
                  <motion.div
                    key={item}
                    initial={{ opacity: 0, x: -8 }}
                    animate={isInView ? { opacity: 1, x: 0 } : {}}
                    transition={{ delay: 0.6 + i * 0.12, duration: 0.35 }}
                    className="flex items-center gap-3"
                  >
                    <AnimatedCircleCheck isInView={isInView} delay={0.7 + i * 0.15} size={16} />
                    <span className="text-[12px]" style={{ color: DIM }}>{item}</span>
                  </motion.div>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ delay: 1.5 }}
                className="mt-5 pt-3"
                style={{ borderTop: `1px solid ${LINE}` }}
              >
                <span className="text-[10px] tracking-[0.1em] uppercase font-medium" style={{ color: WHITE }}>
                  Perceived effort: Maximum
                </span>
              </motion.div>
            </div>

            {/* Without */}
            <div>
              <span className="text-[10px] tracking-[0.15em] uppercase px-2 py-1 inline-block mb-5" style={{ color: DIMMER, border: `1px solid ${LINE}`, borderRadius: 999 }}>
                Without
              </span>
              <div className="space-y-4">
                {[
                  "Static photos only",
                  "MLS description only",
                  "No social presence",
                  "No retargeting",
                ].map((item, i) => (
                  <motion.div
                    key={item}
                    initial={{ opacity: 0, x: 8 }}
                    animate={isInView ? { opacity: 1, x: 0 } : {}}
                    transition={{ delay: 0.7 + i * 0.12, duration: 0.35 }}
                    className="flex items-center gap-3"
                  >
                    <AnimatedCircleX isInView={isInView} delay={0.8 + i * 0.15} size={16} />
                    <span className="text-[12px]" style={{ color: DIMMER }}>{item}</span>
                  </motion.div>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : {}}
                transition={{ delay: 1.6 }}
                className="mt-5 pt-3"
                style={{ borderTop: `1px solid ${LINE}` }}
              >
                <span className="text-[10px] tracking-[0.1em] uppercase" style={{ color: DIMMER }}>
                  Perceived effort: Minimal
                </span>
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Right: Flywheel + annual math */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="p-8 flex flex-col justify-between"
          style={{ background: "var(--le-surface-card, #fff)", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "var(--le-shadow-sm)" }}
        >
          <div>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-6" style={{ color: DIM }}>
              The listing flywheel
            </span>

            {/* Flywheel steps with animated checks */}
            <div className="space-y-0">
              {[
                { icon: "▶", label: "List with Listing Elevate", active: true },
                { icon: "◎", label: "Retarget prospective sellers", active: true },
                { icon: "◉", label: "Sellers notice your marketing", active: true },
                { icon: "★", label: "Win more listings", active: true },
                { icon: "↻", label: "Repeat", active: false },
              ].map((step, i) => (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, x: -8 }}
                  animate={isInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.7 + i * 0.12, duration: 0.35 }}
                  className="flex items-center gap-4 py-3.5"
                  style={{ borderBottom: `1px solid ${LINE}` }}
                >
                  {step.active ? (
                    <AnimatedCircleCheck isInView={isInView} delay={0.8 + i * 0.18} size={14} />
                  ) : (
                    <span className="text-[14px] w-[22px] text-center" style={{ color: DIMMER }}>
                      {step.icon}
                    </span>
                  )}
                  <span className="text-[12px]" style={{ color: step.active ? DIM : DIMMER }}>
                    {step.label}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Annual math */}
          <div className="mt-6 pt-5 space-y-3" style={{ borderTop: `1px solid ${LINE}` }}>
            {[
              { label: "Per listing", value: "$65" },
              { label: "Annual (12 listings)", value: "$780" },
              { label: "1 new listing won", value: "Pays for the year" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: 8 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 1.2 + i * 0.12, duration: 0.35 }}
                className="flex items-center justify-between"
              >
                <span className="text-[12px]" style={{ color: DIM }}>{item.label}</span>
                <span className="text-[12px] font-medium tabular-nums" style={{ color: WHITE, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>{item.value}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
