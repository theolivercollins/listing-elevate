/**
 * Visualization 3: Turnaround Speed — Scroll-driven progressive timeline
 * Mobile-optimized: stacks vertically, larger text, better spacing, bigger touch targets.
 * Desktop: side-by-side comparison. Both scroll-driven.
 */
import { motion } from "framer-motion";
import { useScrollProgress } from "@/v2/hooks/useScrollProgress";
import { AnimatedCircleCheck, AnimatedCircleX } from "@/v2/components/primitives/AnimatedIcons";

const WHITE = "var(--le-text)";
const DIM = "var(--le-text-muted)";
const DIMMER = "var(--le-text-faint)";
const LINE = "var(--le-border)";
const CARD_BG = "var(--le-bg-elev)";

interface TimelineStep {
  time: string;
  label: string;
  detail: string;
}

const ELEVATE_STEPS: TimelineStep[] = [
  { time: "0h", label: "Photos uploaded", detail: "Upload your listing photos to Listing Elevate" },
  { time: "2h", label: "AI processing", detail: "Scene analysis, motion planning, voiceover" },
  { time: "8h", label: "Quality review", detail: "Automated QC + human review pass" },
  { time: "<24h", label: "Video delivered", detail: "16:9 + 9:16, ready to post everywhere" },
];

const TRADITIONAL_STEPS: TimelineStep[] = [
  { time: "0h", label: "Request quote", detail: "Find a videographer, negotiate pricing" },
  { time: "24h", label: "Schedule shoot", detail: "Coordinate calendars, hope for good weather" },
  { time: "48h", label: "On-site filming", detail: "2–4 hour shoot, crew setup and teardown" },
  { time: "72h+", label: "Maybe delivered", detail: "Editing, revisions, back-and-forth" },
];

