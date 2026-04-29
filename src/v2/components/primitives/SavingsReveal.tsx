import { motion } from "framer-motion";

interface SavingsRevealProps {
  marketLabel: string;
  marketMax: number;
  elevateLabel: string;
  elevateValue: number;
  animate: boolean;
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsReveal({
  marketLabel,
  marketMax,
  elevateLabel,
  elevateValue,
  animate,
}: SavingsRevealProps) {
  const savings = Math.max(0, marketMax - elevateValue);

  const strikeLineProps = animate
    ? {
        initial: { scaleX: 0 },
        animate: { scaleX: 1 },
        transition: { duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      }
    : { initial: { scaleX: 1 }, animate: { scaleX: 1 } };

  const elevateProps = animate
    ? {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.8, delay: 0.9, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      }
    : { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } };

  const calloutProps = animate
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.6, delay: 1.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      }
    : { initial: { opacity: 1 }, animate: { opacity: 1 } };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 24,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 48,
          flexWrap: "wrap",
          width: "100%",
        }}
      >
        <div style={{ position: "relative", display: "inline-block" }}>
          <span
            className="le-display"
            style={{
              fontSize: "clamp(28px, 3.2vw, 44px)",
              lineHeight: 1,
              color: "rgba(255,255,255,0.45)",
              fontStyle: "italic",
              display: "inline-block",
            }}
          >
            {marketLabel}
          </span>
          <motion.span
            aria-hidden
            {...strikeLineProps}
            style={{
              position: "absolute",
              top: "52%",
              left: 0,
              right: 0,
              height: 2,
              background: "rgba(255,255,255,0.55)",
              transformOrigin: "left center",
              display: "block",
            }}
          />
        </div>

        <motion.span
          {...elevateProps}
          className="le-display"
          style={{
            fontSize: "clamp(72px, 9vw, 120px)",
            lineHeight: 1,
            color: "#fff",
            letterSpacing: "-0.02em",
            display: "inline-block",
          }}
        >
          {elevateLabel}
        </motion.span>
      </div>

      <motion.div
        {...calloutProps}
        className="le-mono"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.2em",
          color: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(255,255,255,0.18)",
          padding: "8px 14px",
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ color: "#fff" }}>Save up to {formatUSD(savings)}</span>
        <span style={{ opacity: 0.5 }}>per listing</span>
      </motion.div>
    </div>
  );
}
