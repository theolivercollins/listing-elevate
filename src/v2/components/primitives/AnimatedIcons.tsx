/**
 * BonnieBoard-style animated check and X icons
 * SVG path draw-in animations triggered by visibility
 */
import { motion } from "framer-motion";

interface IconProps {
  isInView: boolean;
  delay?: number;
  size?: number;
}

/** Animated checkmark — draws in with a satisfying arc */
export function AnimatedCheck({ isInView, delay = 0, size = 22 }: IconProps) {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{
        width: size + 8,
        height: size + 8,
        border: "1px solid var(--le-border-strong)",
        background: "var(--le-bg-sunken)",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <motion.path
          d="M4 12.5L9.5 18L20 6"
          stroke="var(--le-text)"
          strokeWidth="2"
          strokeLinecap="square"
          strokeLinejoin="miter"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.15, delay },
          }}
        />
      </svg>
    </div>
  );
}

/** Animated X mark — two strokes draw in sequentially */
export function AnimatedX({ isInView, delay = 0, size = 22 }: IconProps) {
  return (
    <div
      className="shrink-0 flex items-center justify-center"
      style={{
        width: size + 8,
        height: size + 8,
        border: "1px solid var(--le-border)",
        background: "transparent",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <motion.path
          d="M6 6L18 18"
          stroke="var(--le-text-muted)"
          strokeWidth="1.5"
          strokeLinecap="square"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay },
          }}
        />
        <motion.path
          d="M18 6L6 18"
          stroke="var(--le-text-muted)"
          strokeWidth="1.5"
          strokeLinecap="square"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.35, delay: delay + 0.15, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay: delay + 0.15 },
          }}
        />
      </svg>
    </div>
  );
}

/** Animated circle check — BonnieBoard coral style adapted for dark theme */
export function AnimatedCircleCheck({ isInView, delay = 0, size = 20 }: IconProps) {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: size + 4, height: size + 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Circle */}
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--le-text)"
          strokeWidth="1.5"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay },
          }}
        />
        {/* Check */}
        <motion.path
          d="M7 12.5L10.5 16L17 8"
          stroke="var(--le-text)"
          strokeWidth="1.5"
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.4, delay: delay + 0.4, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay: delay + 0.4 },
          }}
        />
      </svg>
    </div>
  );
}

/** Animated circle X — for negative items */
export function AnimatedCircleX({ isInView, delay = 0, size = 20 }: IconProps) {
  return (
    <div className="shrink-0 flex items-center justify-center" style={{ width: size + 4, height: size + 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {/* Circle */}
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          stroke="var(--le-border-strong)"
          strokeWidth="1"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay },
          }}
        />
        {/* X */}
        <motion.path
          d="M8.5 8.5L15.5 15.5"
          stroke="var(--le-text-muted)"
          strokeWidth="1.2"
          strokeLinecap="square"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.3, delay: delay + 0.35, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay: delay + 0.35 },
          }}
        />
        <motion.path
          d="M15.5 8.5L8.5 15.5"
          stroke="var(--le-text-muted)"
          strokeWidth="1.2"
          strokeLinecap="square"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={isInView ? { pathLength: 1, opacity: 1 } : {}}
          transition={{
            pathLength: { duration: 0.3, delay: delay + 0.5, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.1, delay: delay + 0.5 },
          }}
        />
      </svg>
    </div>
  );
}
