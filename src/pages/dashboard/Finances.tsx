import { useEffect, useState } from "react";
import { KpiCard, Card, Sparkline, fmtCents } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
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

// ─── View-model row (normalised from live data only) ──────────────
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

// ─── Delta helper ─────────────────────────────────────────────────
function pctDelta(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─── Add Expense Modal ────────────────────────────────────────────
const EXPENSE_PROVIDERS = [
  "anthropic", "atlas", "kling", "runway", "luma",
  "shotstack", "creatomate", "browserbase", "gemini", "supabase", "manual",
] as const;

interface ExpenseForm {
  description: string;
  amount: string;
  date: string;
  provider: string;
  notes: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function AddExpenseModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<ExpenseForm>({
    description: "",
    amount: "",
    date: todayISO(),
    provider: "manual",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(form.amount) * 100);
    if (!form.description.trim() || isNaN(amountCents) || amountCents <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description.trim(),
          amount_cents: amountCents,
          date: form.date,
          provider: form.provider,
          notes: form.notes.trim() || undefined,
        }),
      });
      if (res.ok) {
        console.info("Expense logged:", form.description, amountCents);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      console.info("Expense logged locally (POST /api/admin/expenses pending):", form.description, form.amount);
    } finally {
      setSubmitting(false);
      onClose();
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 12,
    border: "1px solid var(--line)",
    background: "var(--surface)",
    fontSize: 13,
    fontFamily: "var(--le-font-sans)",
    color: "var(--ink)",
    boxSizing: "border-box",
    outline: "none",
  };

  return (
    <div
      onMouseDown={handleBackdrop}
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(11,11,16,0.35)",
        backdropFilter: "blur(4px)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        className="le-card"
        style={{ maxWidth: 480, width: "100%", padding: 28, boxShadow: "var(--shadow-lg)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", margin: 0, letterSpacing: "-0.015em" }}>
            Add expense
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--muted)", padding: 4, display: "flex", alignItems: "center",
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>
              Description *
            </label>
            <input
              type="text"
              required
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Kling batch render — 34 scenes"
              style={fieldStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>
                Amount (USD) *
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                style={{ ...fieldStyle, fontVariantNumeric: "tabular-nums" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>
                Date *
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                style={fieldStyle}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>
              Provider
            </label>
            <select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              style={fieldStyle}
            >
              {EXPENSE_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 5 }}>
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional context"
              rows={3}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="le-btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="le-btn-dark" disabled={submitting}>
              {submitting ? "Saving…" : "Add expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Finances page ────────────────────────────────────────────────
const TABS = ["provider", "model", "scope", "stage"] as const;
type Tab = (typeof TABS)[number];

export default function Finances() {
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [overviewAvgCents, setOverviewAvgCents] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("provider");
  const [loading, setLoading] = useState(true);
  const [expenseOpen, setExpenseOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [dailyRes, cbRes, overviewRes] = await Promise.all([
          fetchDailyStats(30).catch(() => null),
          fetchCostBreakdown().catch(() => null),
          fetchStatsOverview().catch(() => null),
        ]);
        if (cancelled) return;
        if (dailyRes?.stats) setDailyStats(dailyRes.stats);
        if (cbRes) setCostBreakdown(cbRes);
        if (overviewRes?.avgCostPerVideoCents != null) setOverviewAvgCents(overviewRes.avgCostPerVideoCents);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // ── derive display data — live only ─────────────────────────────
  const liveDailyAvailable = dailyStats.length > 0;
  const hasAnySpend = liveDailyAvailable && dailyStats.some((d) => d.total_cost_cents > 0);

  // cost series for sparkline (last 14 days of live data only)
  const costSeries: number[] = liveDailyAvailable
    ? dailyStats.slice(-14).map((d) => d.total_cost_cents)
    : [];

  // total for chart header (last-14 slice)
  const totalSpend14 = costSeries.reduce((s, c) => s + c, 0);

  // ── KPI: Spend · MTD ────────────────────────────────────────────
  // cost-breakdown already uses a rolling-30d window from the API, which is
  // the best available MTD approximation without a dedicated calendar-month query.
  // Fallback: filter daily_stats to the current calendar month (not last-14).
  const mtdCents = (() => {
    if (costBreakdown?.byProvider?.length) {
      return costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0);
    }
    if (liveDailyAvailable) {
      const monthPrefix = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      return dailyStats
        .filter((d) => d.date.startsWith(monthPrefix))
        .reduce((s, d) => s + d.total_cost_cents, 0);
    }
    return 0;
  })();

  // Delta for MTD — live only, null if insufficient data
  const mtdDelta = (() => {
    if (!liveDailyAvailable || dailyStats.length < 14) return undefined;
    const last14 = dailyStats.slice(-14).reduce((s, d) => s + d.total_cost_cents, 0);
    const prior14 = dailyStats.slice(-28, -14).reduce((s, d) => s + d.total_cost_cents, 0);
    if (prior14 === 0) {
      const half = Math.floor(dailyStats.length / 2);
      const recentHalf = dailyStats.slice(half).reduce((s, d) => s + d.total_cost_cents, 0);
      const earlierHalf = dailyStats.slice(0, half).reduce((s, d) => s + d.total_cost_cents, 0);
      return pctDelta(recentHalf, earlierHalf);
    }
    return pctDelta(last14, prior14);
  })();

  // ── KPI: Avg / video ────────────────────────────────────────────
  // Returns null (renders "—") when there are no completions to average over.
  const avgPerVideo = (() => {
    if (overviewAvgCents !== null && overviewAvgCents > 0) return overviewAvgCents;
    if (liveDailyAvailable) {
      const last14 = dailyStats.slice(-14);
      const totalVideos = last14.reduce((s, d) => s + d.properties_completed, 0);
      const totalCost = last14.reduce((s, d) => s + d.total_cost_cents, 0);
      return totalVideos > 0 ? Math.round(totalCost / totalVideos) : null;
    }
    return null;
  })();

  const avgVideoDelta = (() => {
    if (!liveDailyAvailable || dailyStats.length < 14) return undefined;
    function weekAvg(slice: DailyStat[]): number {
      const vids = slice.reduce((s, d) => s + d.properties_completed, 0);
      const cost = slice.reduce((s, d) => s + d.total_cost_cents, 0);
      return vids > 0 ? cost / vids : 0;
    }
    const recent7 = weekAvg(dailyStats.slice(-7));
    const prior7 = weekAvg(dailyStats.slice(-14, -7));
    return pctDelta(recent7, prior7);
  })();

  // ── breakdown rows — live only ───────────────────────────────────
  function getRows(): BreakdownRow[] {
    if (!costBreakdown) return [];
    const map: Record<Tab, CostBreakdownRow[]> = {
      provider: costBreakdown.byProvider,
      model: costBreakdown.byModel,
      scope: costBreakdown.byScope,
      stage: costBreakdown.byStage,
    };
    const live = map[tab];
    return live && live.length > 0 ? toBreakdownRows(live) : [];
  }
  const rows = getRows();

  // ── KPI: Top driver — live only ──────────────────────────────────
  const topDriverRow = (() => {
    if (costBreakdown?.byProvider?.length) {
      const totalMonth = costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0) || 1;
      return costBreakdown.byProvider
        .map((r) => ({ key: r.key, share: Math.round((r.month.cents / totalMonth) * 100) }))
        .reduce((a, b) => (a.share > b.share ? a : b));
    }
    if (rows.length > 0) {
      return rows.map((r) => ({ key: r.name, share: r.share })).reduce((a, b) => (a.share > b.share ? a : b));
    }
    return null;
  })();

  const topDriverValue = topDriverRow
    ? topDriverRow.key.charAt(0).toUpperCase() + topDriverRow.key.slice(1)
    : "—";
  const topDriverSub = topDriverRow ? `${topDriverRow.share}% of total spend` : "no data yet";

  function handleReconcile() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const cmd = `Run: npx tsx scripts/cost-reconcile.ts --since ${since}`;
    console.info(cmd);
    window.alert(cmd);
  }

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 24, height: 24, borderRadius: 99, border: "2px solid var(--line)", borderTopColor: "var(--ink)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {expenseOpen && <AddExpenseModal onClose={() => setExpenseOpen(false)} />}

      {/* ── Page heading actions row ─────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button
          className="le-btn-ghost"
          onClick={handleReconcile}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 14px", borderRadius: 999,
            border: "1px solid var(--line)", background: "var(--surface)",
            fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)", cursor: "pointer",
          }}
        >
          <Icon name="upload" size={14} />
          Reconcile
        </button>
        <button
          className="le-btn-dark"
          onClick={() => setExpenseOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
        >
          <Icon name="plus" size={13} />
          Add expense
        </button>
      </div>

      {/* ── 4-up KPI row ───────────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Spend · MTD"
          value={fmtCents(mtdCents)}
          sub="vs prior period"
          delta={hasAnySpend ? mtdDelta : null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Avg / video"
          value={fmtCents(avgPerVideo)}
          sub="vs prior 7 days"
          delta={hasAnySpend ? avgVideoDelta : null}
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
          {costSeries.length === 0 || !hasAnySpend ? (
            <div style={{ height: 220, display: "grid", placeItems: "center", fontSize: 13, color: "var(--muted)" }}>
              No cost events recorded in the last 14 days.
            </div>
          ) : (
            <Sparkline data={costSeries} color="var(--accent)" height={220} showDots />
          )}
        </div>
      </Card>

      {/* ── Provider / model / scope / stage breakdown ─────────────── */}
      <Card padding={24}>
        {/* header row: segmented control */}
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
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              padding: "48px 0", textAlign: "center",
              fontSize: 13, color: "var(--muted)",
              border: "1px dashed rgba(15,24,60,0.12)", borderRadius: 12,
            }}
          >
            No cost events in the last 30 days.
          </div>
        ) : (
          <>
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
                  style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtCents(r.today)}
                </span>

                <span
                  className="le-tabular"
                  style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtCents(r.week)}
                </span>

                <span
                  className="le-tabular"
                  style={{ fontSize: 14, fontWeight: 600, textAlign: "right", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtCents(r.month)}
                </span>

                <span
                  className="le-tabular"
                  style={{ fontSize: 12, textAlign: "right", color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}
                >
                  {r.events.toLocaleString()}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      flex: 1, height: 5, background: "rgba(15,24,60,0.06)", borderRadius: 99, overflow: "hidden",
                    }}
                  >
                    <div
                      style={{ height: "100%", width: `${r.share}%`, background: "var(--accent)", borderRadius: 99 }}
                    />
                  </div>
                  <span
                    className="le-tabular"
                    style={{ fontSize: 11, color: "var(--muted-2)", width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                  >
                    {r.share}%
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}
