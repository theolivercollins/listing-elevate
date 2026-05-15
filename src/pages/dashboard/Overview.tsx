import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { Property, DailyStat } from "@/lib/types";
import { fetchProperties, fetchDailyStats, fetchStatsOverview, fetchCostBreakdown } from "@/lib/api";
import {
  PageHeading,
  KpiCard,
  StatusPill,
  Sparkline,
  Bars,
  Ring,
  PropertyThumb,
  AIBanner,
  MiniStat,
  ActivityItem,
  SectionTitle,
  fmtCents,
  fmtRel,
} from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import {
  SAMPLE_PROPERTIES,
  SAMPLE_DAILY,
  SAMPLE_ACTIVITY,
  SAMPLE_AGENTS,
  SAMPLE_PROVIDER_MIX,
} from "@/components/dashboard/sample-data";

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

// ─── adapter: live Property → sample-compatible shape ────────────────────────
interface UIProperty {
  id: string;
  address: string;
  status: string;
  photos: number;
  agent: string;
  created_at: number;
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
    progress: STATUS_PROGRESS[p.status] ?? 0,
    // Deterministic hue from id characters
    thumb_hue: 200 + ((p.id.charCodeAt(0) ?? 0) * 23) % 160,
  };
}

const IN_FLIGHT_STATUSES = new Set(["ingesting", "analyzing", "scripting", "generating", "qc", "assembling"]);

interface OverviewProps {
  showAIBanner?: boolean;
}

