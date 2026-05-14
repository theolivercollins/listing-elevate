import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  AlertTriangle,
  Loader2,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  Film,
  Activity,
  Clock,
  DollarSign,
  Trophy,
  Sparkles,
  Building2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatCents, formatDuration, getRelativeTime } from "@/lib/types";
import type { Property, DailyStat } from "@/lib/types";
import { fetchProperties, fetchDailyStats, fetchStatsOverview, fetchCostBreakdown } from "@/lib/api";
import type { CostBreakdown, CostBreakdownRow } from "@/lib/api";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = {
  fontFamily: "var(--le-font-mono)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "hsl(var(--muted-foreground))",
};

const PAGE_H1: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: "clamp(26px, 3.4vw, 36px)",
  fontWeight: 600,
  letterSpacing: "-0.03em",
  lineHeight: 1.05,
  color: "hsl(var(--foreground))",
  margin: 0,
};

const SECTION_H3: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: "-0.02em",
  color: "hsl(var(--foreground))",
  margin: 0,
};

const BIG_VALUE: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 30,
  fontWeight: 700,
  letterSpacing: "-0.03em",
  color: "hsl(var(--foreground))",
  fontVariantNumeric: "tabular-nums",
};

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const CARD_STYLE: CSSProperties = {
  background: "var(--le-surface-card)",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--le-card-radius)",
  boxShadow: "var(--le-card-shadow)",
};

type TileTone = "sky" | "peach" | "mint" | "lavender" | "rose";

const TILE_TONES: Record<TileTone, { bg: string; ink: string }> = {
  sky: { bg: "var(--le-tile-sky-bg)", ink: "var(--le-tile-sky-ink)" },
  peach: { bg: "var(--le-tile-peach-bg)", ink: "var(--le-tile-peach-ink)" },
  mint: { bg: "var(--le-tile-mint-bg)", ink: "var(--le-tile-mint-ink)" },
  lavender: { bg: "var(--le-tile-lavender-bg)", ink: "var(--le-tile-lavender-ink)" },
  rose: { bg: "var(--le-tile-rose-bg)", ink: "var(--le-tile-rose-ink)" },
};

