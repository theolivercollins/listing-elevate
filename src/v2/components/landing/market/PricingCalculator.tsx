/**
 * Interactive Pricing Calculator
 * Agents input their # of listings, choose video type (30s/$130 or 15s/$75),
 * and see total Listing Elevate cost vs. commission earnings + ROI.
 * Uses avg US home price ~$420K, typical 2.5% agent commission.
 * Modo aesthetic: deep navy, animated bars, slider interaction.
 */
import { useState, useMemo, useRef } from "react";
import { motion, AnimatePresence, useInView as fmUseInView } from "framer-motion";
import { AnimatedCircleCheck } from "@/v2/components/primitives/AnimatedIcons";

const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";
const DIMMER = "var(--le-text-faint)";
const LINE = "var(--le-border)";
const CARD_BG = "var(--le-bg-elev)";

const AVG_HOME_PRICE = 420000;
const COMMISSION_RATE = 0.025; // 2.5% agent side
const AVG_COMMISSION = AVG_HOME_PRICE * COMMISSION_RATE; // $10,500

type VideoType = "30s" | "15s";

const VIDEO_OPTIONS: Record<VideoType, { label: string; price: number; description: string }> = {
  "30s": { label: "30s Video", price: 130, description: "Full cinematic listing video" },
  "15s": { label: "15s Video", price: 75, description: "Social-ready highlight reel" },
};

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function PricingCalculator() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = fmUseInView(ref, { once: true, amount: 0.05 });
  const [listings, setListings] = useState(12);
  const [videoType, setVideoType] = useState<VideoType>("30s");

  const calc = useMemo(() => {
    const pricePerVideo = VIDEO_OPTIONS[videoType].price;
    const totalCost = listings * pricePerVideo;
    const totalCommission = listings * AVG_COMMISSION;
    const costAsPercent = totalCommission > 0 ? (totalCost / totalCommission) * 100 : 0;
    const roi = totalCommission > 0 ? totalCommission / totalCost : 0;
    const costPerListing = pricePerVideo;
    const commissionPerListing = AVG_COMMISSION;
    const profitAfterVideo = totalCommission - totalCost;
    // How many listings needed for video to "pay for itself" with 1 extra listing
    const breakEvenListings = Math.ceil(pricePerVideo / AVG_COMMISSION * listings);

    return {
      pricePerVideo,
      totalCost,
      totalCommission,
      costAsPercent,
      roi,
      costPerListing,
      commissionPerListing,
      profitAfterVideo,
      breakEvenListings,
    };
  }, [listings, videoType]);

  // Bar width for the visual comparison (cost bar relative to commission bar)
  const costBarWidth = Math.max(calc.costAsPercent, 0.5);

  return (
    <div ref={ref} className="px-6 sm:px-12 pb-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.05 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Calculator card */}
        <div
          className="p-8 sm:p-10"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
            <div>
              <span className="text-[10px] tracking-[0.2em] uppercase block mb-2" style={{ color: DIM }}>
                Interactive calculator
              </span>
              <h3
                className="font-bold"
                style={{
                  fontFamily: "var(--le-font-sans)",
                  fontSize: "clamp(1.5rem, 4vw, 2.2rem)",
                  color: WHITE,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.1,
                }}
              >
                What does Listing Elevate cost you?
              </h3>
            </div>
            <div className="flex items-center gap-1 text-[10px]" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>
              Based on avg. US home price: ${formatNumber(AVG_HOME_PRICE)}
            </div>
          </div>

          {/* Controls row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">

            {/* Listings slider */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] tracking-[0.15em] uppercase" style={{ color: DIM }}>
                  Listings per year
                </span>
                <motion.span
                  key={listings}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-bold tabular-nums"
                  style={{
                    fontFamily: "var(--le-font-sans)",
                    fontSize: "2rem",
                    color: WHITE,
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}
                >
                  {listings}
                </motion.span>
              </div>

              {/* Custom slider */}
              <div className="relative mt-2">
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={listings}
                  onChange={(e) => setListings(Number(e.target.value))}
                  className="w-full h-2 appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--le-text) 0%, var(--le-text) ${listings}%, var(--le-border) ${listings}%, var(--le-border) 100%)`,
                    borderRadius: 0,
                    outline: "none",
                  }}
                />
                <style>{`
                  input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 18px;
                    height: 18px;
                    background: var(--le-text);
                    border: 2px solid var(--le-bg);
                    cursor: pointer;
                    margin-top: -1px;
                  }
                  input[type="range"]::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    background: var(--le-text);
                    border: 2px solid var(--le-bg);
                    cursor: pointer;
                    border-radius: 0;
                  }
                  input[type="range"]::-webkit-slider-runnable-track {
                    height: 8px;
                    cursor: pointer;
                  }
                  input[type="range"]::-moz-range-track {
                    height: 8px;
                    cursor: pointer;
                  }
                `}</style>
                <div className="flex justify-between mt-2">
                  <span className="text-[9px] tabular-nums" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>1</span>
                  <span className="text-[9px] tabular-nums" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>100</span>
                </div>
              </div>

              {/* Quick presets */}
              <div className="flex gap-2 mt-4">
                {[6, 12, 24, 48].map((n) => (
                  <button
                    key={n}
                    onClick={() => setListings(n)}
                    className="px-3 py-1.5 text-[11px] tabular-nums transition-all duration-200"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: listings === n ? WHITE : DIM,
                      border: `1px solid ${listings === n ? "var(--le-border-strong)" : LINE}`,
                      background: listings === n ? "var(--le-bg-sunken)" : "transparent",
                      borderRadius: 4,
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Video type toggle */}
            <div>
              <span className="text-[11px] tracking-[0.15em] uppercase block mb-3" style={{ color: DIM }}>
                Video type
              </span>
              <div className="flex gap-3">
                {(Object.keys(VIDEO_OPTIONS) as VideoType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setVideoType(type)}
                    className="flex-1 p-4 text-left transition-all duration-200"
                    style={{
                      border: `1px solid ${videoType === type ? "var(--le-border-strong)" : LINE}`,
                      background: videoType === type ? "var(--le-bg-sunken)" : "transparent",
                      borderRadius: 4,
                    }}
                  >
                    <span className="text-[11px] tracking-[0.12em] uppercase block mb-1" style={{ color: videoType === type ? WHITE : DIM }}>
                      {VIDEO_OPTIONS[type].label}
                    </span>
                    <span
                      className="font-bold block mb-1"
                      style={{
                        fontFamily: "var(--le-font-sans)",
                        fontSize: "1.6rem",
                        color: videoType === type ? WHITE : DIMMER,
                        letterSpacing: "-0.03em",
                        lineHeight: 1,
                      }}
                    >
                      ${VIDEO_OPTIONS[type].price}
                    </span>
                    <span className="text-[10px]" style={{ color: DIMMER }}>
                      {VIDEO_OPTIONS[type].description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="w-full h-px mb-10" style={{ background: LINE }} />

          {/* Results */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Total cost */}
            <div className="p-6" style={{ background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}>
              <span className="text-[10px] tracking-[0.2em] uppercase block mb-4" style={{ color: DIM }}>
                Your annual Listing Elevate cost
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={calc.totalCost}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="font-bold tabular-nums block"
                  style={{
                    fontFamily: "var(--le-font-sans)",
                    fontSize: "clamp(2.2rem, 6vw, 3rem)",
                    color: WHITE,
                    letterSpacing: "-0.03em",
                    lineHeight: 0.9,
                  }}
                >
                  {formatCurrency(calc.totalCost)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[11px] mt-2 block" style={{ color: DIM }}>
                {listings} listings × ${calc.pricePerVideo} each
              </span>
            </div>

            {/* Total commission */}
            <div className="p-6" style={{ background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}>
              <span className="text-[10px] tracking-[0.2em] uppercase block mb-4" style={{ color: DIM }}>
                Your annual commission
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={calc.totalCommission}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="font-bold tabular-nums block"
                  style={{
                    fontFamily: "var(--le-font-sans)",
                    fontSize: "clamp(2.2rem, 6vw, 3rem)",
                    color: WHITE,
                    letterSpacing: "-0.03em",
                    lineHeight: 0.9,
                  }}
                >
                  {formatCurrency(calc.totalCommission)}
                </motion.span>
              </AnimatePresence>
              <span className="text-[11px] mt-2 block" style={{ color: DIM }}>
                {listings} × ${formatNumber(AVG_COMMISSION)} avg. commission
              </span>
            </div>

            {/* Cost as % */}
            <div className="p-6" style={{ background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}>
              <span className="text-[10px] tracking-[0.2em] uppercase block mb-4" style={{ color: DIM }}>
                Video cost as % of earnings
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={calc.costAsPercent.toFixed(1)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="font-bold tabular-nums block"
                  style={{
                    fontFamily: "var(--le-font-sans)",
                    fontSize: "clamp(2.2rem, 6vw, 3rem)",
                    color: WHITE,
                    letterSpacing: "-0.03em",
                    lineHeight: 0.9,
                  }}
                >
                  {calc.costAsPercent.toFixed(1)}%
                </motion.span>
              </AnimatePresence>
              <span className="text-[11px] mt-2 block" style={{ color: DIM }}>
                of your total commission income
              </span>
            </div>
          </div>

          {/* Visual comparison bar */}
          <div className="mt-8 p-6" style={{ background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}>
            <span className="text-[10px] tracking-[0.2em] uppercase block mb-5" style={{ color: DIM }}>
              Cost vs. commission — visual
            </span>

            {/* Commission bar (full width) */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px]" style={{ color: DIM }}>Commission earned</span>
                <span className="text-[11px] tabular-nums font-medium" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                  {formatCurrency(calc.totalCommission)}
                </span>
              </div>
              <div className="w-full h-4" style={{ background: "var(--le-border)" }}>
                <motion.div
                  className="h-full"
                  style={{ background: WHITE }}
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>

            {/* Listing Elevate cost bar (proportional) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px]" style={{ color: DIM }}>Listing Elevate cost</span>
                <span className="text-[11px] tabular-nums font-medium" style={{ color: WHITE, fontFamily: "'JetBrains Mono', monospace" }}>
                  {formatCurrency(calc.totalCost)}
                </span>
              </div>
              <div className="w-full h-4" style={{ background: "var(--le-border)" }}>
                <motion.div
                  className="h-full relative"
                  style={{ background: "var(--le-text-faint)", minWidth: "4px" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${costBarWidth}%` }}
                  transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  {/* Glow pulse */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.6, 0] }}
                    transition={{ delay: 1.2, duration: 1.5, repeat: 2 }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-6"
                    style={{ background: WHITE, filter: "blur(6px)" }}
                  />
                </motion.div>
              </div>
            </div>
          </div>

          {/* Bottom insight row */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-start gap-3 p-4" style={{ border: `1px solid ${LINE}` }}>
              <AnimatedCircleCheck isInView={isInView} delay={0.3} size={14} />
              <div>
                <span className="text-[12px] font-medium block" style={{ color: WHITE }}>
                  Per-listing cost
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={calc.pricePerVideo}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] block mt-0.5"
                    style={{ color: DIM }}
                  >
                    ${calc.pricePerVideo} video → ${formatNumber(calc.commissionPerListing)} commission
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4" style={{ border: `1px solid ${LINE}` }}>
              <AnimatedCircleCheck isInView={isInView} delay={0.5} size={14} />
              <div>
                <span className="text-[12px] font-medium block" style={{ color: WHITE }}>
                  Net profit after video
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={calc.profitAfterVideo}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] block mt-0.5"
                    style={{ color: DIM }}
                  >
                    {formatCurrency(calc.profitAfterVideo)} annual take-home
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4" style={{ border: `1px solid ${LINE}` }}>
              <AnimatedCircleCheck isInView={isInView} delay={0.7} size={14} />
              <div>
                <span className="text-[12px] font-medium block" style={{ color: WHITE }}>
                  ROI multiplier
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={calc.roi.toFixed(0)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[11px] block mt-0.5"
                    style={{ color: DIM }}
                  >
                    {calc.roi.toFixed(0)}× return on every dollar spent
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Verdict */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="mt-8 pt-6"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={`${listings}-${videoType}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[14px] sm:text-[15px] leading-relaxed"
                style={{ color: DIM }}
              >
                At <strong style={{ color: WHITE }}>{listings} listings per year</strong>, Listing Elevate costs you{" "}
                <strong style={{ color: WHITE }}>{formatCurrency(calc.totalCost)}</strong> — just{" "}
                <strong style={{ color: WHITE }}>{calc.costAsPercent.toFixed(1)}%</strong> of your{" "}
                <strong style={{ color: WHITE }}>{formatCurrency(calc.totalCommission)}</strong> in commissions.{" "}
                Win just <strong style={{ color: WHITE }}>one extra listing</strong> from the visibility and that single commission
                covers {listings <= 1 ? "the cost" : `all ${listings} videos`} — {Math.floor(calc.roi)}× over.
              </motion.p>
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
