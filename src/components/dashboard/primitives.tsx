import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./icons";
import { orderStatusEntry } from "@/lib/order-status";

// ─── format helpers ───────────────────────────────────────────────
export const fmtCents = (c: number | null | undefined) =>
  c == null
    ? "—"
    : "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/**
 * String-safe money formatter. Returns "—" for absent/NaN values; "$n" otherwise.
 * Use ONLY in string contexts (recharts tooltip formatters, LedgerTable col values, etc.)
 * where JSX components are not accepted. For JSX render sites use <MoneyValue> instead.
 */
export const fmtMoney = (c: number | null | undefined): string => {
  if (c == null || Number.isNaN(c)) return "—";
  return "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export const fmtCentsK = (c: number | null | undefined) => {
  if (c == null) return "—";
  const dollars = c / 100;
  return "$" + (dollars >= 1000 ? (dollars / 1000).toFixed(1) + "k" : dollars.toFixed(0));
};

export const fmtDuration = (ms: number | null | undefined) => {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
};

export const fmtRel = (ts: number | string | null | undefined) => {
  if (ts == null) return "—";
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts;
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
};

// ─── PageHeading ─────────────────────────────────────────────────
export interface PageHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}
export function PageHeading({ eyebrow, title, sub, actions }: PageHeadingProps) {
  return (
    <div className="le-page-heading">
      <div>
        {eyebrow && <span className="le-page-eyebrow">{eyebrow}</span>}
        <h1 className="le-page-h1">{title}</h1>
        {sub && <p className="le-page-sub">{sub}</p>}
      </div>
      {actions && <div className="le-page-actions">{actions}</div>}
    </div>
  );
}

// ─── KpiCard ─────────────────────────────────────────────────────
export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  deltaPositiveIsGood?: boolean;
}
export function KpiCard({ label, value, sub, delta, deltaPositiveIsGood = true }: KpiCardProps) {
  const up = (delta ?? 0) > 0;
  const good = up === deltaPositiveIsGood;
  return (
    <div className="le-kpi-card">
      <div className="le-kpi-head">
        <span className="le-kpi-label">{label}</span>
        {delta != null && delta !== 0 && (
          <span
            className="le-kpi-delta"
            style={{
              background: good ? "var(--good-soft)" : "var(--bad-soft)",
              color: good ? "var(--good)" : "var(--bad)",
            }}
          >
            <Icon name={up ? "arrow-up" : "arrow-down"} size={11} strokeWidth={2.2} />
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="le-kpi-value">{value}</div>
      {sub && <div className="le-kpi-sub">{sub}</div>}
    </div>
  );
}

// StatusPill was removed 2026-06-12 — use StatusChip (defined below) for all callers.
// StatusChip is the canonical status display component across both agent and operator surfaces.

// ─── Sparkline ───────────────────────────────────────────────────
export interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  showDots?: boolean;
}
export function Sparkline({ data, color = "var(--ink)", height = 60, fill = true, showDots = false }: SparklineProps) {
  const wRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!wRef.current) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(wRef.current);
    return () => ro.disconnect();
  }, []);
  const id = useMemo(() => "spk" + Math.random().toString(36).slice(2, 7), []);
  if (data.length === 0) return <div ref={wRef} style={{ width: "100%", height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 4;
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * (w - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const area = path + ` L${last?.[0] ?? 0} ${height} L${first?.[0] ?? 0} ${height} Z`;
  return (
    <div ref={wRef} style={{ width: "100%", height }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ overflow: "visible" }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {fill && <path d={area} fill={`url(#${id})`} />}
          <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          {showDots &&
            points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={i === points.length - 1 ? 4 : 0} fill="var(--surface)" stroke={color} strokeWidth="2" />
            ))}
        </svg>
      )}
    </div>
  );
}

