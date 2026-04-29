import { motion } from "framer-motion";

interface AnimatedBarProps {
  fillPercent: number;
  animate: boolean;
  variant: "market" | "elevate";
  label: string;
  delayMs?: number;
}

export function AnimatedBar({ fillPercent, animate, variant, label, delayMs = 0 }: AnimatedBarProps) {
  const bg = variant === "elevate" ? "var(--le-accent)" : "var(--le-border-strong)";
  const clamped = Math.max(0, Math.min(100, fillPercent));

  return (
    <div
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{
        position: "relative",
        height: 6,
        width: "100%",
        background: "var(--le-bg-sunken)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      {animate ? (
        <motion.div
          data-testid="bar-fill"
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.9, delay: delayMs / 1000, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: "100%", background: bg, borderRadius: "inherit" }}
        />
      ) : (
        <div
          data-testid="bar-fill"
          style={{ height: "100%", width: `${clamped}%`, background: bg, borderRadius: "inherit" }}
        />
      )}
    </div>
  );
}
