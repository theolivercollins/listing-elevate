import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { Property, DailyStat } from "@/lib/types";
import type { CostBreakdown, ModelHealthRow, ModelHealthResponse } from "@/lib/api";
import { fetchProperties, fetchDailyStats, fetchStatsOverview, fetchCostBreakdown, fetchModelHealth } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  PageHeading,
  KpiCard,
  StatusPill,
  Sparkline,
  Bars,
  Ring,
  PropertyThumb,
  MiniStat,
  ActivityItem,
  SectionTitle,
  fmtMoney,
  fmtRel,
  MoneyValue,
} from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { EmptyState } from "@/components/dashboard/primitives";

// ─── date helpers ────────────────────────────────────────────────────────────
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function todayLabel() {
  const d = new Date();
  return `Today · ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const salutation = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${salutation}, ${name}.`;
}

function deriveName(firstName: string | null | undefined, email: string | null | undefined): string {
  if (firstName?.trim()) return firstName.trim();
  if (email) {
    const local = email.split("@")[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "there";
}

function subHeadline(completedToday: number, inFlight: number, needsReview: number): string {
  const flightStr = `${inFlight} in flight`;
  const reviewStr = needsReview === 0
    ? "All scenes passed automated QC."
    : `${needsReview} ${needsReview === 1 ? "scene needs" : "scenes need"} a decision.`;

  if (completedToday === 0) {
    return `No deliveries yet today. ${inFlight === 0 ? "Nothing in flight." : `${flightStr}.`} ${reviewStr}`;
  }
  const deliveryStr = completedToday === 1
    ? "1 video delivered overnight"
    : `${completedToday} videos delivered overnight`;
  return `${deliveryStr}, ${flightStr}. ${reviewStr}`;
}

// ─── adapter: live Property → sample-compatible shape ────────────────────────
interface UIProperty {
  id: string;
  address: string;
  status: string;
  photos: number;
  agent: string;
  created_at: number;
  updated_at: number;
  progress: number;
  thumb_hue: number;
}

const STATUS_PROGRESS: Record<string, number> = {
  queued: 4,
  ingesting: 14,
  analyzing: 26,
  scripting: 42,
  generating: 64,
  qc: 82,
  assembling: 94,
  complete: 100,
  needs_review: 80,
};

function adaptLiveProp(p: Property): UIProperty {
  return {
    id: p.id,
    address: p.address,
    status: p.status,
    photos: p.photo_count ?? 0,
    agent: p.listing_agent ?? "—",
    created_at: new Date(p.created_at).getTime(),
    updated_at: new Date(p.updated_at).getTime(),
    progress: STATUS_PROGRESS[p.status] ?? 0,
    // Deterministic hue from id characters
    thumb_hue: 200 + ((p.id.charCodeAt(0) ?? 0) * 23) % 160,
  };
}

const IN_FLIGHT_STATUSES = new Set(["ingesting", "analyzing", "scripting", "generating", "qc", "assembling"]);

// ─── derived activity ─────────────────────────────────────────────────────────
interface ActivityEntry {
  kind: "complete" | "review" | "provider" | "upload" | "cost";
  title: string;
  sub: string;
  time: string;
}

function deriveActivity(props: UIProperty[]): ActivityEntry[] {
  const items: ActivityEntry[] = [];

  // Recent completes
  const completes = [...props]
    .filter((p) => p.status === "complete")
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 3);
  for (const p of completes) {
    items.push({ kind: "complete", title: "Video delivered", sub: p.address, time: fmtRel(p.updated_at) });
  }

  // Recent needs_review
  const reviews = props.filter((p) => p.status === "needs_review").slice(0, 2);
  for (const p of reviews) {
    items.push({ kind: "review", title: "Manual review queued", sub: p.address, time: fmtRel(p.updated_at) });
  }

  // Most recent intake
  const newest = [...props].sort((a, b) => b.created_at - a.created_at)[0];
  if (newest) {
    items.push({
      kind: "upload",
      title: "New listing intake",
      sub: `${newest.address} · ${newest.photos} photos`,
      time: fmtRel(newest.created_at),
    });
  }

  return items;
}

// ─── sparkline: weekly buckets from completed properties (case-insensitive) ──
// Returns real weekly delivery buckets for an agent — zero fill when no
// history exists; never fabricates a wave pattern.
function agentSparkline(agentName: string, allProps: Property[]): number[] {
  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const target = agentName.trim().toLowerCase();
  const buckets = Array<number>(12).fill(0);
  for (const p of allProps) {
    if (p.status !== "complete" || (p.listing_agent ?? "").trim().toLowerCase() !== target) continue;
    const age = now - new Date(p.updated_at).getTime();
    const weekIndex = Math.floor(age / WEEK_MS);
    if (weekIndex >= 0 && weekIndex < 12) {
      buckets[11 - weekIndex] += 1;
    }
  }
  return buckets;
}

// ─── Needs-you strip: urgency signals ────────────────────────────────────────
interface NeedsYouItem {
  key: string;
  label: string;
  count: number;
  href: string;
  urgent?: boolean;
}

function NeedsYouStrip({
  needsReview,
  failedToday,
}: {
  needsReview: number;
  failedToday: number;
}) {
  const items: NeedsYouItem[] = [];

  if (needsReview > 0) {
    items.push({
      key: "review",
      label: `${needsReview} ${needsReview === 1 ? "needs" : "need"} review`,
      count: needsReview,
      href: "/dashboard/properties?status=needs_review",
      urgent: needsReview > 3,
    });
  }

  if (failedToday > 0) {
    items.push({
      key: "failed",
      label: `${failedToday} render${failedToday === 1 ? "" : "s"} failed today`,
      count: failedToday,
      href: "/dashboard/logs",
      urgent: true,
    });
  }

  const allClear = items.length === 0;

  return (
    <div
      data-testid="needs-you-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderRadius: 12,
        background: allClear ? "rgba(47, 138, 85, 0.06)" : "rgba(210, 95, 60, 0.06)",
        border: `1px solid ${allClear ? "rgba(47, 138, 85, 0.18)" : "rgba(210, 95, 60, 0.18)"}`,
        marginBottom: 16,
        flexWrap: "wrap" as const,
      }}
    >
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          color: allClear ? "var(--good)" : "var(--warn)",
          marginRight: 4,
          flexShrink: 0,
        }}
      >
        {allClear ? "Needs you" : "Needs you"}
      </span>
      {allClear ? (
        <span
          data-testid="needs-you-all-clear"
          style={{ fontSize: 13, color: "var(--good)", fontWeight: 500 }}
        >
          All clear — nothing requires your attention right now.
        </span>
      ) : (
        <>
          {items.map((item, i) => (
            <span key={item.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {i > 0 && (
                <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--muted-2)", flexShrink: 0 }} />
              )}
              <Link
                to={item.href}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: item.urgent ? "var(--bad)" : "var(--warn)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Icon name="chevron-right" size={11} />
                {item.label}
              </Link>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Provider health row ──────────────────────────────────────────────────────
function ProviderHealthRow({ rows }: { rows: ModelHealthRow[] }) {
  if (rows.length === 0) return null;

  // Balance alert: any provider with balance_errors_24h > 0
  const balanceAlerts = rows.filter((r) => (r.balance_errors_24h ?? 0) > 0);

  return (
    <div
      data-testid="provider-health-row"
      style={{
        display: "flex",
        flexDirection: "column" as const,
        gap: 8,
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(11,11,16,0.025)",
        border: "1px solid var(--line-2)",
        marginBottom: 16,
      }}
    >
      {/* Balance / 402 alert — named, loud */}
      {balanceAlerts.length > 0 && (
        <div
          data-testid="provider-balance-alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid rgba(220, 38, 38, 0.22)",
            marginBottom: 8,
          }}
        >
          <Icon name="activity" size={14} style={{ color: "var(--bad)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)" }}>
            Balance error —{" "}
            {balanceAlerts.map((r) => r.provider).join(", ")}
            {balanceAlerts.length === 1 ? " has" : " have"} insufficient credit
            ({balanceAlerts.reduce((s, r) => s + (r.balance_errors_24h ?? 0), 0)} × HTTP 402 in 24h)
          </span>
          <Link
            to="/dashboard/development/system-status"
            style={{ marginLeft: "auto", fontSize: 12, color: "var(--bad)", textDecoration: "none", fontWeight: 500, flexShrink: 0 }}
          >
            View health →
          </Link>
        </div>
      )}

      {/* Per-provider error rate chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--muted)", marginRight: 4, flexShrink: 0 }}>
          Providers · 24h
        </span>
        {rows.map((r) => {
          const errorRate = r.calls_24h > 0 ? r.failures_24h / r.calls_24h : 0;
          const hasBalanceError = (r.balance_errors_24h ?? 0) > 0;
          const isHealthy = errorRate < 0.05 && !hasBalanceError;
          const isWarn = !isHealthy && errorRate < 0.2 && !hasBalanceError;
          const statusColor = hasBalanceError ? "var(--bad)" : isHealthy ? "var(--good)" : isWarn ? "var(--warn)" : "var(--bad)";
          return (
            <span
              key={r.provider}
              title={`${r.provider}: ${r.calls_24h} calls, ${r.failures_24h} failures${hasBalanceError ? `, ${r.balance_errors_24h} balance errors` : ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 500,
                padding: "4px 10px",
                borderRadius: 999,
                background: isHealthy ? "rgba(47, 138, 85, 0.08)" : "rgba(210, 95, 60, 0.08)",
                color: statusColor,
                border: `1px solid ${isHealthy ? "rgba(47, 138, 85, 0.15)" : "rgba(210, 95, 60, 0.15)"}`,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, background: statusColor, flexShrink: 0 }} />
              {r.provider}
              {r.calls_24h > 0 && (
                <span style={{ opacity: 0.7 }}>
                  {errorRate === 0 ? "ok" : `${Math.round(errorRate * 100)}% err`}
                </span>
              )}
            </span>
          );
        })}
        <Link
          to="/dashboard/development/system-status"
          style={{ fontSize: 12, color: "var(--muted)", textDecoration: "none", marginLeft: "auto", flexShrink: 0 }}
        >
          Details →
        </Link>
      </div>
    </div>
  );
}

interface OverviewProps {
  showAIBanner?: boolean;
}

const Overview = ({ showAIBanner = true }: OverviewProps) => {
  const { user, profile } = useAuth();
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [dailyStatsData, setDailyStatsData] = useState<DailyStat[]>([]);
  const [stats, setStats] = useState<{
    completedToday: number;
    inPipeline: number;
    needsReview: number;
    successRate: number;
    avgProcessingMs: number;
  } | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [modelHealth, setModelHealth] = useState<ModelHealthResponse | null>(null);
  const [chartRange, setChartRange] = useState<"7d" | "14d" | "30d">("14d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [allRes, dailyRes, overviewRes, cbRes, mhRes] = await Promise.all([
          fetchProperties({ limit: 100 }),
          fetchDailyStats(30),
          fetchStatsOverview(),
          fetchCostBreakdown().catch(() => null),
          fetchModelHealth().catch(() => null),
        ]);
        if (cancelled) return;
        setAllProps(allRes.properties);
        setDailyStatsData(dailyRes.stats);
        setStats(overviewRes);
        setCostBreakdown(cbRes);
        setModelHealth(mhRes);
      } catch {
        // fall through — live data not available; $0/0/— degradation applied below
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ── live-only data — no sample fallback for hard numbers ─────────────────
  const propsForUI: UIProperty[] = allProps.map(adaptLiveProp);

  const DAILY = dailyStatsData.length > 0 ? dailyStatsData : null;

  const dailyForUI = DAILY
    ? DAILY.map((d) => ({
        date: d.date,
        cost: d.total_cost_cents ?? 0,
        videos: d.properties_completed ?? 0,
      }))
    : [];

  const inProgressForUI = propsForUI.filter((p) => IN_FLIGHT_STATUSES.has(p.status)).slice(0, 5);

  // ── top agents: derive from live allProps only count COMPLETED deliveries ─
  // Group case-insensitively so "Adam" / "adam" collapse, drop entries with
  // fewer than 2 completed videos (filters out one-off test uploads), and
  // require a real-looking name (>= 2 alphanumeric chars). If nothing meets
  // the threshold we render an empty state instead of sample data.
  const MIN_COMPLETED_FOR_LEADERBOARD = 2;
  const agentMap = new Map<string, { display: string; company: string; videos: number; spend: number }>();
  const titleCase = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  for (const p of allProps) {
    if (p.status !== "complete") continue;
    const raw = (p.listing_agent ?? "").trim();
    if (raw.replace(/[^a-z0-9]/gi, "").length < 2) continue;
    const key = raw.toLowerCase();
    const e = agentMap.get(key) || { display: titleCase(raw), company: p.brokerage ?? "", videos: 0, spend: 0 };
    e.videos += 1;
    e.spend += p.total_cost_cents || 0;
    if (!e.company && p.brokerage) e.company = p.brokerage;
    agentMap.set(key, e);
  }
  const topAgentsFromLive = Array.from(agentMap.values())
    .filter((e) => e.videos >= MIN_COMPLETED_FOR_LEADERBOARD)
    .sort((a, b) => b.spend - a.spend || b.videos - a.videos)
    .slice(0, 5)
    .map((e) => ({ name: e.display, company: e.company, videos: e.videos, spend: e.spend }));

  const agentsForUI = topAgentsFromLive;

  // ── KPI metrics ──────────────────────────────────────────────────────────
  const rangeLen = chartRange === "7d" ? 7 : chartRange === "30d" ? 30 : 14;
  const last7Cost = DAILY ? DAILY.slice(-7).reduce((s, d) => s + (d.total_cost_cents ?? 0), 0) : 0;
  const prev7Cost = DAILY && DAILY.length >= 14 ? DAILY.slice(-14, -7).reduce((s, d) => s + (d.total_cost_cents ?? 0), 0) : 0;
  const costDelta: number | null = (DAILY && DAILY.length >= 14 && prev7Cost > 0) ? ((last7Cost - prev7Cost) / prev7Cost) * 100 : null;

  const inFlightCount = propsForUI.filter((p) => IN_FLIGHT_STATUSES.has(p.status)).length;
  const completedToday = stats?.completedToday ?? 0;
  const needsReviewCount = stats?.needsReview ?? propsForUI.filter((p) => p.status === "needs_review").length;

  // Delivered today delta: (today - prev day) / max(prev, 1)
  const prevDayCompleted = DAILY && DAILY.length >= 2
    ? (DAILY[DAILY.length - 2]?.properties_completed ?? 0)
    : null;
  let deliveredDelta: number | null = null;
  if (prevDayCompleted !== null) {
    if (prevDayCompleted === 0 && completedToday === 0) {
      deliveredDelta = null;
    } else if (prevDayCompleted === 0 && completedToday > 0) {
      deliveredDelta = 100;
    } else {
      deliveredDelta = ((completedToday - prevDayCompleted) / prevDayCompleted) * 100;
    }
  }

  // QC pass rate: stats.successRate or compute from DAILY last7 vs prev7.
  // API may return successRate as a 0–1 fraction OR a 0–100 percent depending on
  // history; detect and clamp so we never display 10000%.
  let qcPassRate: string;
  let qcDelta: number | null = null;
  if (stats?.successRate != null) {
    const raw = stats.successRate;
    const pct = raw > 1 ? Math.min(raw, 100) : raw * 100;
    qcPassRate = pct.toFixed(1) + "%";
    // delta: last7 success rate vs prev7 from DAILY
    if (DAILY && DAILY.length >= 14) {
      const calcRate = (slice: DailyStat[]) => {
        const c = slice.reduce((s, d) => s + (d.properties_completed ?? 0), 0);
        const f = slice.reduce((s, d) => s + (d.properties_failed ?? 0), 0);
        const total = c + f;
        return total > 0 ? c / total : null;
      };
      const last7Rate = calcRate(DAILY.slice(-7));
      const prev7Rate = calcRate(DAILY.slice(-14, -7));
      if (last7Rate !== null && prev7Rate !== null && prev7Rate > 0) {
        qcDelta = ((last7Rate - prev7Rate) / prev7Rate) * 100;
      } else if (last7Rate !== null && prev7Rate === null) {
        qcDelta = null;
      }
    }
  } else if (DAILY && DAILY.length > 0) {
    const c = DAILY.slice(-7).reduce((s, d) => s + (d.properties_completed ?? 0), 0);
    const f = DAILY.slice(-7).reduce((s, d) => s + (d.properties_failed ?? 0), 0);
    const total = c + f;
    qcPassRate = total > 0 ? ((c / total) * 100).toFixed(1) + "%" : "—";
  } else {
    qcPassRate = "—";
  }

  // ── chart slice based on range ────────────────────────────────────────────
  const chartData = dailyForUI.slice(-rangeLen);

  // ── SLA ring ─────────────────────────────────────────────────────────────
  // Compute on-time rate from live delivery data: completed / (completed + failed)
  // over the last 30 days. Degrades to null when no data yet.
  const totalCompleted = DAILY ? DAILY.reduce((s, d) => s + (d.properties_completed ?? 0), 0) : 0;
  const totalFailed = DAILY ? DAILY.reduce((s, d) => s + (d.properties_failed ?? 0), 0) : 0;
  const slaTotal = totalCompleted + totalFailed;
  // slaRate: 0-100 representing on-time percentage; null when no data
  const slaRate: number | null = slaTotal > 0 ? Math.round((totalCompleted / slaTotal) * 100) : null;

  // ── Activity feed — live only, no sample fallback ────────────────────────
  const activityForUI = allProps.length > 0 ? deriveActivity(propsForUI) : [];

  // ── Provider mix ──────────────────────────────────────────────────────────
  const cbProviders = costBreakdown?.byProvider ?? [];
  const totalMonthCents = cbProviders.reduce((s, r) => s + (r.month?.cents ?? 0), 0);
  // Live only — no sample fallback; empty array → EmptyState rendered below
  const providerMixForUI = totalMonthCents > 0
    ? cbProviders
        .filter((r) => (r.month?.cents ?? 0) > 0)
        .map((r) => ({
          provider: r.key,
          value: Math.round(((r.month?.cents ?? 0) / totalMonthCents) * 100),
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  const VIDEO_PROVIDERS = new Set(["atlas", "runway", "kling", "runway gen-4", "kling 2.0", "kling 2.6 pro"]);
  const totalScenesGenerated = totalMonthCents > 0
    ? cbProviders
        .filter((r) => VIDEO_PROVIDERS.has(r.key.toLowerCase()))
        .reduce((s, r) => s + (r.month?.events ?? 0), 0)
    : null;

  const userName = deriveName(profile?.first_name, user?.email);

  // ── Derived: failed renders today (from daily stats) ──────────────────────
  const failedToday = DAILY && DAILY.length > 0
    ? (DAILY[DAILY.length - 1]?.properties_failed ?? 0)
    : 0;

  // ── Provider health rows (for health strip) ────────────────────────────────
  const healthRows = modelHealth?.rows ?? [];

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 24, height: 24, borderRadius: 999, border: "2px solid var(--line)", borderTopColor: "var(--ink)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="le-fade-up">

      {/* ── Page heading ─────────────────────────────────────────────── */}
      <PageHeading
        eyebrow={todayLabel()}
        title={greeting(userName)}
        sub={subHeadline(completedToday, inFlightCount, needsReviewCount)}
        actions={
          <>
            <Link to="/dashboard/logs" className="le-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="play" size={13} />
              Today's brief
            </Link>
            <Link to="/upload" className="le-btn-dark">
              <Icon name="plus" size={13} />
              New listing
            </Link>
          </>
        }
      />

      {/* ── Needs you strip ──────────────────────────────────────────── */}
      <NeedsYouStrip needsReview={needsReviewCount} failedToday={failedToday} />

      {/* ── Provider health row ──────────────────────────────────────── */}
      <ProviderHealthRow rows={healthRows} />

      {/* ── KPI row ──────────────────────────────────────────────────── */}
      <section className="le-cols-2-lg le-stack-sm" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <KpiCard
          label="Delivered today"
          value={String(completedToday)}
          sub={completedToday === 0 ? "none yet today" : `${completedToday === 1 ? "1 video" : `${completedToday} videos`} today`}
          delta={deliveredDelta}
        />
        <KpiCard
          label="In production"
          value={String(inFlightCount)}
          sub="across 7 stages"
          delta={null}
        />
        <KpiCard
          label="Spend · 7d"
          value={<MoneyValue cents={last7Cost} />}
          sub="all providers"
          delta={costDelta}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="QC pass rate"
          value={qcPassRate}
          sub={`${needsReviewCount} manual, rest auto`}
          delta={qcDelta}
        />
      </section>

      {/* ── Spend chart + SLA ring ────────────────────────────────────── */}
      <section className="le-stack-lg" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Spend insights */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <span className="le-d-label">Spend insights</span>
              <h3 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 600, letterSpacing: "-0.022em", color: "var(--ink)" }}>
                <MoneyValue cents={last7Cost} />{" "}
                <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 14 }}>· this week</span>
              </h3>
            </div>
            <div className="le-seg">
              {(["7d", "14d", "30d"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`le-seg-item${chartRange === r ? " is-active" : ""}`}
                  onClick={() => setChartRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          {chartData.length === 0 ? (
            <div style={{ height: 220, display: "grid", placeItems: "center", fontSize: 13, color: "var(--muted)" }}>
              No cost events yet.
            </div>
          ) : (
            <Bars
              data={chartData.map((d) => ({
                label: d.date.slice(3),
                value: d.cost,
                tooltip: fmtMoney(d.cost),
              }))}
              accentIndex={chartData.length - 1}
              height={220}
            />
          )}
        </div>

        {/* Delivery SLA — live data only, no fabricated deltas or denominators */}
        <div className="le-card" style={{ padding: 24, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <span className="le-d-label">Delivery SLA</span>
              <h3 style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)" }}>
                Under 72 hours
              </h3>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
            {slaRate === null ? (
              <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: "24px 0" }}>
                No delivery data yet.
              </div>
            ) : (
              <Ring
                value={slaRate}
                size={170}
                stroke={12}
                label="On-time"
                sub={`${totalCompleted} of ${slaTotal}`}
              />
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
            <MiniStat
              label="Completed · 30d"
              value={slaTotal > 0 ? String(totalCompleted) : "—"}
            />
            <MiniStat
              label="Failed · 30d"
              value={slaTotal > 0 ? String(totalFailed) : "—"}
            />
          </div>
        </div>
      </section>

      {/* ── In production + Activity ─────────────────────────────────── */}
      <section className="le-stack-lg" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* In production */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle eyebrow="In production" title={`${inProgressForUI.length} listings moving`} />
            <Link to="/dashboard/pipeline" className="le-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              View pipeline
              <Icon name="chevron-right" size={12} />
            </Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inProgressForUI.length === 0 && (
              <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
                No properties in pipeline yet.
              </div>
            )}
            {inProgressForUI.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  gap: 14,
                  alignItems: "center",
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "rgba(11,11,16,0.025)",
                }}
              >
                <PropertyThumb hue={p.thumb_hue} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink)" }}>
                    {p.address}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, fontSize: 12, color: "var(--muted)" }}>
                    <StatusPill status={p.status} />
                    <span>{p.photos} photos</span>
                    <span>· {p.agent}</span>
                  </div>
                </div>
                <div style={{ width: 120, height: 5, background: "rgba(11,11,16,0.08)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${p.progress}%`,
                    background: "var(--ink)",
                    borderRadius: 999,
                    transition: "width .8s",
                  }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 11.5, minWidth: 50, justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" }}>
                  <Icon name="clock" size={12} />
                  {fmtRel(p.created_at)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity feed */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle eyebrow="Activity" title="Last 60 minutes" />
            <span
              className="le-dot-pulse"
              style={{ width: 7, height: 7, borderRadius: 999, background: "var(--good)", color: "var(--good)", flexShrink: 0 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activityForUI.length === 0 ? (
              <EmptyState message="No activity yet. Events will appear here as listings move through the pipeline." />
            ) : (
              activityForUI.map((a, i) => (
                <ActivityItem key={i} kind={a.kind} title={a.title} sub={a.sub} time={a.time} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* ── Provider mix + Leaderboard ───────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr", gap: 16 }}>

        {/* Provider mix */}
        <div className="le-card" style={{ padding: 24 }}>
          <span className="le-d-label">Provider mix · 30d</span>
          <h3 style={{ margin: "6px 0 18px", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)" }}>
            {totalScenesGenerated !== null && totalScenesGenerated > 0
              ? `${totalScenesGenerated.toLocaleString()} scenes generated`
              : "No scenes generated yet"}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {providerMixForUI.length === 0 ? (
              <EmptyState message="No scenes generated yet this month." />
            ) : (
              providerMixForUI.map((p) => (
                <div key={p.provider}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{p.provider}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{p.value}%</span>
                  </div>
                  <div style={{ height: 5, background: "rgba(11,11,16,0.06)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.value}%`, background: "var(--ink)", borderRadius: 999, transition: "width .8s" }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top agents leaderboard */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle eyebrow="Leaderboard" title="Top agents this month" />
            <Link to="/dashboard/users" className="le-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              All agents
              <Icon name="chevron-right" size={12} />
            </Link>
          </div>
          <div className="le-table-scroll is-wide">
            {agentsForUI.length === 0 && (
              <div style={{ padding: "28px 4px", fontSize: 13, color: "var(--muted)" }}>
                Not enough delivered listings yet to rank agents.
              </div>
            )}
            {agentsForUI.map((a, i) => {
              // Always derive from live data — no synthetic fallback.
              const sparkData = agentSparkline(a.name, allProps);
              return (
                <div
                  key={a.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1.6fr 1fr 1fr 1fr 100px",
                    gap: 14,
                    alignItems: "center",
                    padding: "12px 4px",
                    borderTop: i === 0 ? "none" : "1px solid var(--line-2)",
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--muted-2)", fontWeight: 600, width: 18, fontVariantNumeric: "tabular-nums" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 999,
                      background: `linear-gradient(135deg, hsl(${210 + i * 22}, 8%, 56%), hsl(${230 + i * 30}, 8%, 38%))`,
                      display: "grid", placeItems: "center",
                      color: "#fff", fontWeight: 600, fontSize: 10.5,
                    }}>
                      {a.name.split(" ").map((s) => s[0]).join("")}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{a.name}</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{a.company}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                    {a.videos}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                    <MoneyValue cents={a.spend} />
                  </span>
                  <div style={{ width: 100, marginLeft: "auto" }}>
                    <Sparkline data={sparkData} color="var(--ink)" height={26} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

    </div>
  );
};

export default Overview;
