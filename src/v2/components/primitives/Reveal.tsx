import { type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/v2/hooks/usePrefersReducedMotion";

interface RevealProps {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
  className?: string;
}

/**
 * Reveal — shared scroll-entrance primitive.
 *
 * Wraps children in a framer-motion div that fades + slides up when
 * it enters the viewport. Respects prefers-reduced-motion: when the
 * user has requested reduced motion, the wrapper renders immediately
 * at full opacity with no transform.
 *
 * Use for below-the-fold sections. For above-the-fold (Hero), use
 * motion.div with `initial`/`animate` directly.
 *
 * Transition easing [0.22, 1, 0.36, 1] matches the cubic-bezier
 * already used in MarketComparison.tsx for site-wide motion coherence.
 */
export function Reveal({ children, delay = 0, style, className }: RevealProps) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    return (
      <div style={style} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
}
