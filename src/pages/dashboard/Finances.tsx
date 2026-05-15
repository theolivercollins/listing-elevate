import { useEffect, useState } from "react";
import { KpiCard, Card, Sparkline, fmtCents } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_DAILY, SAMPLE_FINANCE_ROWS } from "@/components/dashboard/sample-data";
import {
  fetchCostBreakdown,
  fetchDailyStats,
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

// ─── Finances page ────────────────────────────────────────────────
const TABS = ["provider", "model", "scope", "stage"] as const;
type Tab = (typeof TABS)[number];

export default function Finances() {
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [tab, setTab] = useState<Tab>("provider");

  useEffect(() => {
    fetchDailyStats(14)
      .then(({ stats }) => setDailyStats(stats))
      .catch(() => {/* fall back to sample */});
    fetchCostBreakdown()
      .then(setCostBreakdown)
      .catch(() => {/* fall back to sample */});
  }, []);

  // ── derive display data ──────────────────────────────────────────
  const dailyForUI = dailyStats.length > 0 ? dailyStats : SAMPLE_DAILY;

  // daily cost values: DailyStat uses total_cost_cents; SAMPLE_DAILY uses cost
  const costSeries = dailyStats.length > 0
    ? dailyStats.map((d) => d.total_cost_cents)
    : SAMPLE_DAILY.map((d) => d.cost);

  const totalSpend = costSeries.reduce((s, c) => s + c, 0);

  // KPI: avg cost per video from live data, else sample-derived
  const avgPerVideo = dailyStats.length > 0
    ? (() => {
        const totalVideos = dailyStats.reduce((s, d) => s + d.properties_completed, 0);
        return totalVideos > 0 ? Math.round(totalSpend / totalVideos) : 0;
      })()
    : 84200; // $842 in cents — matches prototype

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

  // top driver for KPI card
  const topDriver = rows.length > 0 ? rows.reduce((a, b) => (a.share > b.share ? a : b)).name : "—";

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 4-up KPI row ───────────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Spend · MTD"
          value={fmtCents(totalSpend)}
          sub="vs $1.84k budget"
          delta={-12.4}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Avg / video"
          value={fmtCents(avgPerVideo)}
          sub="-$0.18 from last week"
          delta={-2.1}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Top driver"
          value={topDriver}
          sub={`${rows[0]?.share ?? 0}% of total spend`}
          delta={4.2}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Reconcile drift"
          value="2.1%"
          sub="under 5% threshold"
          delta={-0.4}
          deltaPositiveIsGood={false}
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
              }}
            >
              {fmtCents(totalSpend)} · last 14 days
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
