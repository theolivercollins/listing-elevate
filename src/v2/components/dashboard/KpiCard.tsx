import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

type GradientKey = "blue" | "navy" | "beige" | "status-healthy" | "status-degraded" | "status-critical";

const GRADIENT_VAR: Record<GradientKey, string> = {
  blue: "var(--le-gradient-blue)",
  navy: "var(--le-gradient-navy)",
  beige: "var(--le-gradient-beige)",
  "status-healthy": "var(--le-gradient-status-healthy)",
  "status-degraded": "var(--le-gradient-status-degraded)",
  "status-critical": "var(--le-gradient-status-critical)",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  gradient: GradientKey;
  icon?: ReactNode;
  delta?: number; // percentage, e.g. 15.2 or -3.4
  deltaIsGoodWhenNegative?: boolean;
  href?: string;
}

export function KpiCard({ label, value, gradient, icon, delta, deltaIsGoodWhenNegative = false, href }: KpiCardProps) {
  const showDelta = typeof delta === "number" && Number.isFinite(delta) && delta !== 0;
  const up = (delta ?? 0) > 0;
  const good = deltaIsGoodWhenNegative ? !up : up;
  const deltaColor = showDelta ? (good ? "text-[color:var(--le-success)]" : "text-[color:var(--le-danger)]") : "";
  const Icon = up ? TrendingUp : TrendingDown;

  const Inner = (
    <div
      className="flex h-[124px] flex-col justify-between rounded-[14px] border p-5"
      style={{
        background: "var(--le-bg-elev)",
        borderColor: "var(--le-border)",
        boxShadow: "var(--le-shadow-md)",
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-white"
          style={{ background: GRADIENT_VAR[gradient] }}
        >
          {icon}
        </div>
        <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
          {label}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div className="le-mono text-[28px] font-semibold tracking-tight" style={{ color: "var(--le-text)" }}>
          {value}
        </div>
        {showDelta && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
            <Icon className="h-3 w-3" strokeWidth={2} />
            {up ? "+" : ""}
            {delta!.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block transition-opacity hover:opacity-90">
        {Inner}
      </a>
    );
  }
  return Inner;
}