function TimelineTrack({
  steps,
  progress,
  isElevate,
}: {
  steps: TimelineStep[];
  progress: number;
  isElevate: boolean;
}) {
  // Each step activates at evenly spaced progress intervals
  // Step i activates when progress > i / steps.length
  const activeSteps = steps.filter((_, i) => progress >= i / steps.length).length;
  const lineProgress = Math.min(1, progress);

  return (
    <div className="relative">
      {/* Vertical line track — positioned for mobile and desktop */}
      <div
        className="absolute top-4 bottom-4 w-px"
        style={{
          left: "11px",
          background: "var(--le-border)",
        }}
      >
        <motion.div
          className="w-full origin-top"
          style={{
            background: isElevate ? WHITE : "var(--le-text-faint)",
            height: `${lineProgress * 100}%`,
            transition: "height 0.3s ease-out",
          }}
        />
      </div>

      {/* Steps */}
      <div className="space-y-0">
        {steps.map((step, i) => {
          const isActive = i < activeSteps;
          const isCurrent = i === activeSteps - 1;

          return (
            <div
              key={step.time}
              className="relative flex items-start gap-4 sm:gap-5 py-4 sm:py-5"
              style={{
                borderBottom: i < steps.length - 1 ? `1px solid ${LINE}` : "none",
              }}
            >
              {/* Node — larger on mobile for touch */}
              <div className="relative z-10 shrink-0 w-[22px] flex justify-center pt-1">
                <motion.div
                  className="flex items-center justify-center rounded-full"
                  style={{
                    width: 10,
                    height: 10,
                    background: isActive
                      ? isElevate ? WHITE : "var(--le-text-faint)"
                      : "var(--le-border)",
                    border: isActive ? "none" : `1px solid var(--le-border-strong)`,
                    transition: "all 0.4s ease-out",
                    transform: isCurrent ? "scale(1.4)" : "scale(1)",
                    boxShadow: isCurrent && isElevate ? "0 0 14px var(--le-border-strong)" : "none",
                  }}
                />
              </div>

              {/* Content — stacked time + label on mobile */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 sm:gap-3 mb-0.5 sm:mb-1 flex-wrap">
                  <span
                    className="text-[12px] sm:text-[11px] tabular-nums font-semibold shrink-0"
                    style={{
                      color: isActive ? (isElevate ? WHITE : DIM) : DIMMER,
                      fontFamily: "'JetBrains Mono', monospace",
                      transition: "color 0.4s ease-out",
                    }}
                  >
                    {step.time}
                  </span>
                  <span
                    className="text-[14px] sm:text-[13px] font-medium"
                    style={{
                      color: isActive ? (isElevate ? WHITE : DIM) : DIMMER,
                      transition: "color 0.4s ease-out",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                <span
                  className="text-[12px] sm:text-[11px] block leading-relaxed"
                  style={{
                    color: isActive ? DIM : DIMMER,
                    transition: "color 0.4s ease-out",
                  }}
                >
                  {step.detail}
                </span>
              </div>

              {/* Check/X for final step */}
              {i === steps.length - 1 && isActive && (
                <div className="shrink-0 pt-0.5">
                  {isElevate ? (
                    <AnimatedCircleCheck isInView={true} delay={0} size={20} />
                  ) : (
                    <AnimatedCircleX isInView={true} delay={0} size={20} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TurnaroundSpeed() {
  const { ref, progress } = useScrollProgress();

  return (
    <div ref={ref} className="px-4 sm:px-6 lg:px-12 pb-8 sm:pb-10">
      {/* Mobile: label tabs showing which timeline is which */}
      <div className="flex gap-2 mb-4 lg:hidden">
        <div
          className="flex-1 py-2 px-3 text-center text-[10px] tracking-[0.15em] uppercase font-semibold"
          style={{ color: WHITE, background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}
        >
          Listing Elevate · &lt;24h
        </div>
        <div
          className="flex-1 py-2 px-3 text-center text-[10px] tracking-[0.15em] uppercase"
          style={{ color: DIMMER, border: `1px solid ${LINE}` }}
        >
          Traditional · 72h+
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* Listing Elevate timeline */}
        <div
          className="p-5 sm:p-8"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          {/* Header — hidden on mobile (shown in tabs above) */}
          <div className="hidden lg:flex items-center justify-between mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
              Turnaround time
            </span>
            <span
              className="text-[10px] tracking-[0.15em] uppercase px-2 py-1"
              style={{ color: WHITE, border: `1px solid ${LINE}`, background: "var(--le-bg-sunken)" }}
            >
              Listing Elevate
            </span>
          </div>

          {/* Mobile header */}
          <div className="flex lg:hidden items-center justify-between mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
              Your timeline
            </span>
            <span
              className="text-[9px] tracking-[0.12em] uppercase px-2 py-0.5"
              style={{ color: WHITE, background: "var(--le-bg-sunken)" }}
            >
              Listing Elevate
            </span>
          </div>

          {/* Big number */}
          <span
            className="font-bold block mb-4 sm:mb-6"
            style={{
              fontFamily: "var(--le-font-sans)",
              fontSize: "clamp(2.5rem, 12vw, 4.5rem)",
              color: WHITE,
              letterSpacing: "-0.04em",
              lineHeight: 0.85,
            }}
          >
            &lt;24h
          </span>

          <TimelineTrack steps={ELEVATE_STEPS} progress={progress} isElevate={true} />

          <div className="mt-4 sm:mt-5">
            <span className="text-[9px] sm:text-[10px]" style={{ color: DIMMER, fontFamily: "'JetBrains Mono', monospace" }}>
              Source: Fotober Real Estate Video Pricing (2025)
            </span>
          </div>
        </div>

        {/* Traditional timeline */}
        <div
          className="p-5 sm:p-8 flex flex-col justify-between"
          style={{ background: CARD_BG, border: `1px solid ${LINE}` }}
        >
          <div>
            {/* Header — hidden on mobile (shown in tabs above) */}
            <div className="hidden lg:flex items-center justify-between mb-2">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
                Turnaround time
              </span>
              <span
                className="text-[10px] tracking-[0.15em] uppercase px-2 py-1"
                style={{ color: DIMMER, border: `1px solid ${LINE}` }}
              >
                Traditional
              </span>
            </div>

            {/* Mobile header */}
            <div className="flex lg:hidden items-center justify-between mb-2">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: DIM }}>
                Their timeline
              </span>
              <span
                className="text-[9px] tracking-[0.12em] uppercase px-2 py-0.5"
                style={{ color: DIMMER, border: `1px solid ${LINE}` }}
              >
                Traditional
              </span>
            </div>

            <span
              className="font-bold block mb-4 sm:mb-6"
              style={{
                fontFamily: "var(--le-font-sans)",
                fontSize: "clamp(2.5rem, 12vw, 4.5rem)",
                color: "var(--le-text-faint)",
                letterSpacing: "-0.04em",
                lineHeight: 0.85,
              }}
            >
              48–72h
            </span>

            <TimelineTrack steps={TRADITIONAL_STEPS} progress={progress} isElevate={false} />
          </div>

          {/* Bottom verdict */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={progress > 0.7 ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4 }}
            className="mt-5 sm:mt-6 pt-4 sm:pt-5"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <span className="text-[14px] sm:text-[13px] font-medium block leading-snug" style={{ color: WHITE }}>
              Your listing is live before they even schedule the shoot.
            </span>
            <span className="text-[12px] block mt-1.5 leading-relaxed" style={{ color: DIM }}>
              Every day without video is a day your listing underperforms.
            </span>
          </motion.div>
        </div>
      </div>

      {/* Mobile summary bar — quick glance comparison */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={progress > 0.5 ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.4 }}
        className="mt-4 lg:hidden p-4"
        style={{ background: "var(--le-bg-sunken)", border: `1px solid ${LINE}` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AnimatedCircleCheck isInView={progress > 0.5} delay={0} size={16} />
            <div>
              <span className="text-[12px] font-semibold block" style={{ color: WHITE }}>3× faster</span>
              <span className="text-[10px]" style={{ color: DIM }}>with Listing Elevate</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[11px] font-medium block" style={{ color: WHITE }}>&lt;24h</span>
              <span className="text-[9px]" style={{ color: DIMMER }}>Elevate</span>
            </div>
            <span className="text-[10px]" style={{ color: DIMMER }}>vs</span>
            <div className="text-right">
              <span className="text-[11px] font-medium block" style={{ color: DIM }}>72h+</span>
              <span className="text-[9px]" style={{ color: DIMMER }}>Traditional</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
