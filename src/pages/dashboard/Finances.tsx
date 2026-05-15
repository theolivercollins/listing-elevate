import { useEffect, useState } from "react";
import { KpiCard, Card, Sparkline, fmtCents } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_DAILY, SAMPLE_FINANCE_ROWS } from "@/components/dashboard/sample-data";
import {
  fetchCostBreakdown,
  fetchDailyStats,
  fetchStatsOverview,
  type CostBreakdown,
  type CostBreakdownRow,
} from "@/lib/api";
import type { DailyStat } from "@/lib/types";

// ─── Legend dot helper ────────────────────────────────────────────
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// ─── View-model row (normalised from live or sample data) ─────────
interface BreakdownRow {
  name: string;
  today: number;   // cents
  week: number;    // cents
  month: number;   // cents
  events: number;
  share: number;   // 0–100
}

function toBreakdownRows(rows: CostBreakdownRow[]): BreakdownRow[] {
  const totalMonth = rows.reduce((s, r) => s + r.month.cents, 0) || 1;
  return rows.map((r) => ({
    name: r.key,
    today: r.today.cents,
    week: r.week.cents,
    month: r.month.cents,
    events: r.month.events,
    share: Math.round((r.month.cents / totalMonth) * 100),
  }));
}

function sampleRows(): BreakdownRow[] {
  return SAMPLE_FINANCE_ROWS.map((r) => ({
    name: r.provider,
    today: r.today,
    week: r.week,
    month: r.month,
    events: r.events,
    share: r.share,
  }));
}