function IconBadge({ tone, children }: { tone: TileTone; children: ReactNode }) {
  const t = TILE_TONES[tone];
  return (
    <span
      aria-hidden
      style={{
        background: t.bg,
        color: t.ink,
        width: 44,
        height: 44,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function Delta({ value, positiveIsGood = true }: { value: number; positiveIsGood?: boolean }) {
  if (!Number.isFinite(value) || value === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        —
      </span>
    );
  }
  const up = value > 0;
  const good = up === positiveIsGood;
  const Icon = up ? TrendingUp : TrendingDown;
  const fg = good ? "var(--le-tile-mint-ink)" : "var(--le-tile-rose-ink)";
  const bg = good ? "var(--le-tile-mint-bg)" : "var(--le-tile-rose-bg)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
      style={{ background: bg, color: fg }}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {up ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

type CostTab = "provider" | "scope" | "stage" | "model";

const Overview = () => {
  const [completedProps, setCompletedProps] = useState<Property[]>([]);
  const [inProgressProps, setInProgressProps] = useState<Property[]>([]);
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [dailyStatsData, setDailyStatsData] = useState<DailyStat[]>([]);
  const [stats, setStats] = useState<{
    completedToday: number;
    submittedToday: number;
    inPipeline: number;
    needsReview: number;
    avgProcessingMs: number;
    totalCostTodayCents: number;
    avgCostPerVideoCents: number;
    successRate: number;
  } | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [costTab, setCostTab] = useState<CostTab>("provider");
  const [costExpanded, setCostExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [completedRes, allRes, dailyRes, overviewRes, breakdownRes] = await Promise.all([
          fetchProperties({ status: "complete", limit: 20 }),
          fetchProperties({ limit: 100 }),
          fetchDailyStats(14),
          fetchStatsOverview(),
          fetchCostBreakdown().catch(() => null),
        ]);
        if (cancelled) return;
        setCompletedProps(completedRes.properties);
        setAllProps(allRes.properties);
        const active = new Set(["queued", "ingesting", "analyzing", "scripting", "generating", "qc", "assembling"]);
        setInProgressProps(allRes.properties.filter((p) => active.has(p.status)));
        setDailyStatsData(dailyRes.stats);
        setStats(overviewRes);
        setCostBreakdown(breakdownRes);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...CARD_STYLE,
          padding: 40,
          background: "var(--le-tile-rose-bg)",
          borderColor: "var(--le-tile-rose-ink)",
        }}
      >
        <div className="flex items-start gap-5">
          <IconBadge tone="rose">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
          </IconBadge>
          <div>
            <span style={{ ...EYEBROW, color: "var(--le-tile-rose-ink)" }}>— Error</span>
            <p className="mt-3 text-sm text-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Derived metrics
  const statusToProgress: Record<string, number> = {
    queued: 5,
    ingesting: 10,
    analyzing: 20,
    scripting: 35,
    generating: 60,
    qc: 80,
    assembling: 92,
    complete: 100,
  };

  const last7 = dailyStatsData.slice(-7);
  const prev7 = dailyStatsData.slice(-14, -7);
  const last7Cost = last7.reduce((s, d) => s + (d.total_cost_cents ?? 0), 0);
  const prev7Cost = prev7.reduce((s, d) => s + (d.total_cost_cents ?? 0), 0);
  const costDelta = prev7Cost > 0 ? ((last7Cost - prev7Cost) / prev7Cost) * 100 : 0;

  const last7Videos = last7.reduce((s, d) => s + (d.properties_completed ?? 0), 0);
  const prev7Videos = prev7.reduce((s, d) => s + (d.properties_completed ?? 0), 0);
  const videoDelta = prev7Videos > 0 ? ((last7Videos - prev7Videos) / prev7Videos) * 100 : 0;

  const statusBuckets = { queued: 0, inFlight: 0, delivered: 0, failed: 0 };
  for (const p of allProps) {
    if (p.status === "complete") statusBuckets.delivered++;
    else if (p.status === "queued") statusBuckets.queued++;
    else if (p.status === "failed" || p.status === "needs_review") statusBuckets.failed++;
    else statusBuckets.inFlight++;
  }
  const totalProps = allProps.length || 1;
  const deliveredPct = (statusBuckets.delivered / totalProps) * 100;

  const onTime = completedProps.filter(
    (p) => p.processing_time_ms != null && p.processing_time_ms < 72 * 60 * 60 * 1000,
  ).length;
  const slaRate = completedProps.length > 0 ? (onTime / completedProps.length) * 100 : 0;
  const slaDash = 2 * Math.PI * 54;
  const slaOffset = slaDash * (1 - slaRate / 100);

  const agentMap = new Map<string, { count: number; cost: number }>();
  for (const p of allProps) {
    const key = p.listing_agent || "—";
    const entry = agentMap.get(key) || { count: 0, cost: 0 };
    entry.count += 1;
    entry.cost += p.total_cost_cents || 0;
    agentMap.set(key, entry);
  }
  const topAgents = Array.from(agentMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);

  const kpis: Array<{
    label: string;
    value: string;
    sub: string;
    delta: number;
    deltaPositiveIsGood: boolean;
    tone: TileTone;
    icon: ReactNode;
  }> = [
    {
      label: "Videos today",
      value: String(stats?.completedToday ?? 0).padStart(2, "0"),
      sub: `${stats?.submittedToday ?? 0} submitted`,
      delta: videoDelta,
      deltaPositiveIsGood: true,
      tone: "sky",
      icon: <Film className="h-5 w-5" strokeWidth={1.75} />,
    },
    {
      label: "In production",
      value: String(stats?.inPipeline ?? 0).padStart(2, "0"),
      sub: "across all stages",
      delta: 0,
      deltaPositiveIsGood: true,
      tone: "peach",
      icon: <Activity className="h-5 w-5" strokeWidth={1.75} />,
    },
    {
      label: "Avg turnaround",
      value: formatDuration(stats?.avgProcessingMs ?? 0),
      sub: "per video",
      delta: 0,
      deltaPositiveIsGood: false,
      tone: "mint",
      icon: <Clock className="h-5 w-5" strokeWidth={1.75} />,
    },
    {
      label: "Spend · 7d",
      value: formatCents(last7Cost),
      sub: "all providers",
      delta: costDelta,
      deltaPositiveIsGood: false,
      tone: "lavender",
      icon: <DollarSign className="h-5 w-5" strokeWidth={1.75} />,
    },
  ];

  const slaRing: TileTone = slaRate >= 80 ? "mint" : slaRate >= 50 ? "peach" : "rose";
  const slaRingInk =
    slaRing === "mint"
      ? "var(--le-tile-mint-ink)"
      : slaRing === "peach"
      ? "var(--le-tile-peach-ink)"
      : "var(--le-tile-rose-ink)";

  return (
    <div className="space-y-10">
      {/* ─── Page heading ─── */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— Today</span>
          <h2 className="mt-3" style={PAGE_H1}>
            Studio overview
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Listing Elevate · live activity across the render pipeline
          </p>
        </div>
      </div>

      {/* ─── KPI row — soft pastel icon cards ─── */}
      <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: i * 0.05, ease: EASE }}
            style={{ ...CARD_STYLE, padding: 22 }}
          >
            <div className="flex items-start gap-4">
              <IconBadge tone={k.tone}>{k.icon}</IconBadge>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {k.label}
                </span>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span style={BIG_VALUE}>{k.value}</span>
                  <Delta value={k.delta} positiveIsGood={k.deltaPositiveIsGood} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </section>

      {/* ─── Spend trend + SLA ring + Status distribution ─── */}
      <section className="grid gap-5 lg:grid-cols-[2fr_1fr_1fr]">
        {/* Spend trend */}
        <div style={{ ...CARD_STYLE, padding: 24 }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <span style={EYEBROW}>— Spend</span>
              <h3 className="mt-2" style={SECTION_H3}>
                14-day trend
              </h3>
            </div>
            <div
              className="rounded-full px-3 py-1 text-[11px] font-medium tabular-nums"
              style={{
                background: "var(--le-tile-sky-bg)",
                color: "var(--le-tile-sky-ink)",
              }}
            >
              {formatCents(last7Cost + prev7Cost)} total
            </div>
          </div>
          <div className="mt-6 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStatsData} margin={{ top: 10, right: 0, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--le-chart-1)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--le-chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
                />
                <Tooltip
                  cursor={{ stroke: "var(--le-chart-1)", strokeWidth: 1, strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    fontSize: 11,
                    padding: 10,
                    color: "hsl(var(--popover-foreground))",
                    boxShadow: "var(--le-card-shadow)",
                  }}
                  formatter={(v: number) => formatCents(v)}
                />
                <Area
                  type="monotone"
                  dataKey="total_cost_cents"
                  stroke="var(--le-chart-1)"
                  strokeWidth={2.5}
                  fill="url(#spendArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SLA ring */}
        <div style={{ ...CARD_STYLE, padding: 24 }}>
          <div className="flex items-center gap-3">
            <IconBadge tone={slaRing}>
              <Clock className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Delivery SLA</span>
              <h3 className="mt-1" style={SECTION_H3}>
                Under 72h
              </h3>
            </div>
          </div>
          <div className="mt-6 flex flex-col items-center">
            <div className="relative h-[170px] w-[170px]">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="54" stroke="hsl(var(--border))" strokeWidth="7" fill="none" />
                <motion.circle
                  cx="60"
                  cy="60"
                  r="54"
                  stroke={slaRingInk}
                  strokeWidth="7"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={slaDash}
                  initial={{ strokeDashoffset: slaDash }}
                  animate={{ strokeDashoffset: slaOffset }}
                  transition={{ duration: 1.4, ease: EASE }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span style={{ ...BIG_VALUE, fontSize: 30 }}>{slaRate.toFixed(0)}%</span>
                <span
                  className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em]"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  on time
                </span>
              </div>
            </div>
            <p className="mt-5 text-[11px] tabular-nums text-muted-foreground">
              {onTime} of {completedProps.length} delivered
            </p>
          </div>
        </div>

        {/* Status distribution */}
        <div style={{ ...CARD_STYLE, padding: 24 }}>
          <div className="flex items-center gap-3">
            <IconBadge tone="peach">
              <Building2 className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Distribution</span>
              <h3 className="mt-1" style={SECTION_H3}>
                All listings
              </h3>
            </div>
          </div>
          <div className="mt-6 space-y-4">
            {[
              { key: "delivered", label: "Delivered", color: "var(--le-tile-mint-ink)", count: statusBuckets.delivered },
              { key: "inFlight", label: "In flight", color: "var(--le-tile-sky-ink)", count: statusBuckets.inFlight },
              { key: "queued", label: "Queued", color: "var(--le-tile-peach-ink)", count: statusBuckets.queued },
              { key: "failed", label: "Failed", color: "var(--le-tile-rose-ink)", count: statusBuckets.failed },
            ].map((row) => {
              const pct = totalProps > 0 ? (row.count / totalProps) * 100 : 0;
              return (
                <div key={row.key}>
                  <div className="flex items-baseline justify-between">
                    <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: row.color }}
                      />
                      {row.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {row.count} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: row.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, ease: EASE }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-6 text-[11px] tabular-nums text-muted-foreground">
            {deliveredPct.toFixed(0)}% delivered lifetime
          </p>
        </div>
      </section>

      {/* ─── Throughput + leaderboard ─── */}
      <section className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        {/* Throughput */}
        <div style={{ ...CARD_STYLE, padding: 24 }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBadge tone="sky">
                <Sparkles className="h-5 w-5" strokeWidth={1.75} />
              </IconBadge>
              <div>
                <span style={EYEBROW}>— Throughput</span>
                <h3 className="mt-1" style={SECTION_H3}>
                  Videos delivered
                </h3>
              </div>
            </div>
            <div
              className="rounded-full px-3 py-1 text-[11px] font-medium tabular-nums"
              style={{
                background: "var(--le-tile-mint-bg)",
                color: "var(--le-tile-mint-ink)",
              }}
            >
              {last7Videos} this week
            </div>
          </div>
          <div className="mt-6 h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStatsData.slice(-14)} margin={{ top: 10, right: 0, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="throughputBar" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--le-chart-3)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--le-chart-3)" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--le-tile-mint-bg)" }}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 10,
                    fontSize: 11,
                    padding: 10,
                    color: "hsl(var(--popover-foreground))",
                    boxShadow: "var(--le-card-shadow)",
                  }}
                />
                <Bar dataKey="properties_completed" fill="url(#throughputBar)" radius={[6, 6, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top agents */}
        <div style={{ ...CARD_STYLE, padding: 24 }}>
          <div className="flex items-center gap-3">
            <IconBadge tone="lavender">
              <Trophy className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Leaderboard</span>
              <h3 className="mt-1" style={SECTION_H3}>
                Top agents
              </h3>
            </div>
          </div>
          <ul className="mt-6 space-y-4">
            {topAgents.length === 0 && (
              <li className="text-xs text-muted-foreground">No agent data yet</li>
            )}
            {topAgents.map(([name, entry], i) => {
              const rank = i + 1;
              const rankTone: TileTone =
                rank === 1 ? "peach" : rank === 2 ? "sky" : rank === 3 ? "mint" : "lavender";
              const rankColors = TILE_TONES[rankTone];
              return (
                <li key={name} className="flex items-center gap-3">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums"
                    style={{ background: rankColors.bg, color: rankColors.ink }}
                  >
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{name}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                      {entry.count} videos · {formatCents(entry.cost)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── Cost breakdown ─── */}
      <section style={{ ...CARD_STYLE, padding: 0, overflow: "hidden" }}>
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <IconBadge tone="rose">
              <DollarSign className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Cost drill-down</span>
              <h3 className="mt-1" style={SECTION_H3}>
                Spend by provider · model · scope
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCostExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {costExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Expand
              </>
            )}
          </button>
        </div>

        {costExpanded && (
          <div>
            <div className="flex gap-1 border-b border-border bg-muted/40 px-4 py-2">
              {(["provider", "scope", "stage", "model"] as CostTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setCostTab(tab)}
                  className={`rounded-full px-4 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                    costTab === tab
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  By {tab}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-6 py-3 text-left text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {costTab === "provider"
                        ? "Provider"
                        : costTab === "scope"
                        ? "Scope"
                        : costTab === "stage"
                        ? "Stage"
                        : "Model"}
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Today
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      7d
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      30d
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Events (30d)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows: CostBreakdownRow[] =
                      costTab === "provider"
                        ? costBreakdown?.byProvider ?? []
                        : costTab === "scope"
                        ? costBreakdown?.byScope ?? []
                        : costTab === "stage"
                        ? costBreakdown?.byStage ?? []
                        : costBreakdown?.byModel ?? [];
                    if (!costBreakdown) {
                      return (
                        <tr>
                          <td colSpan={5} className="px-6 py-10 text-center text-xs text-muted-foreground">
                            Loading breakdown…
                          </td>
                        </tr>
                      );
                    }
                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={5} className="px-6 py-10 text-center text-xs text-muted-foreground">
                            No cost events in the last 30 days
                          </td>
                        </tr>
                      );
                    }
                    return rows.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-border/60 transition-colors hover:bg-muted/40"
                      >
                        <td className="px-6 py-3.5 text-sm font-medium text-foreground">{row.key}</td>
                        <td className="px-4 py-3.5 text-right text-xs tabular-nums">
                          {row.today.cents > 0 ? (
                            formatCents(row.today.cents)
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs tabular-nums">
                          {row.week.cents > 0 ? (
                            formatCents(row.week.cents)
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right text-sm font-semibold tabular-nums">
                          {formatCents(row.month.cents)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-xs tabular-nums text-muted-foreground">
                          {row.month.events.toLocaleString()}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            <p className="border-t border-border bg-muted/30 px-6 py-3 text-[11px] text-muted-foreground">
              Numbers look off? Run{" "}
              <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                npx tsx scripts/cost-reconcile.ts --since &lt;date&gt;
              </code>{" "}
              and cross-check against provider invoices. Drift &gt;5% should be investigated before high-volume work.
            </p>
          </div>
        )}
      </section>

      {/* ─── Active pipeline ─── */}
      <section style={{ ...CARD_STYLE, padding: 0, overflow: "hidden" }}>
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <IconBadge tone="peach">
              <Activity className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Active</span>
              <h3 className="mt-1" style={SECTION_H3}>
                In production
              </h3>
            </div>
          </div>
          <Link
            to="/dashboard/pipeline"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View pipeline <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div>
          <div
            className="grid grid-cols-[3fr_1.2fr_1.5fr_1fr] gap-6 border-y border-border px-6 py-3"
            style={{ background: "hsl(var(--muted) / 0.4)" }}
          >
            <span style={EYEBROW}>Property</span>
            <span style={EYEBROW}>Stage</span>
            <span style={EYEBROW}>Progress</span>
            <span className="text-right" style={EYEBROW}>
              Started
            </span>
          </div>
          {inProgressProps.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No properties in pipeline</div>
          ) : (
            inProgressProps.slice(0, 8).map((p, i) => {
              const progress = statusToProgress[p.status] ?? 0;
              const tone: TileTone =
                progress >= 80 ? "mint" : progress >= 40 ? "sky" : "peach";
              const toneInk = TILE_TONES[tone].ink;
              const toneBg = TILE_TONES[tone].bg;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: i * 0.03, ease: EASE }}
                  className="grid grid-cols-[3fr_1.2fr_1.5fr_1fr] items-center gap-6 border-b border-border/60 px-6 py-4 transition-colors hover:bg-muted/30"
                >
                  <Link
                    to={`/dashboard/properties/${p.id}`}
                    className="truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {p.address}
                  </Link>
                  <span
                    className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] capitalize"
                    style={{ background: toneBg, color: toneInk }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: toneInk }}
                    />
                    {p.status.replace("_", " ")}
                  </span>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: toneInk }}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 1, ease: EASE }}
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {getRelativeTime(p.created_at)}
                  </span>
                </motion.div>
              );
            })
          )}
        </div>
      </section>

      {/* ─── Recent deliveries ─── */}
      <section style={{ ...CARD_STYLE, padding: 0, overflow: "hidden" }}>
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <IconBadge tone="mint">
              <Film className="h-5 w-5" strokeWidth={1.75} />
            </IconBadge>
            <div>
              <span style={EYEBROW}>— Recent</span>
              <h3 className="mt-1" style={SECTION_H3}>
                Delivered
              </h3>
            </div>
          </div>
          <Link
            to="/dashboard/properties"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            All listings <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div>
          <div
            className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-6 border-y border-border px-6 py-3"
            style={{ background: "hsl(var(--muted) / 0.4)" }}
          >
            <span style={EYEBROW}>Property</span>
            <span style={EYEBROW}>Completed</span>
            <span style={EYEBROW}>Duration</span>
            <span className="text-right" style={EYEBROW}>
              Cost
            </span>
          </div>
          {completedProps.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No completed properties yet</div>
          ) : (
            completedProps.slice(0, 10).map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.03, ease: EASE }}
                className="grid grid-cols-[3fr_1fr_1fr_1fr] items-center gap-6 border-b border-border/60 px-6 py-4 transition-colors hover:bg-muted/30"
              >
                <Link
                  to={`/dashboard/properties/${p.id}`}
                  className="truncate text-sm font-medium text-foreground hover:underline"
                >
                  {p.address}
                </Link>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {getRelativeTime(p.updated_at)}
                </span>
                <span className="text-xs tabular-nums text-foreground">
                  {formatDuration(p.processing_time_ms)}
                </span>
                <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(p.total_cost_cents)}
                </span>
              </motion.div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export default Overview;
