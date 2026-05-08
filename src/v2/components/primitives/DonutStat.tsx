import { motion } from "framer-motion";
import { AnimatedLabel } from "./AnimatedLabel";

interface DonutStatProps {
  percent: number;
  label: string;
  counterPercent?: number;
  counterLabel?: string;
  animate: boolean;
}

interface DonutProps {
  percent: number;
  size: number;
  strokeWidth: number;
  animate: boolean;
  delay?: number;
  children?: React.ReactNode;
}

function Donut({ percent, size, strokeWidth, animate, delay = 0, children }: DonutProps) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * Math.min(Math.max(percent, 0), 100) / 100;
  const rotate = `rotate(-90 ${cx} ${cy})`;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {animate ? (
          <motion.circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ - filled }}
            transition={{ duration: 1.2, delay, ease: [0.16, 1, 0.3, 1] }}
            transform={rotate}
          />
        ) : (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circ}`}
            transform={rotate}
          />
        )}
      </svg>
      {children && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DonutStat({
  percent,
  label,
  counterPercent,
  counterLabel,
  animate,
}: DonutStatProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 40,
        flexWrap: "wrap",
      }}
      role="img"
      aria-label={`${percent}% ${label}${counterPercent !== undefined ? `, compared to ${counterPercent}% ${counterLabel ?? ""}` : ""}`}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Donut percent={percent} size={240} strokeWidth={14} animate={animate}>
          <span
            className="le-display"
            style={{
              fontSize: 64,
              lineHeight: 1,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            <AnimatedLabel label={`${percent}%`} animate={animate} delayMs={500} />
          </span>
        </Donut>
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.7)",
            textAlign: "center",
            maxWidth: 240,
            lineHeight: 1.4,
          }}
        >
          {label}
        </div>
      </div>

      {counterPercent !== undefined && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Donut percent={counterPercent} size={120} strokeWidth={8} animate={animate} delay={0.6}>
            <span
              className="le-display"
              style={{
                fontSize: 28,
                lineHeight: 1,
                color: "rgba(255,255,255,0.85)",
              }}
            >
              <AnimatedLabel label={`${counterPercent}%`} animate={animate} delayMs={900} />
            </span>
          </Donut>
          {counterLabel && (
            <div
              className="le-mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.5)",
                textAlign: "center",
                maxWidth: 160,
                lineHeight: 1.4,
              }}
            >
              {counterLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
