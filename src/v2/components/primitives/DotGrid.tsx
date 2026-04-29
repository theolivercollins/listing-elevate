import { motion } from "framer-motion";

interface DotGridProps {
  filled: number;
  total: number;
  label: string;
  animate: boolean;
}

const DOT_SIZE = 9;
const DOT_GAP = 14;
const STAGGER_MS = 10;

export function DotGrid({ filled, total, label, animate }: DotGridProps) {
  const cols = Math.ceil(Math.sqrt(total));
  const clampedFilled = Math.max(0, Math.min(filled, total));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 28,
      }}
      role="img"
      aria-label={label}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${DOT_SIZE}px)`,
          gap: DOT_GAP,
        }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const isFilled = i < clampedFilled;
          const dotKey = i;
          const common = {
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: "50%",
          } as const;

          if (isFilled) {
            const finalStyle = { ...common, background: "#ffffff" };
            if (animate) {
              return (
                <motion.div
                  key={dotKey}
                  data-dot="filled"
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    duration: 0.3,
                    delay: (i * STAGGER_MS) / 1000,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={finalStyle}
                />
              );
            }
            return <div key={dotKey} data-dot="filled" style={finalStyle} />;
          }

          const emptyStyle = {
            ...common,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.18)",
          };
          return <div key={dotKey} data-dot="empty" style={emptyStyle} />;
        })}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.7)",
          lineHeight: 1.5,
          maxWidth: 320,
        }}
      >
        {label}
      </div>
    </div>
  );
}
