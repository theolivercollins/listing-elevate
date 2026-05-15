import { useState, useEffect, type CSSProperties } from "react";
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
import { AlertTriangle, Loader2, ArrowRight, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCents, formatDuration, getRelativeTime } from "@/lib/types";
import type { Property, DailyStat } from "@/lib/types";
import { fetchProperties, fetchDailyStats, fetchStatsOverview, fetchCostBreakdown } from "@/lib/api";
import type { CostBreakdown, CostBreakdownRow } from "@/lib/api";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.45)",
};
const PAGE_H1: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: "clamp(28px, 4vw, 44px)",
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 0.98,
  color: "#fff",
  margin: 0,
};
const SECTION_H3: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 20,
  fontWeight: 500,
  letterSpacing: "-0.025em",
  color: "#fff",
  margin: 0,
};
const MONO_VALUE: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 24,
  fontWeight: 600,
  letterSpacing: "-0.02em",
  color: "#fff",
};

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function Delta({ value, positiveIsGood = true }: { value: number; positiveIsGood?: boolean }) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className="label text-muted-foreground/50">— 0%</span>;
  }
  const up = value > 0;
  const good = up === positiveIsGood;
  const color = good ? "text-accent" : "text-destructive";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`label inline-flex items-center gap-1 ${color}`}>
      <Icon className="h-3 w-3" strokeWidth={2} />
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
      <div className="border border-destructive/40 bg-destructive/5 p-10">
        <div className="flex items-start gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <span style={{ ...EYEBROW, color: "hsl(var(--destructive))" }}>— Error</span>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
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

  // Split daily stats into "previous 7" vs "latest 7" for delta
  const last7 = dailyStatsData.slice(-7);
  const prev7 = dailyStatsData.slice(-14, -7);
  const last7Cost = last7.reduce((s, d) => s + (d.total_cost_cents ?? 0), 0);
  const prev7Cost = prev7.reduce((s, d) => s + (d.total_cost_cents ?? 0), 0);
  const costDelta = prev7Cost > 0 ? ((last7Cost - prev7Cost) / prev7Cost) * 100 : 0;

  const last7Videos = last7.reduce((s, d) => s + (d.properties_completed ?? 0), 0);
  const prev7Videos = prev7.reduce((s, d) => s + (d.properties_completed ?? 0), 0);
  const videoDelta = prev7Videos > 0 ? ((last7Videos - prev7Videos) / prev7Videos) * 100 : 0;

  // Status distribution across all properties
  const statusBuckets = { queued: 0, inFlight: 0, delivered: 0, failed: 0 };
  for (const p of allProps) {
    if (p.status === "complete") statusBuckets.delivered++;
    else if (p.status === "queued") statusBuckets.queued++;
    else if (p.status === "failed" || p.status === "needs_review") statusBuckets.failed++;
    else statusBuckets.inFlight++;
  }
  const totalProps = allProps.length || 1;
  const deliveredPct = (statusBuckets.delivered / totalProps) * 100;

  // Delivery SLA — fraction of completed videos delivered within 72h
  const onTime = completedProps.filter(
    (p) => p.processing_time_ms != null && p.processing_time_ms < 72 * 60 * 60 * 1000,
  ).length;
  const slaRate = completedProps.length > 0 ? (onTime / completedProps.length) * 100 : 0;
  const slaDash = 2 * Math.PI * 54; // circumference
  const slaOffset = slaDash * (1 - slaRate / 100);

  // Top agents leaderboard
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

  // KPI tiles (4 big + 2 accent)
  const kpis = [
    {
      label: "Videos today",
      value: String(stats?.completedToday ?? 0).padStart(2, "0"),
      sub: `${stats?.submittedToday ?? 0} submitted`,
      delta: videoDelta,
    },
    {
      label: "In production",
      value: String(stats?.inPipeline ?? 0).padStart(2, "0"),
      sub: "across all stages",
      delta: 0,
    },
    {
      label: "Avg turnaround",
      value: formatDuration(stats?.avgProcessingMs ?? 0),
      sub: "per video",
      delta: 0,
    },
    {
      label: "Spend · 7d",
      value: formatCents(last7Cost),
      sub: "all providers",
      delta: costDelta,
    },
  ];

  return (
    <div className="space-y-16">
      {/* Page heading — compact so the dashboard feels dense like a control room */}
      <div className="flex items-end justify-between gap-6">
        <div>
          <span style={EYEBROW}>— Today</span>
          <h2 className="mt-3" style={PAGE_H1}>Studio overview</h2>
        </div>
      </div>

      {/* ─── KPI row ─── */}
      <section className="grid gap-px border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: i * 0.05, ease: EASE }}
            className="bg-background p-8"
          >
            <div className="flex items-start justify-between gap-3">
              <span style={EYEBROW}>{k.label}</span>
              <Delta value={k.delta} positiveIsGood={k.label !== "Spend · 7d"} />
            </div>
            <div className="mt-6" style={{ ...MONO_VALUE, fontSize: 36 }}>{k.value}</div>
            <p className="mt-3 text-xs text-muted-foreground">{k.sub}</p>
          </motion.div>
        ))}
      </section>

      {/* ─── Trend + SLA ring + Status donut — 3-column info-dense row ─── */}
      <section className="grid gap-px border border-border bg-border lg:grid-cols-[2fr_1fr_1fr]">
        {/* Spend trend — area chart */}
        <div className="bg-background p-8">
          <div className="flex items-end justify-between">
            <div>
              <span style={EYEBROW}>— Spend</span>
              <h3 className="mt-3" style={SECTION_H3}>14-day trend</h3>
            </div>
            <span className="tabular text-xs text-muted-foreground" style={{ fontFamily: "var(--le-font-sans)" }}>
              {formatCents(last7Cost + prev7Cost)} total
            </span>
          </div>
          <div className="mt-8 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStatsData} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" stroke="rgba(220,230,255,0.09)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)", fontFamily: "var(--le-font-sans)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)", fontFamily: "var(--le-font-sans)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
                />
                <Tooltip
                  cursor={{ stroke: "#fff", strokeWidth: 1 }}
                  contentStyle={{
                    background: "#0b0d12",
                    border: "1px solid rgba(220,230,255,0.18)",
                    borderRadius: 0,
                    fontSize: 11,
                    padding: 10,
                    color: "#fff",
                  }}
                  formatter={(v: number) => formatCents(v)}
                />
                <Area
                  type="monotone"
                  dataKey="total_cost_cents"
                  stroke="#fff"
                  strokeWidth={1.5}
                  fill="url(#spendArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Delivery SLA ring */}
        <div className="bg-background p-8">
          <span style={EYEBROW}>— Delivery SLA</span>
          <h3 className="mt-3" style={SECTION_H3}>Under 72h</h3>
          <div className="mt-8 flex flex-col items-center">
            <div className="relative h-[180px] w-[180px]">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="54" stroke="hsl(var(--border))" strokeWidth="6" fill="none" />
                <motion.circle
                  cx="60"
                  cy="60"
                  r="54"
                  stroke="hsl(var(--accent))"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={slaDash}
                  initial={{ strokeDashoffset: slaDash }}
                  animate={{ strokeDashoffset: slaOffset }}
                  transition={{ duration: 1.6, ease: EASE }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span style={{ ...MONO_VALUE, fontSize: 30 }}>
                  {slaRate.toFixed(0)}%
                </span>
                <span className="mt-1" style={EYEBROW}>on time</span>
              </div>
            </div>
            <p className="tabular mt-6 text-[11px] text-muted-foreground">
              {onTime} of {completedProps.length} delivered
            </p>
          </div>
        </div>

        {/* Status distribution */}
        <div className="bg-background p-8">
          <span style={EYEBROW}>— Distribution</span>
          <h3 className="mt-3" style={SECTION_H3}>All listings</h3>
          <div className="mt-8 space-y-5">
            {[
              { key: "delivered", label: "Delivered", tone: "bg-accent", count: statusBuckets.delivered },
              { key: "inFlight", label: "In flight", tone: "bg-foreground", count: statusBuckets.inFlight },
              { key: "queued", label: "Queued", tone: "bg-muted-foreground", count: statusBuckets.queued },
              { key: "failed", label: "Failed", tone: "bg-destructive", count: statusBuckets.failed },
            ].map((row) => {
              const pct = totalProps > 0 ? (row.count / totalProps) * 100 : 0;
              return (
                <div key={row.key}>
                  <div className="flex items-baseline justify-between">
                    <span style={{ ...EYEBROW, color: "#fff" }}>{row.label}</span>
                    <span className="text-xs" style={{ fontFamily: "var(--le-font-sans)", color: "rgba(255,255,255,0.55)" }}>
                      {row.count} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-2 h-[3px] w-full bg-border">
                    <motion.div
                      className={`h-full ${row.tone}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1.1, ease: EASE }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="tabular mt-10 text-[11px] text-muted-foreground">
            {deliveredPct.toFixed(0)}% delivered lifetime
          </p>
        </div>
      </section>

      {/* ─── Video throughput + Top agents — 2-column row ─── */}
      <section className="grid gap-px border border-border bg-border lg:grid-cols-[2fr_1fr]">
        {/* Videos delivered per day — bar chart */}
        <div className="bg-background p-8">
          <div className="flex items-end justify-between">
            <div>
              <span style={EYEBROW}>— Throughput</span>
              <h3 className="mt-3" style={SECTION_H3}>Videos delivered</h3>
            </div>
            <span className="tabular text-xs text-muted-foreground" style={{ fontFamily: "var(--le-font-sans)" }}>
              {last7Videos} this week
            </span>
          </div>
          <div className="mt-8 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStatsData.slice(-14)} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="rgba(220,230,255,0.09)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)", fontFamily: "var(--le-font-sans)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.45)", fontFamily: "var(--le-font-sans)" }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.06)" }}
                  contentStyle={{
                    background: "#0b0d12",
                    border: "1px solid rgba(220,230,255,0.18)",
                    borderRadius: 0,
                    fontSize: 11,
                    padding: 10,
                    color: "#fff",
                  }}
                />
                <Bar dataKey="properties_completed" fill="#fff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top agents */}
        <div className="bg-background p-8">
          <span style={EYEBROW}>— Leaderboard</span>
          <h3 className="mt-3" style={SECTION_H3}>Top agents</h3>
          <ul className="mt-8 space-y-5">
            {topAgents.length === 0 && (
              <li className="text-xs text-muted-foreground">No agent data yet</li>
            )}
            {topAgents.map(([name, entry], i) => (
              <li key={name} className="flex items-center gap-4">
                <span className="tabular w-6 text-xs font-medium text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="tabular mt-1 text-[10px] text-muted-foreground">
                    {entry.count} videos · {formatCents(entry.cost)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── Cost breakdown ─── */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <span className="label text-muted-foreground">— Cost drill-down</span>
            <h3 className="mt-3 text-xl font-semibold tracking-[-0.01em]">Spend by provider / model / scope</h3>
          </div>
          <button
            onClick={() => setCostExpanded((v) => !v)}
            className="label inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {costExpanded ? (
              <><ChevronUp className="h-3 w-3" /> Collapse</>
            ) : (
              <><ChevronDown className="h-3 w-3" /> Expand</>
            )}
          </button>
        </div>

        {costExpanded && (
          <div className="mt-10 border border-border">
            {/* Tab bar */}
            <div className="flex border-b border-border">
              {(["provider", "scope", "stage", "model"] as CostTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCostTab(tab)}
                  className={`label px-6 py-4 capitalize transition-colors ${
                    costTab === tab
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  By {tab}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="label px-6 py-3 text-left text-muted-foreground font-normal">
                      {costTab === "provider" ? "Provider" : costTab === "scope" ? "Scope" : costTab === "stage" ? "Stage" : "Model"}
                    </th>
                    <th className="label px-4 py-3 text-right text-muted-foreground font-normal">Today</th>
                    <th className="label px-4 py-3 text-right text-muted-foreground font-normal">7d</th>
                    <th className="label px-4 py-3 text-right text-muted-foreground font-normal">30d</th>
                    <th className="label px-4 py-3 text-right text-muted-foreground font-normal">Events (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows: CostBreakdownRow[] =
                      costTab === "provider"
                        ? (costBreakdown?.byProvider ?? [])
                        : costTab === "scope"
                        ? (costBreakdown?.byScope ?? [])
                        : costTab === "stage"
                        ? (costBreakdown?.byStage ?? [])
                        : (costBreakdown?.byModel ?? []);
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
                    return rows.map((row, i) => (
                      <tr
                        key={row.key}
                        className={`border-b border-border transition-colors hover:bg-secondary/40 ${
                          i % 2 === 0 ? "" : "bg-secondary/10"
                        }`}
                      >
                        <td className="px-6 py-4 font-medium">{row.key}</td>
                        <td className="tabular px-4 py-4 text-right text-xs">
                          {row.today.cents > 0 ? formatCents(row.today.cents) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="tabular px-4 py-4 text-right text-xs">
                          {row.week.cents > 0 ? formatCents(row.week.cents) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="tabular px-4 py-4 text-right text-sm font-semibold">
                          {formatCents(row.month.cents)}
                        </td>
                        <td className="tabular px-4 py-4 text-right text-xs text-muted-foreground">
                          {row.month.events.toLocaleString()}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            {/* Footer nudge */}
            <p className="border-t border-border px-6 py-4 text-[11px] text-muted-foreground/60">
              Numbers look off? Run{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-sans text-[10px]">
                npx tsx scripts/cost-reconcile.ts --since &lt;date&gt;
              </code>{" "}
              and cross-check against your provider invoices. Drift &gt;5% should be investigated before high-volume work.
            </p>
          </div>
        )}
      </section>

      {/* ─── Active pipeline ─── */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <span style={EYEBROW}>— Active</span>
            <h3 className="mt-3" style={SECTION_H3}>In production</h3>
          </div>
          <Link
            to="/dashboard/pipeline"
            className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
            style={EYEBROW}
          >
            View pipeline <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-10 border-t border-border">
          <div className="grid grid-cols-[3fr_1.2fr_1.5fr_1fr] gap-6 border-b border-border py-4" style={{ background: "rgba(255,255,255,0.03)" }}>
            <span style={EYEBROW}>Property</span>
            <span style={EYEBROW}>Stage</span>
            <span style={EYEBROW}>Progress</span>
            <span className="text-right" style={EYEBROW}>Started</span>
          </div>
          {inProgressProps.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No properties in pipeline</div>
          ) : (
            inProgressProps.slice(0, 8).map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.03, ease: EASE }}
                className="grid grid-cols-[3fr_1.2fr_1.5fr_1fr] items-center gap-6 border-b border-border py-5 transition-colors duration-500 hover:bg-secondary/40"
              >
                <Link
                  to={`/dashboard/properties/${p.id}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {p.address}
                </Link>
                <span className="capitalize" style={{ ...EYEBROW, color: "#fff" }}>{p.status.replace("_", " ")}</span>
                <div className="h-px w-full bg-border">
                  <motion.div
                    className="h-full bg-foreground"
                    initial={{ width: 0 }}
                    animate={{ width: `${statusToProgress[p.status] || 0}%` }}
                    transition={{ duration: 1, ease: EASE }}
                  />
                </div>
                <span className="tabular text-right text-xs text-muted-foreground">
                  {getRelativeTime(p.created_at)}
                </span>
              </motion.div>
            ))
          )}
        </div>
      </section>

      {/* ─── Recent deliveries ─── */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <span style={EYEBROW}>— Recent</span>
            <h3 className="mt-3" style={SECTION_H3}>Delivered</h3>
          </div>
          <Link
            to="/dashboard/properties"
            className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
            style={EYEBROW}
          >
            All listings <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-10 border-t border-border">
          <div className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-6 border-b border-border py-4" style={{ background: "rgba(255,255,255,0.03)" }}>
            <span style={EYEBROW}>Property</span>
            <span style={EYEBROW}>Completed</span>
            <span style={EYEBROW}>Duration</span>
            <span className="text-right" style={EYEBROW}>Cost</span>
          </div>
          {completedProps.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No completed properties yet</div>
          ) : (
            completedProps.slice(0, 10).map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.03, ease: EASE }}
                className="grid grid-cols-[3fr_1fr_1fr_1fr] items-center gap-6 border-b border-border py-5 transition-colors duration-500 hover:bg-secondary/40"
              >
                <Link
                  to={`/dashboard/properties/${p.id}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {p.address}
                </Link>
                <span className="tabular text-xs text-muted-foreground">{getRelativeTime(p.updated_at)}</span>
                <span className="tabular text-xs">{formatDuration(p.processing_time_ms)}</span>
                <span className="tabular text-right text-sm font-semibold">{formatCents(p.total_cost_cents)}</span>
              </motion.div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};

export default Overview;