// ─── Bars ────────────────────────────────────────────────────────
export interface BarsDatum {
  label: string;
  value: number;
  tooltip?: string;
}
export interface BarsProps {
  data: BarsDatum[];
  accentIndex?: number;
  height?: number;
  accent?: string;
  showLabels?: boolean;
}
export function Bars({ data, accentIndex = -1, height = 200, accent = "var(--ink)", showLabels = true }: BarsProps) {
  const wRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!wRef.current) return;
    const ro = new ResizeObserver(([entry]) => setW(entry.contentRect.width));
    ro.observe(wRef.current);
    return () => ro.disconnect();
  }, []);
  if (data.length === 0) return <div ref={wRef} style={{ width: "100%", height }} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = w > 0 ? (w - 16) / data.length : 0;
  const gap = 10;
  return (
    <div ref={wRef} style={{ width: "100%", height }}>
      {w > 0 && (
        <svg width={w} height={height} style={{ overflow: "visible" }}>
          {[0.25, 0.5, 0.75, 1].map((p) => (
            <line
              key={p}
              x1="0"
              x2={w}
              y1={height - 26 - (height - 50) * p}
              y2={height - 26 - (height - 50) * p}
              stroke="rgba(15,24,60,0.05)"
              strokeDasharray="2 4"
            />
          ))}
          {data.map((d, i) => {
            const isAccent = i === accentIndex || hover === i;
            const h = (d.value / max) * (height - 50);
            const x = 8 + i * barW;
            const y = height - 26 - h;
            return (
              <g
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={x + gap / 2}
                  y={y}
                  width={barW - gap}
                  height={h}
                  rx={Math.min((barW - gap) / 2, 14)}
                  fill={isAccent ? accent : "rgba(15,24,60,0.06)"}
                  style={{ transition: "fill .25s" }}
                />
                {hover === i && (
                  <g>
                    <rect x={x + barW / 2 - 36} y={y - 30} width="72" height="22" rx="6" fill="var(--ink)" />
                    <text
                      x={x + barW / 2}
                      y={y - 16}
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--surface)"
                      fontWeight="600"
                    >
                      {d.tooltip || d.value}
                    </text>
                  </g>
                )}
                {showLabels && (
                  <text
                    x={x + barW / 2}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isAccent ? "var(--ink)" : "var(--muted)"}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── Ring (SLA) ──────────────────────────────────────────────────
export interface RingProps {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  color?: string;
  label?: ReactNode;
  sub?: ReactNode;
}
export function Ring({ value, size = 160, stroke = 14, color = "var(--ink)", label, sub }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(15,24,60,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--ink)" }}>{value}%</div>
          {label && <div className="le-d-label" style={{ marginTop: 2 }}>{label}</div>}
          {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── PropertyThumb — gradient + house glyph ──────────────────────
export interface PropertyThumbProps {
  hue?: number;
  size?: number;
}
export function PropertyThumb({ hue = 220, size = 44 }: PropertyThumbProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--le-r-md)",
        flexShrink: 0,
        background: `linear-gradient(135deg, hsl(${hue}, 10%, 78%), hsl(${hue + 30}, 10%, 62%))`,
        display: "grid",
        placeItems: "center",
        color: "rgba(255,255,255,0.92)",
        border: "1px solid rgba(255,255,255,0.5)",
      }}
    >
      <svg
        width={size * 0.5}
        height={size * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z" />
      </svg>
    </div>
  );
}

// ─── AIBanner ────────────────────────────────────────────────────
export interface AIBannerProps {
  headline?: ReactNode;
  body?: ReactNode;
  cta?: ReactNode;
}
export function AIBanner({ headline, body, cta }: AIBannerProps) {
  return (
    <div className="le-ai-banner">
      <div className="le-ai-banner-spark">
        <Icon name="sparkles" size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 14 }}>
          {headline ?? "Director 2.0 is live."}
        </span>
        <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 14 }}>
          {body ??
            "Auto-routing now factors per-bucket judge scores — expect ~6% lower spend on bedroom scenes this week."}
        </span>
      </div>
      <button type="button" className="le-ai-banner-cta">
        {cta ?? "View details"}
      </button>
    </div>
  );
}

// ─── MiniStat ────────────────────────────────────────────────────
export function MiniStat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div style={{ padding: "10px 14px", background: "rgba(11,11,16,0.03)", borderRadius: "var(--le-r-md)" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          marginTop: 4,
          letterSpacing: "-0.015em",
          fontVariantNumeric: "tabular-nums",
          color: "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── ActivityItem ────────────────────────────────────────────────
const ACTIVITY_ICON_MAP: Record<string, { icon: IconName; color: string }> = {
  complete: { icon: "check", color: "var(--good)" },
  review: { icon: "alert", color: "var(--warn)" },
  provider: { icon: "retry", color: "var(--accent)" },
  upload: { icon: "upload", color: "var(--accent)" },
  cost: { icon: "dollar", color: "var(--accent)" },
};

export function ActivityItem({
  kind,
  title,
  sub,
  time,
}: {
  kind: string;
  title: ReactNode;
  sub: ReactNode;
  time: ReactNode;
}) {
  const s = ACTIVITY_ICON_MAP[kind] || ACTIVITY_ICON_MAP.complete;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--le-r-sm)",
          background: "rgba(11,11,16,0.04)",
          display: "grid",
          placeItems: "center",
          color: s.color,
        }}
      >
        <Icon name={s.icon} size={13} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{title}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginTop: 1,
          }}
        >
          {sub}
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>{time}</span>
    </div>
  );
}

// ─── HealthCard (pipeline KPI) ───────────────────────────────────
export function HealthCard({
  label,
  value,
  icon,
  tone = "neutral",
  delta,
}: {
  label: ReactNode;
  value: ReactNode;
  icon: IconName;
  tone?: "accent" | "good" | "warn" | "neutral";
  delta?: number;
}) {
  const colors: Record<string, string> = {
    accent: "var(--accent)",
    good: "var(--good)",
    warn: "var(--warn)",
    neutral: "var(--muted)",
  };
  const deltaUp = (delta ?? 0) > 0;
  const deltaColor = deltaUp ? "var(--good)" : "var(--bad)";
  return (
    <div className="le-card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 16 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--le-r-lg)",
          background: "rgba(15,24,60,0.04)",
          display: "grid",
          placeItems: "center",
          color: colors[tone],
        }}
      >
        <Icon name={icon} size={20} strokeWidth={1.6} />
      </div>
      <div style={{ flex: 1 }}>
        <div className="le-d-label">{label}</div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            marginTop: 2,
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink)",
          }}
        >
          {value}
        </div>
      </div>
      {delta != null && (
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: deltaColor,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Icon name={deltaUp ? "arrow-up" : "arrow-down"} size={11} strokeWidth={2.2} />
          {Math.abs(delta)}%
        </div>
      )}
    </div>
  );
}

