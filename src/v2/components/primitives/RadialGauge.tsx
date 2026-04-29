import { motion } from "framer-motion";

interface RadialGaugeProps {
  marketHours: number;
  marketLabel: string;
  elevateHours: number;
  elevateLabel: string;
  animate: boolean;
}

/**
 * Clock-face radial gauge: two concentric arcs.
 * Outer arc (muted) = market duration
 * Inner arc (white, heavier) = elevate duration
 * Both drawn clockwise from 12 o'clock.
 * Max scale is 10 days (240 hours) so "under 24 hours" is a tiny slice
 * and "48–72 hours" is a modest slice — comparative clarity, not precision.
 */
export function RadialGauge({
  marketHours,
  marketLabel,
  elevateHours,
  elevateLabel,
  animate,
}: RadialGaugeProps) {
  const SIZE = 280;
  const CX = SIZE / 2;
  const CY = SIZE / 2;

  const OUTER_R = 110;
  const INNER_R = 78;
  const OUTER_STROKE = 6;
  const INNER_STROKE = 10;

  const MAX_HOURS = 240; // 10 days
  const marketPct = Math.min(marketHours / MAX_HOURS, 1);
  const elevatePct = Math.min(elevateHours / MAX_HOURS, 1);

  const outerCirc = 2 * Math.PI * OUTER_R;
  const innerCirc = 2 * Math.PI * INNER_R;

  const outerLen = outerCirc * marketPct;
  const innerLen = innerCirc * elevatePct;

  // Rotate -90deg so arc starts at 12 o'clock
  const rotate = `rotate(-90 ${CX} ${CY})`;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Turnaround comparison: market ${marketLabel}, Elevate ${elevateLabel}`}
      >
        {/* Outer background ring */}
        <circle
          cx={CX}
          cy={CY}
          r={OUTER_R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={OUTER_STROKE}
        />
        {/* Inner background ring */}
        <circle
          cx={CX}
          cy={CY}
          r={INNER_R}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={INNER_STROKE}
        />

        {/* Market arc */}
        {animate ? (
          <motion.circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="rgba(255,255,255,0.32)"
            strokeWidth={OUTER_STROKE}
            strokeLinecap="round"
            strokeDasharray={outerCirc}
            initial={{ strokeDashoffset: outerCirc }}
            animate={{ strokeDashoffset: outerCirc - outerLen }}
            transition={{ duration: 1.2, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            transform={rotate}
          />
        ) : (
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="rgba(255,255,255,0.32)"
            strokeWidth={OUTER_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${outerLen} ${outerCirc}`}
            transform={rotate}
          />
        )}

        {/* Elevate arc */}
        {animate ? (
          <motion.circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke="#ffffff"
            strokeWidth={INNER_STROKE}
            strokeLinecap="round"
            strokeDasharray={innerCirc}
            initial={{ strokeDashoffset: innerCirc }}
            animate={{ strokeDashoffset: innerCirc - innerLen }}
            transition={{ duration: 1.2, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
            transform={rotate}
          />
        ) : (
          <circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke="#ffffff"
            strokeWidth={INNER_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${innerLen} ${innerCirc}`}
            transform={rotate}
          />
        )}

        {/* Center number */}
        <text
          x={CX}
          y={CY - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#fff"
          style={{
            fontFamily: "var(--le-font-display)",
            fontSize: 56,
            letterSpacing: "-0.02em",
          }}
        >
          {elevateHours}
        </text>
        <text
          x={CX}
          y={CY + 28}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.55)"
          style={{
            fontFamily: "var(--le-font-mono)",
            fontSize: 10,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          hours
        </text>
      </svg>

      <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
        <div style={{ textAlign: "center" }}>
          <div
            className="le-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "rgba(255,255,255,0.45)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            MARKET
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{marketLabel}</div>
        </div>
        <div style={{ width: 1, background: "rgba(255,255,255,0.12)", alignSelf: "stretch" }} />
        <div style={{ textAlign: "center" }}>
          <div
            className="le-mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "#fff",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            ELEVATE
          </div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 500 }}>{elevateLabel}</div>
        </div>
      </div>
    </div>
  );
}
