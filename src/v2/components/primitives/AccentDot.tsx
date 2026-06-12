/**
 * AccentDot — small animated blue dot for visual interest.
 *
 * A minimal accent element (6px circle) with optional soft pulsing
 * animation. Used decoratively in sections, eyebrows, and cards.
 *
 * Respects prefers-reduced-motion: animation removed for users
 * who request it, but the dot remains visible.
 *
 * Props:
 *   animated — when true, applies the le-pulse-soft animation (default: false)
 *   className — optional string to add custom classes
 */

interface AccentDotProps {
  animated?: boolean;
  className?: string;
}

export function AccentDot({ animated = false, className = "" }: AccentDotProps) {
  const classes = [
    "le-accent-dot",
    animated ? "le-accent-dot-animated" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "rgba(var(--le-brand-blue-rgb), 0.6)",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}