const Overview = ({ showAIBanner = true }: OverviewProps) => {
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [dailyStatsData, setDailyStatsData] = useState<DailyStat[]>([]);
  const [stats, setStats] = useState<{
    completedToday: number;
    inPipeline: number;
    successRate: number;
  } | null>(null);
  const [chartRange, setChartRange] = useState<"7d" | "14d" | "30d">("14d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [allRes, dailyRes, overviewRes] = await Promise.all([
          fetchProperties({ limit: 100 }),
          fetchDailyStats(14),
          fetchStatsOverview(),
          fetchCostBreakdown().catch(() => null),
        ]);
        if (cancelled) return;
        setAllProps(allRes.properties);
        setDailyStatsData(dailyRes.stats);
        setStats(overviewRes);
      } catch {
        // fall through — sample data will be used
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ── fallback to sample data when live rows are empty ──────────────────────
  const propsForUI: UIProperty[] =
    allProps.length > 0
      ? allProps.map(adaptLiveProp)
      : SAMPLE_PROPERTIES;

  const dailyForUI =
    dailyStatsData.length > 0
      ? dailyStatsData.map((d) => ({
          date: d.date,
          cost: d.total_cost_cents ?? 0,
          videos: d.properties_completed ?? 0,
          sla: 90,
        }))
      : SAMPLE_DAILY;

  const activityForUI = SAMPLE_ACTIVITY;

  const inProgressForUI = propsForUI.filter((p) => IN_FLIGHT_STATUSES.has(p.status)).slice(0, 5);

  // ── top agents: derive from live allProps or fall back to sample ──────────
  const agentMap = new Map<string, { videos: number; spend: number; company: string }>();
  for (const p of allProps) {
    const key = p.listing_agent || "—";
    const e = agentMap.get(key) || { videos: 0, spend: 0, company: "" };
    e.videos += 1;
    e.spend += p.total_cost_cents || 0;
    agentMap.set(key, e);
  }
  const topAgentsFromLive = Array.from(agentMap.entries())
    .sort((a, b) => b[1].videos - a[1].videos)
    .slice(0, 5)
    .map(([name, e]) => ({ name, company: e.company, videos: e.videos, spend: e.spend }));

  const agentsForUI = topAgentsFromLive.length > 0 ? topAgentsFromLive : SAMPLE_AGENTS.slice(0, 5);

  // ── KPI metrics ──────────────────────────────────────────────────────────
  const rangeLen = chartRange === "7d" ? 7 : chartRange === "30d" ? 30 : 14;
  const last7Cost = dailyForUI.slice(-7).reduce((s, d) => s + d.cost, 0);
  const prev7Cost = dailyForUI.slice(0, 7).reduce((s, d) => s + d.cost, 0);
  const costDelta = prev7Cost > 0 ? ((last7Cost - prev7Cost) / prev7Cost) * 100 : 0;

  const inFlightCount = propsForUI.filter((p) => IN_FLIGHT_STATUSES.has(p.status)).length;
  const deliveredToday = stats?.completedToday ?? propsForUI.filter((p) => p.status === "complete").length;
  const qcPassRate = stats?.successRate != null ? (stats.successRate * 100).toFixed(1) + "%" : "94.3%";

  // ── chart slice based on range ────────────────────────────────────────────
  const chartData = dailyForUI.slice(-rangeLen);

  // ── SLA ring ─────────────────────────────────────────────────────────────
  const avgSla = dailyForUI.length > 0
    ? Math.round(dailyForUI.reduce((s, d) => s + d.sla, 0) / dailyForUI.length)
    : 91;
  const slaMof = Math.round((avgSla / 100) * 156);

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 24, height: 24, borderRadius: 99, border: "2px solid var(--line)", borderTopColor: "var(--ink)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="le-fade-up">

      {/* ── Page heading ─────────────────────────────────────────────── */}
      <PageHeading
        eyebrow={todayLabel()}
        title="Good morning, Oliver."
        sub={`${deliveredToday} videos delivered overnight, ${inFlightCount} still in flight. Two scenes need a decision — both already routed to manual review.`}
        actions={
          <>
            <button type="button" className="le-btn-ghost">
              <Icon name="play" size={13} />
              Today's brief
            </button>
            <Link to="/upload" className="le-btn-dark">
              <Icon name="plus" size={13} />
              New listing
            </Link>
          </>
        }
      />

      {/* ── AI banner ────────────────────────────────────────────────── */}
      {showAIBanner && <AIBanner />}

      {/* ── KPI row ──────────────────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 16 }}>
        <KpiCard
          label="Delivered today"
          value={String(deliveredToday)}
          sub="6 hours ago"
          delta={18.4}
        />
        <KpiCard
          label="In production"
          value={String(inFlightCount)}
          sub="across 7 stages"
          delta={null}
        />
        <KpiCard
          label="Spend · 7d"
          value={fmtCents(last7Cost)}
          sub="all providers"
          delta={costDelta}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="QC pass rate"
          value={qcPassRate}
          sub="38 manual, rest auto"
          delta={1.2}
        />
      </section>

      {/* ── Spend chart + SLA ring ────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Spend insights */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
            <div>
              <span className="le-d-label">Spend insights</span>
              <h3 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 600, letterSpacing: "-0.022em", color: "var(--ink)" }}>
                {fmtCents(last7Cost)}{" "}
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
          <Bars
            data={chartData.map((d) => ({
              label: d.date.slice(3),
              value: d.cost,
              tooltip: fmtCents(d.cost),
            }))}
            accentIndex={chartData.length - 1}
            height={220}
          />
        </div>

        {/* Delivery SLA */}
        <div className="le-card" style={{ padding: 24, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <span className="le-d-label">Delivery SLA</span>
              <h3 style={{ margin: "6px 0 0", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)" }}>
                Under 72 hours
              </h3>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, color: "var(--good)",
              padding: "3px 8px", borderRadius: 999, background: "rgba(47, 138, 85, 0.10)",
            }}>
              ↑ 2.1%
            </span>
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <Ring value={avgSla} size={170} stroke={12} label="On-time" sub={`${slaMof} of 156`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
            <MiniStat label="Avg turnaround" value="42m" />
            <MiniStat label="P95" value="1h 12m" />
          </div>
        </div>
      </section>

      {/* ── In production + Activity ─────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* In production */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle eyebrow="In production" title={`${inProgressForUI.length} listings moving`} />
            <button type="button" className="le-btn-ghost">
              View pipeline
              <Icon name="chevron-right" size={12} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                <div style={{ width: 120, height: 5, background: "rgba(11,11,16,0.08)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${p.progress}%`,
                    background: "var(--ink)",
                    borderRadius: 99,
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
              style={{ width: 7, height: 7, borderRadius: 99, background: "var(--good)", color: "var(--good)", flexShrink: 0 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {activityForUI.map((a, i) => (
              <ActivityItem key={i} kind={a.kind} title={a.title} sub={a.sub} time={a.time} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Provider mix + Leaderboard ───────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1.7fr", gap: 16 }}>

        {/* Provider mix */}
        <div className="le-card" style={{ padding: 24 }}>
          <span className="le-d-label">Provider mix · 30d</span>
          <h3 style={{ margin: "6px 0 18px", fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--ink)" }}>
            1,284 scenes generated
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {SAMPLE_PROVIDER_MIX.map((p) => (
              <div key={p.provider}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{p.provider}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{p.value}%</span>
                </div>
                <div style={{ height: 5, background: "rgba(11,11,16,0.06)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${p.value}%`, background: "var(--ink)", borderRadius: 99, transition: "width .8s" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top agents leaderboard */}
        <div className="le-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <SectionTitle eyebrow="Leaderboard" title="Top agents this month" />
            <button type="button" className="le-btn-ghost">
              All agents
              <Icon name="chevron-right" size={12} />
            </button>
          </div>
          <div>
            {agentsForUI.map((a, i) => (
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
                    width: 30, height: 30, borderRadius: 99,
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
                  {fmtCents(a.spend)}
                </span>
                <div style={{ width: 100, marginLeft: "auto" }}>
                  <Sparkline data={[3, 5, 4, 6, 7, 5, 8, 9, 8, 11, 10, 12]} color="var(--ink)" height={26} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
};

export default Overview;