// ─── Delta helper ─────────────────────────────────────────────────
// Returns percentage change rounded to 1 dp, or undefined if either value is 0.
function pctDelta(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─── Finances page ────────────────────────────────────────────────
const TABS = ["provider", "model", "scope", "stage"] as const;
type Tab = (typeof TABS)[number];

export default function Finances() {
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [overviewAvgCents, setOverviewAvgCents] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("provider");

  useEffect(() => {
    // Fetch 30 days so we can compare current-14 vs prior-14 for MTD delta
    fetchDailyStats(30)
      .then(({ stats }) => setDailyStats(stats))
      .catch(() => {/* fall back to sample */});
    fetchCostBreakdown()
      .then(setCostBreakdown)
      .catch(() => {/* fall back to sample */});
    fetchStatsOverview()
      .then(({ avgCostPerVideoCents }) => setOverviewAvgCents(avgCostPerVideoCents))
      .catch(() => {/* fall back to derived */});
  }, []);

  // ── derive display data ──────────────────────────────────────────
  const liveDailyAvailable = dailyStats.length > 0;

  // cost series for sparkline (last 14 days)
  const costSeries = liveDailyAvailable
    ? dailyStats.slice(-14).map((d) => d.total_cost_cents)
    : SAMPLE_DAILY.map((d) => d.cost);

  // total for chart header (last-14 slice)
  const totalSpend14 = costSeries.reduce((s, c) => s + c, 0);

  // ── KPI: Spend · MTD ────────────────────────────────────────────
  // Sum month.cents across all byProvider rows; delta = last-14 vs prior-14 from daily.
  const mtdCents = (() => {
    if (costBreakdown?.byProvider?.length) {
      return costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0);
    }
    // fallback: use dailyStats total if available
    if (liveDailyAvailable) return dailyStats.slice(-14).reduce((s, d) => s + d.total_cost_cents, 0);
    return SAMPLE_DAILY.reduce((s, d) => s + d.cost, 0);
  })();

  // Delta for MTD: compare last-14 days vs prior-14 days from DAILY
  const mtdDelta = (() => {
    if (!liveDailyAvailable) return undefined;
    const last14 = dailyStats.slice(-14).reduce((s, d) => s + d.total_cost_cents, 0);
    const prior14 = dailyStats.slice(-28, -14).reduce((s, d) => s + d.total_cost_cents, 0);
    if (prior14 === 0) {
      // Only 14 days available — split into halves
      const half = Math.floor(dailyStats.length / 2);
      const recentHalf = dailyStats.slice(half).reduce((s, d) => s + d.total_cost_cents, 0);
      const earlierHalf = dailyStats.slice(0, half).reduce((s, d) => s + d.total_cost_cents, 0);
      return pctDelta(recentHalf, earlierHalf);
    }
    return pctDelta(last14, prior14);
  })();

  // ── KPI: Avg / video ────────────────────────────────────────────
  // Prefer overview API's avgCostPerVideoCents; fall back to deriving from daily.
  const avgPerVideo = (() => {
    if (overviewAvgCents !== null && overviewAvgCents > 0) return overviewAvgCents;
    if (liveDailyAvailable) {
      const last14 = dailyStats.slice(-14);
      const totalVideos = last14.reduce((s, d) => s + d.properties_completed, 0);
      const totalCost = last14.reduce((s, d) => s + d.total_cost_cents, 0);
      return totalVideos > 0 ? Math.round(totalCost / totalVideos) : 0;
    }
    return 84200; // $842 in cents — sample fallback
  })();

  // Delta for avg/video: current 7-day avg vs prior 7-day avg
  const avgVideoDelta = (() => {
    if (!liveDailyAvailable) return undefined;
    function weekAvg(slice: DailyStat[]): number {
      const vids = slice.reduce((s, d) => s + d.properties_completed, 0);
      const cost = slice.reduce((s, d) => s + d.total_cost_cents, 0);
      return vids > 0 ? cost / vids : 0;
    }
    const recent7 = weekAvg(dailyStats.slice(-7));
    const prior7 = weekAvg(dailyStats.slice(-14, -7));
    return pctDelta(recent7, prior7);
  })();

  // ── breakdown rows keyed by tab ──────────────────────────────────
  function getRows(): BreakdownRow[] {
    if (!costBreakdown) return sampleRows();
    const map: Record<Tab, CostBreakdownRow[]> = {
      provider: costBreakdown.byProvider,
      model: costBreakdown.byModel,
      scope: costBreakdown.byScope,
      stage: costBreakdown.byStage,
    };
    const live = map[tab];
    return live && live.length > 0 ? toBreakdownRows(live) : sampleRows();
  }
  const rows = getRows();

  // ── KPI: Top driver ─────────────────────────────────────────────
  // Use byProvider specifically (tab-independent) for a stable "top driver".
  const topDriverRow = (() => {
    if (costBreakdown?.byProvider?.length) {
      const totalMonth = costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0) || 1;
      return costBreakdown.byProvider
        .map((r) => ({ key: r.key, share: Math.round((r.month.cents / totalMonth) * 100) }))
        .reduce((a, b) => (a.share > b.share ? a : b));
    }
    // fallback: use current tab rows
    if (rows.length > 0) {
      return rows.map((r) => ({ key: r.name, share: r.share })).reduce((a, b) => (a.share > b.share ? a : b));
    }
    return null;
  })();

  const topDriverValue = topDriverRow
    ? topDriverRow.key.charAt(0).toUpperCase() + topDriverRow.key.slice(1)
    : "—";
  const topDriverSub = topDriverRow ? `${topDriverRow.share}% of total spend` : "no data";

  // Reconcile button handler — surfaces the CLI command
  function handleReconcile() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const cmd = `Run: npx tsx scripts/cost-reconcile.ts --since ${since}`;
    console.info(cmd);
    window.alert(cmd);
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 4-up KPI row ───────────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Spend · MTD"
          value={fmtCents(mtdCents)}
          sub="vs prior period"
          delta={mtdDelta}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Avg / video"
          value={fmtCents(avgPerVideo)}
          sub="vs prior 7 days"
          delta={avgVideoDelta}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Top driver"
          value={topDriverValue}
          sub={topDriverSub}
        />
        <KpiCard
          label="Reconcile drift"
          value="—"
          sub="reconcile script not run today"
        />
      </section>

      {/* ── Spend chart ────────────────────────────────────────────── */}
      <Card padding={24}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <span className="le-d-label">Spend over time</span>
            <h3
              style={{
                margin: "4px 0 0",
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtCents(totalSpend14)} · last 14 days
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <LegendDot color="var(--accent)" label="Spend" />
            <LegendDot color="oklch(0.7 0.14 168)" label="Budget" />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Sparkline data={costSeries} color="var(--accent)" height={220} showDots />
        </div>
      </Card>

      {/* ── Provider / model / scope / stage breakdown ─────────────── */}
      <Card padding={24}>
        {/* header row: segmented control + reconcile button */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div
            className="le-seg"
            style={{
              display: "inline-flex",
              padding: 4,
              borderRadius: 999,
              background: "rgba(15,24,60,0.05)",
            }}
          >
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="le-seg-item"
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "none",
                  background: tab === t ? "var(--ink)" : "transparent",
                  color: tab === t ? "#fff" : "var(--muted)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "capitalize",
                  transition: "background .15s, color .15s",
                }}
              >
                By {t}
              </button>
            ))}
          </div>
          <button
            className="le-btn-ghost"
            onClick={handleReconcile}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 14px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            <Icon name="upload" size={14} />
            Reconcile
          </button>
        </div>

        {/* table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr",
            gap: 16,
            padding: "10px 14px",
            borderBottom: "1px solid rgba(15,24,60,0.06)",
          }}
        >
          {[
            { label: tab === "provider" ? "Provider" : tab === "model" ? "Model" : tab === "scope" ? "Scope" : "Stage", align: "left" },
            { label: "Today", align: "right" },
            { label: "7d", align: "right" },
            { label: "30d", align: "right" },
            { label: "Events", align: "right" },
            { label: "Share", align: "left" },
          ].map(({ label, align }) => (
            <span
              key={label}
              className="le-d-label"
              style={{
                textAlign: align as "left" | "right",
                fontSize: 12,
                color: "var(--muted)",
                fontWeight: 500,
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {/* table body */}
        {rows.map((r) => (
          <div
            key={r.name}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr",
              gap: 16,
              padding: "14px 14px",
              borderBottom: "1px solid rgba(15,24,60,0.04)",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{r.name}</span>

            <span
              className="le-tabular"
              style={{
                fontSize: 12.5,
                textAlign: "right",
                color: "var(--muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtCents(r.today)}
            </span>

            <span
              className="le-tabular"
              style={{
                fontSize: 12.5,
                textAlign: "right",
                color: "var(--muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtCents(r.week)}
            </span>

            <span
              className="le-tabular"
              style={{
                fontSize: 14,
                fontWeight: 600,
                textAlign: "right",
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtCents(r.month)}
            </span>

            <span
              className="le-tabular"
              style={{
                fontSize: 12,
                textAlign: "right",
                color: "var(--muted-2)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {r.events.toLocaleString()}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  flex: 1,
                  height: 5,
                  background: "rgba(15,24,60,0.06)",
                  borderRadius: 99,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${r.share}%`,
                    background: "var(--accent)",
                    borderRadius: 99,
                  }}
                />
              </div>
              <span
                className="le-tabular"
                style={{
                  fontSize: 11,
                  color: "var(--muted-2)",
                  width: 28,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {r.share}%
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