// ─── small utility wrappers ──────────────────────────────────────
export function Card({
  padding = 24,
  style,
  children,
}: {
  padding?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className="le-card" style={{ padding, ...style }}>
      {children}
    </section>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div>
        {eyebrow && <span className="le-d-label">{eyebrow}</span>}
        <h3
          style={{
            margin: "6px 0 0",
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
          }}
        >
          {title}
        </h3>
      </div>
      {meta}
    </div>
  );
}

// ─── StatusChip ──────────────────────────────────────────────────────────────
// Replaces StatusPill. Consumes the canonical ORDER_STATUS_MAP via
// orderStatusEntry — the single source of truth for status vocabulary.

export interface StatusChipProps {
  status: string;
  /** Override the computed label (for display customisation) */
  labelOverride?: string;
}

export function StatusChip({ status, labelOverride }: StatusChipProps) {
  const entry = orderStatusEntry(status);
  const label = labelOverride ?? entry.label;
  return (
    <span
      data-status={status}
      className="le-status-pill"
      style={{ background: entry.bg, color: entry.color }}
    >
      <span className="le-status-dot" />
      {label}
    </span>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
// Phase 2 design: accent-soft icon container, clear headline, optional CTA.
// Used wherever a data section has no rows — never hand-roll per page.

export interface EmptyStateCTA {
  label: string;
  /** Use `to` for SPA navigation (renders a <Link>). Use `onClick` for imperative actions. */
  to?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  message: string;
  /** Optional icon name from the icon set. Defaults to "archive". */
  icon?: IconName;
  cta?: EmptyStateCTA;
}

export function EmptyState({ message, icon = "archive", cta }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "32px 20px",
      }}
    >
      <span
        data-empty-icon
        style={{
          width: 54,
          height: 54,
          borderRadius: "var(--le-r-xl)",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          display: "grid",
          placeItems: "center",
          marginBottom: 16,
        }}
      >
        <Icon name={icon} size={22} strokeWidth={1.5} />
      </span>
      <p
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--ink)",
          margin: 0,
        }}
      >
        {message}
      </p>
      {cta && (
        cta.to ? (
          <Link
            to={cta.to}
            className="le-btn-ghost"
            style={{ marginTop: 14 }}
          >
            {cta.label}
          </Link>
        ) : (
          <button
            type="button"
            className="le-btn-ghost"
            style={{ marginTop: 14 }}
            onClick={cta.onClick}
          >
            {cta.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────
// Phase 2 shimmer loading state. Use width/height props to size the box.
// Uses .le-skeleton CSS class (defined in tokens.css) for the shimmer animation.

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = "var(--radius-xs, 8px)",
  style,
}: SkeletonProps) {
  return (
    <span
      className="le-skeleton"
      aria-hidden="true"
      style={{ display: "block", width, height, borderRadius, ...style }}
    />
  );
}

// ─── SkeletonRow — shimmer row for table/list loading states ─────────────────
export function SkeletonRow() {
  return (
    <div className="le-skeleton-row">
      <Skeleton width={36} height={36} borderRadius="var(--radius-xs, 8px)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="35%" height={11} />
      </div>
      <Skeleton width={60} height={22} borderRadius="var(--radius-pill, 999px)" style={{ flexShrink: 0 }} />
    </div>
  );
}

// ─── MoneyValue ──────────────────────────────────────────────────────────────
// The ONLY way cost or spend renders in the authed app. Rules:
//   - null / undefined → renders "—" with an optional tooltip
//   - 0 cents → "$0" (explicit zero IS a real value)
//   - n cents → "$n/100" formatted with no decimal places
//
// NEVER fabricates $0 — if data is absent, the caller must pass null/undefined
// and this component surfaces the unknown state honestly.

export interface MoneyValueProps {
  cents: number | null | undefined;
  /** Tooltip to show on the "—" placeholder when the value is absent */
  tooltipWhenAbsent?: string;
  /** Extra inline styles on the root span */
  style?: CSSProperties;
}

export function MoneyValue({ cents, tooltipWhenAbsent, style }: MoneyValueProps) {
  if (cents == null || Number.isNaN(cents)) {
    return (
      <span
        title={tooltipWhenAbsent}
        style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", ...style }}
      >
        —
      </span>
    );
  }
  const formatted =
    "$" +
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  return (
    <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {formatted}
    </span>
  );
}
