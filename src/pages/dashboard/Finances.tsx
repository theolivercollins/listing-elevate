import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// New-dashboard primitives (Card, KpiCard, Sparkline, fmtCents)
import {
  KpiCard,
  Card,
  Sparkline,
  fmtCents as fmtCentsPrim,
} from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// Old-dashboard finances lib (token_purchases, expenses, revenue_entries, cost_events)
import {
  listTokenPurchases,
  createTokenPurchase,
  updateTokenPurchase,
  deleteTokenPurchase,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  listRevenueEntries,
  createRevenueEntry,
  updateRevenueEntry,
  deleteRevenueEntry,
  listCostEvents,
  countDeliveredVideos,
} from "@/lib/finances";
import type {
  TokenPurchase,
  Expense,
  RevenueEntry,
  TokenProvider,
  CostEvent,
} from "@/lib/types";

// Cost-breakdown API (provider / model / scope / stage buckets from cost_events)
import {
  fetchCostBreakdown,
  fetchDailyStats,
  fetchStatsOverview,
  type CostBreakdown,
  type CostBreakdownRow,
} from "@/lib/api";
import type { DailyStat } from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

// Claude runs through a Pro subscription — API cost events for Anthropic should
// not count toward dollar totals. Units are still tracked.
const EXCLUDED_FROM_DOLLARS = new Set<TokenProvider>(["anthropic"]);

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const PROVIDERS: { id: TokenProvider; label: string }[] = [
  { id: "runway", label: "Runway" },
  { id: "kling", label: "Kling" },
  { id: "luma", label: "Luma" },
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "other", label: "Other" },
];

const PROVIDER_COLORS: Record<TokenProvider, string> = {
  runway: "#6366f1",
  kling: "#22d3ee",
  luma: "#f97316",
  anthropic: "#d97706",
  openai: "#10b981",
  other: "#64748b",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderSummary {
  provider: TokenProvider;
  label: string;
  purchasedCents: number;
  purchasedUnits: number;
  spentCents: number;
  spentUnits: number;
}

interface BreakdownRow {
  name: string;
  today: number;
  week: number;
  month: number;
  events: number;
  share: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMoneyToCents(value: string): number {
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
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

function pctDelta(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ─── Legend helper ────────────────────────────────────────────────────────────

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

// ─── Breakdown tabs ───────────────────────────────────────────────────────────

const BREAKDOWN_TABS = ["provider", "model", "scope", "stage"] as const;
type BreakdownTab = (typeof BREAKDOWN_TABS)[number];

// ─── Card style (matches old Finances ledger sections) ────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 16,
  boxShadow: "var(--shadow-sm, 0 1px 4px rgba(11,11,16,0.06))",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function Finances() {
  // ── Ledger state (token_purchases, expenses, revenue_entries) ────────────
  const [purchases, setPurchases] = useState<TokenPurchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [revenues, setRevenues] = useState<RevenueEntry[]>([]);
  const [costEvents, setCostEvents] = useState<CostEvent[]>([]);
  const [deliveredCount, setDeliveredCount] = useState<number>(0);

  // ── Cost-breakdown API state ─────────────────────────────────────────────
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [overviewAvgCents, setOverviewAvgCents] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>("provider");

  // ── Edit state ───────────────────────────────────────────────────────────
  const [editPurchase, setEditPurchase] = useState<TokenPurchase | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editRevenue, setEditRevenue] = useState<RevenueEntry | null>(null);

  // ── Token purchase form ──────────────────────────────────────────────────
  const [tpProvider, setTpProvider] = useState<TokenProvider>("runway");
  const [tpAmount, setTpAmount] = useState("");
  const [tpUnits, setTpUnits] = useState("");
  const [tpUnitType, setTpUnitType] = useState("credits");
  const [tpNote, setTpNote] = useState("");
  const [tpSubmitting, setTpSubmitting] = useState(false);

  // ── Expense form ─────────────────────────────────────────────────────────
  const [expCategory, setExpCategory] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");
  const [expSubmitting, setExpSubmitting] = useState(false);

  // ── Revenue form ─────────────────────────────────────────────────────────
  const [revSource, setRevSource] = useState("");
  const [revAmount, setRevAmount] = useState("");
  const [revNote, setRevNote] = useState("");
  const [revSubmitting, setRevSubmitting] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, e, r, c, dc, dailyRes, cbRes, overviewRes] = await Promise.all([
          listTokenPurchases(),
          listExpenses(),
          listRevenueEntries(),
          listCostEvents(500),
          countDeliveredVideos(),
          fetchDailyStats(30).catch(() => null),
          fetchCostBreakdown().catch(() => null),
          fetchStatsOverview().catch(() => null),
        ]);
        if (cancelled) return;
        setPurchases(p);
        setExpenses(e);
        setRevenues(r);
        setCostEvents(c);
        setDeliveredCount(dc);
        if (dailyRes?.stats) setDailyStats(dailyRes.stats);
        if (cbRes) setCostBreakdown(cbRes);
        if (overviewRes?.avgCostPerVideoCents != null) setOverviewAvgCents(overviewRes.avgCostPerVideoCents);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load finances");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Derived: ledger totals ────────────────────────────────────────────────
  const totalRevenueCents = useMemo(
    () => revenues.reduce((s, r) => s + (r.amount_cents || 0), 0),
    [revenues],
  );
  const totalPurchasesCents = useMemo(
    () =>
      purchases
        .filter((p) => !EXCLUDED_FROM_DOLLARS.has(p.provider))
        .reduce((s, p) => s + (p.amount_cents || 0), 0),
    [purchases],
  );
  const totalExpensesCents = useMemo(
    () => expenses.reduce((s, e) => s + (e.amount_cents || 0), 0),
    [expenses],
  );
  const totalSpendCents = totalPurchasesCents + totalExpensesCents;
  const netCents = totalRevenueCents - totalSpendCents;

  const costPerVideoCents =
    deliveredCount > 0 ? Math.round(totalPurchasesCents / deliveredCount) : 0;

  // ── Derived: provider balance summary ────────────────────────────────────
  const providerSummary: ProviderSummary[] = useMemo(() => {
    const map = new Map<TokenProvider, ProviderSummary>();
    for (const prov of PROVIDERS) {
      map.set(prov.id, {
        provider: prov.id,
        label: prov.label,
        purchasedCents: 0,
        purchasedUnits: 0,
        spentCents: 0,
        spentUnits: 0,
      });
    }
    for (const p of purchases) {
      const row = map.get(p.provider);
      if (!row) continue;
      if (!EXCLUDED_FROM_DOLLARS.has(p.provider)) row.purchasedCents += p.amount_cents;
      row.purchasedUnits += p.units || 0;
    }
    for (const c of costEvents) {
      const prov = c.provider as TokenProvider;
      const row = map.get(prov);
      if (!row) continue;
      if (!EXCLUDED_FROM_DOLLARS.has(prov)) row.spentCents += c.cost_cents;
      row.spentUnits += c.units_consumed || 0;
    }
    return Array.from(map.values()).filter(
      (r) =>
        r.purchasedCents > 0 || r.spentCents > 0 || r.purchasedUnits > 0 || r.spentUnits > 0,
    );
  }, [purchases, costEvents]);

  // ── Derived: 30-day cashflow chart ───────────────────────────────────────
  const cashflowSeries = useMemo(() => {
    const buckets = new Map<string, { revenue: number; spend: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { revenue: 0, spend: 0 });
    }
    for (const r of revenues) {
      const key = r.received_at.slice(0, 10);
      const b = buckets.get(key);
      if (b) b.revenue += r.amount_cents;
    }
    for (const p of purchases) {
      if (EXCLUDED_FROM_DOLLARS.has(p.provider)) continue;
      const key = p.purchased_at.slice(0, 10);
      const b = buckets.get(key);
      if (b) b.spend += p.amount_cents;
    }
    for (const e of expenses) {
      const key = e.incurred_at.slice(0, 10);
      const b = buckets.get(key);
      if (b) b.spend += e.amount_cents;
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      revenue: v.revenue,
      spend: v.spend,
      net: v.revenue - v.spend,
    }));
  }, [revenues, purchases, expenses]);

  // ── Derived: cost-breakdown KPIs (from cost_events API) ─────────────────
  const liveDailyAvailable = dailyStats.length > 0;
  const hasAnySpend = liveDailyAvailable && dailyStats.some((d) => d.total_cost_cents > 0);

  const costSeries: number[] = liveDailyAvailable
    ? dailyStats.slice(-14).map((d) => d.total_cost_cents)
    : [];
  const totalSpend14 = costSeries.reduce((s, c) => s + c, 0);

  // MTD from cost_events (30d rolling from API, or calendar-month filter from daily)
  const mtdCents = (() => {
    if (costBreakdown?.byProvider?.length) {
      return costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0);
    }
    if (liveDailyAvailable) {
      const monthPrefix = new Date().toISOString().slice(0, 7);
      return dailyStats
        .filter((d) => d.date.startsWith(monthPrefix))
        .reduce((s, d) => s + d.total_cost_cents, 0);
    }
    return 0;
  })();

  const mtdDelta = (() => {
    if (!liveDailyAvailable || dailyStats.length < 14) return undefined;
    const last14 = dailyStats.slice(-14).reduce((s, d) => s + d.total_cost_cents, 0);
    const prior14 = dailyStats.slice(-28, -14).reduce((s, d) => s + d.total_cost_cents, 0);
    if (prior14 === 0) {
      const half = Math.floor(dailyStats.length / 2);
      return pctDelta(
        dailyStats.slice(half).reduce((s, d) => s + d.total_cost_cents, 0),
        dailyStats.slice(0, half).reduce((s, d) => s + d.total_cost_cents, 0),
      );
    }
    return pctDelta(last14, prior14);
  })();

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
    return pctDelta(weekAvg(dailyStats.slice(-7)), weekAvg(dailyStats.slice(-14, -7)));
  })();

  const topDriverRow = (() => {
    if (costBreakdown?.byProvider?.length) {
      const totalMonth = costBreakdown.byProvider.reduce((s, r) => s + r.month.cents, 0) || 1;
      return costBreakdown.byProvider
        .map((r) => ({ key: r.key, share: Math.round((r.month.cents / totalMonth) * 100) }))
        .reduce((a, b) => (a.share > b.share ? a : b));
    }
    return null;
  })();

  // ── Breakdown table rows ─────────────────────────────────────────────────
  function getBreakdownRows(): BreakdownRow[] {
    if (!costBreakdown) return [];
    const map: Record<BreakdownTab, CostBreakdownRow[]> = {
      provider: costBreakdown.byProvider,
      model: costBreakdown.byModel,
      scope: costBreakdown.byScope,
      stage: costBreakdown.byStage,
    };
    const live = map[breakdownTab];
    return live && live.length > 0 ? toBreakdownRows(live) : [];
  }
  const breakdownRows = getBreakdownRows();

  // ── Handlers ─────────────────────────────────────────────────────────────
  async function handleAddPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!tpAmount) return;
    setTpSubmitting(true);
    try {
      const p = await createTokenPurchase({
        provider: tpProvider,
        amount_cents: parseMoneyToCents(tpAmount),
        units: Number(tpUnits) || 0,
        unit_type: tpUnitType || undefined,
        note: tpNote || undefined,
      });
      setPurchases((prev) => [p, ...prev]);
      setTpAmount(""); setTpUnits(""); setTpNote("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setTpSubmitting(false);
    }
  }

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    if (!expCategory || !expAmount) return;
    setExpSubmitting(true);
    try {
      const x = await createExpense({
        category: expCategory.trim(),
        amount_cents: parseMoneyToCents(expAmount),
        description: expDesc || undefined,
      });
      setExpenses((prev) => [x, ...prev]);
      setExpCategory(""); setExpAmount(""); setExpDesc("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setExpSubmitting(false);
    }
  }

  async function handleAddRevenue(e: React.FormEvent) {
    e.preventDefault();
    if (!revSource || !revAmount) return;
    setRevSubmitting(true);
    try {
      const r = await createRevenueEntry({
        source: revSource.trim(),
        amount_cents: parseMoneyToCents(revAmount),
        note: revNote || undefined,
      });
      setRevenues((prev) => [r, ...prev]);
      setRevSource(""); setRevAmount(""); setRevNote("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setRevSubmitting(false);
    }
  }

  async function handleDeletePurchase(id: string) {
    if (!confirm("Delete this purchase record?")) return;
    await deleteTokenPurchase(id);
    setPurchases((prev) => prev.filter((p) => p.id !== id));
  }
  async function handleDeleteExpense(id: string) {
    if (!confirm("Delete this expense?")) return;
    await deleteExpense(id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }
  async function handleDeleteRevenue(id: string) {
    if (!confirm("Delete this revenue entry?")) return;
    await deleteRevenueEntry(id);
    setRevenues((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSavePurchase(updated: TokenPurchase) {
    const saved = await updateTokenPurchase(updated.id, {
      provider: updated.provider, amount_cents: updated.amount_cents,
      units: updated.units, unit_type: updated.unit_type || undefined,
      note: updated.note || undefined,
    });
    setPurchases((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    setEditPurchase(null);
  }
  async function handleSaveExpense(updated: Expense) {
    const saved = await updateExpense(updated.id, {
      category: updated.category, amount_cents: updated.amount_cents,
      description: updated.description || undefined,
    });
    setExpenses((prev) => prev.map((e) => (e.id === saved.id ? saved : e)));
    setEditExpense(null);
  }
  async function handleSaveRevenue(updated: RevenueEntry) {
    const saved = await updateRevenueEntry(updated.id, {
      source: updated.source, amount_cents: updated.amount_cents,
      note: updated.note || undefined,
    });
    setRevenues((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    setEditRevenue(null);
  }

  function handleReconcile() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const cmd = `Run: npx tsx scripts/cost-reconcile.ts --since ${since}`;
    console.info(cmd);
    window.alert(cmd);
  }

  // ── Loading / error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--muted)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="le-fade-up p-10" style={{ ...CARD_STYLE, border: "1px solid var(--bad)", background: "rgba(196,74,74,0.06)" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--bad)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          — Error
        </span>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>{error}</p>
      </div>
    );
  }

  const netColor = netCents >= 0 ? "var(--good)" : "var(--bad)";

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Actions row ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <p style={{ flex: 1, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          <Info style={{ width: 13, height: 13 }} strokeWidth={2} />
          Claude usage runs on a Pro subscription — excluded from dollar totals; units still tracked.
        </p>
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
      </div>

      {/* ── KPI row: 4 ledger totals ─────────────────────────────────────────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Revenue (all time)"
          value={fmtCentsPrim(totalRevenueCents)}
          sub="from revenue_entries"
        />
        <KpiCard
          label="Spend (all time)"
          value={fmtCentsPrim(totalSpendCents)}
          sub="token purchases + expenses"
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Net (all time)"
          value={
            <span style={{ color: netColor }}>
              {netCents >= 0 ? "+" : "−"}{fmtCentsPrim(Math.abs(netCents))}
            </span>
          }
          sub="revenue − spend"
        />
        <KpiCard
          label="Cost / video"
          value={deliveredCount > 0 ? fmtCentsPrim(costPerVideoCents) : "—"}
          sub={deliveredCount > 0 ? `${deliveredCount} delivered` : "no deliveries yet"}
          deltaPositiveIsGood={false}
        />
      </section>

      {/* ── KPI row: 4 cost-event metrics (from /api/stats/cost-breakdown) ────── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Spend · MTD"
          value={fmtCentsPrim(mtdCents)}
          sub="rolling 30d from cost_events"
          delta={hasAnySpend ? mtdDelta : null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Avg / video (7d)"
          value={fmtCentsPrim(avgPerVideo)}
          sub="vs prior 7 days"
          delta={hasAnySpend ? avgVideoDelta : null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Top driver"
          value={topDriverRow ? topDriverRow.key.charAt(0).toUpperCase() + topDriverRow.key.slice(1) : "—"}
          sub={topDriverRow ? `${topDriverRow.share}% of total spend` : "no data yet"}
        />
        <KpiCard
          label="Reconcile drift"
          value="—"
          sub="reconcile script not run today"
        />
      </section>

      {/* ── 30-day cashflow chart (revenue vs spend from ledger tables) ───────── */}
      <Card padding={24}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <span className="le-d-label">Cashflow · 30 days</span>
            <h3 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: netColor }}>
                {netCents >= 0 ? "+" : "−"}{fmtCentsPrim(Math.abs(netCents))} net
              </span>
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <LegendDot color="oklch(0.7 0.14 168)" label="Revenue" />
            <LegendDot color="var(--accent)" label="Spend" />
          </div>
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cashflowSeries} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.7 0.14 168)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="oklch(0.7 0.14 168)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke="rgba(15,24,60,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  fontSize: 11,
                  padding: 10,
                }}
                formatter={(v: number, name: string) => [fmtCentsPrim(v), name]}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.7 0.14 168)" strokeWidth={1.5} fill="url(#revArea)" />
              <Area type="monotone" dataKey="spend" stroke="var(--accent)" strokeWidth={1.5} fill="url(#spendArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Spend over time sparkline (from cost_events API) ─────────────────── */}
      <Card padding={24}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <span className="le-d-label">API spend over time</span>
            <h3 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
              {fmtCentsPrim(totalSpend14)} · last 14 days
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <LegendDot color="var(--accent)" label="API spend (cost_events)" />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          {costSeries.length === 0 || !hasAnySpend ? (
            <div style={{ height: 180, display: "grid", placeItems: "center", fontSize: 13, color: "var(--muted)" }}>
              No cost events recorded in the last 14 days.
            </div>
          ) : (
            <Sparkline data={costSeries} color="var(--accent)" height={180} showDots />
          )}
        </div>
      </Card>

      {/* ── Provider / model / scope / stage breakdown ────────────────────────── */}
      <Card padding={24}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span className="le-d-label">Cost breakdown</span>
          <div
            style={{
              display: "inline-flex", padding: 4, borderRadius: 999,
              background: "rgba(15,24,60,0.05)",
            }}
          >
            {BREAKDOWN_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setBreakdownTab(t)}
                style={{
                  padding: "8px 16px", borderRadius: 999, border: "none",
                  background: breakdownTab === t ? "var(--ink)" : "transparent",
                  color: breakdownTab === t ? "#fff" : "var(--muted)",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  textTransform: "capitalize", transition: "background .15s, color .15s",
                }}
              >
                By {t}
              </button>
            ))}
          </div>
        </div>

        {breakdownRows.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", border: "1px dashed rgba(15,24,60,0.12)", borderRadius: 12 }}>
            No cost events in the last 30 days.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr", gap: 16, padding: "10px 14px", borderBottom: "1px solid rgba(15,24,60,0.06)" }}>
              {[
                { label: breakdownTab === "provider" ? "Provider" : breakdownTab === "model" ? "Model" : breakdownTab === "scope" ? "Scope" : "Stage", align: "left" },
                { label: "Today", align: "right" },
                { label: "7d", align: "right" },
                { label: "30d", align: "right" },
                { label: "Events", align: "right" },
                { label: "Share", align: "left" },
              ].map(({ label, align }) => (
                <span key={label} className="le-d-label" style={{ textAlign: align as "left" | "right", fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
                  {label}
                </span>
              ))}
            </div>
            {breakdownRows.map((r) => (
              <div
                key={r.name}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr", gap: 16, padding: "14px 14px", borderBottom: "1px solid rgba(15,24,60,0.04)", alignItems: "center" }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{r.name}</span>
                <span className="le-tabular" style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmtCentsPrim(r.today)}</span>
                <span className="le-tabular" style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmtCentsPrim(r.week)}</span>
                <span className="le-tabular" style={{ fontSize: 14, fontWeight: 600, textAlign: "right", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{fmtCentsPrim(r.month)}</span>
                <span className="le-tabular" style={{ fontSize: 12, textAlign: "right", color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>{r.events.toLocaleString()}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 5, background: "rgba(15,24,60,0.06)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${r.share}%`, background: "var(--accent)", borderRadius: 99 }} />
                  </div>
                  <span className="le-tabular" style={{ fontSize: 11, color: "var(--muted-2)", width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.share}%</span>
                </div>
              </div>
            ))}
          </>
        )}
      </Card>

      {/* ── Token balance by provider ─────────────────────────────────────────── */}
      {providerSummary.length > 0 && (
        <Card padding={24}>
          <span className="le-d-label">Token balance by provider</span>
          <div style={{ marginTop: 20, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {providerSummary.map((row) => {
              const balanceCents = row.purchasedCents - row.spentCents;
              const usedPct =
                row.purchasedCents > 0
                  ? Math.min(100, (row.spentCents / row.purchasedCents) * 100)
                  : 0;
              const balanceColor = balanceCents < 0 ? "var(--bad)" : "var(--ink)";
              return (
                <div
                  key={row.provider}
                  style={{
                    borderRadius: 12,
                    padding: 18,
                    background: "rgba(15,24,60,0.03)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        {row.label}
                      </span>
                      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700, color: balanceColor, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                        {balanceCents < 0 ? "−" : ""}{fmtCentsPrim(Math.abs(balanceCents))}
                      </div>
                      <p style={{ marginTop: 2, fontSize: 11, color: "var(--muted)" }}>remaining</p>
                    </div>
                    <span
                      style={{
                        width: 12, height: 12, borderRadius: 99,
                        background: PROVIDER_COLORS[row.provider],
                        flexShrink: 0, marginTop: 2,
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 14, height: 3, width: "100%", borderRadius: 99, background: "rgba(15,24,60,0.08)" }}>
                    <motion.div
                      style={{ height: "100%", borderRadius: 99, background: PROVIDER_COLORS[row.provider] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${usedPct}%` }}
                      transition={{ duration: 1, ease: EASE }}
                    />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    <span>{fmtCentsPrim(row.spentCents)} spent</span>
                    <span>{fmtCentsPrim(row.purchasedCents)} bought</span>
                  </div>
                  {row.purchasedUnits > 0 && (
                    <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
                      <span>{row.spentUnits.toFixed(0)} units used</span>
                      <span>{row.purchasedUnits.toFixed(0)} units bought</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Log forms ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(3, 1fr)" }}>

        {/* Log token purchase */}
        <form onSubmit={handleAddPurchase} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log token purchase</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Provider</Label>
              <Select value={tpProvider} onValueChange={(v) => setTpProvider(v as TokenProvider)}>
                <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount paid</Label>
                <div style={{ position: "relative", marginTop: 8 }}>
                  <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted)", pointerEvents: "none" }}>$</span>
                  <Input type="text" inputMode="decimal" value={tpAmount} onChange={(e) => setTpAmount(e.target.value)} placeholder="250.00" className="le-mono pl-7" required />
                </div>
              </div>
              <div>
                <Label className="le-d-label" style={{ color: "var(--muted)" }}>Units</Label>
                <Input type="number" value={tpUnits} onChange={(e) => setTpUnits(e.target.value)} placeholder="25000" className="le-mono mt-2" />
              </div>
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Unit type</Label>
              <Input value={tpUnitType} onChange={(e) => setTpUnitType(e.target.value)} placeholder="credits / tokens / kling_units" className="mt-2" />
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Note</Label>
              <Input value={tpNote} onChange={(e) => setTpNote(e.target.value)} placeholder="Receipt #, reference…" className="mt-2" />
            </div>
            <Button type="submit" size="sm" disabled={tpSubmitting || !tpAmount} className="w-full">
              {tpSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Log purchase
            </Button>
          </div>
        </form>

        {/* Log expense */}
        <form onSubmit={handleAddExpense} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log expense</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Category</Label>
              <Input value={expCategory} onChange={(e) => setExpCategory(e.target.value)} placeholder="Hosting, tools, marketing…" className="mt-2" required />
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount</Label>
              <div style={{ position: "relative", marginTop: 8 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted)", pointerEvents: "none" }}>$</span>
                <Input type="text" inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="0.00" className="le-mono pl-7" required />
              </div>
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Description</Label>
              <Input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} placeholder="What was it for?" className="mt-2" />
            </div>
            <Button type="submit" size="sm" disabled={expSubmitting || !expCategory || !expAmount} className="w-full">
              {expSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Log expense
            </Button>
          </div>
        </form>

        {/* Log revenue */}
        <form onSubmit={handleAddRevenue} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log revenue</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Source</Label>
              <Input value={revSource} onChange={(e) => setRevSource(e.target.value)} placeholder="Customer name, invoice, etc" className="mt-2" required />
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount</Label>
              <div style={{ position: "relative", marginTop: 8 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted)", pointerEvents: "none" }}>$</span>
                <Input type="text" inputMode="decimal" value={revAmount} onChange={(e) => setRevAmount(e.target.value)} placeholder="0.00" className="le-mono pl-7" required />
              </div>
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Note</Label>
              <Input value={revNote} onChange={(e) => setRevNote(e.target.value)} placeholder="Stripe, manual, subscription…" className="mt-2" />
            </div>
            <Button type="submit" size="sm" disabled={revSubmitting || !revSource || !revAmount} className="w-full">
              {revSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Log revenue
            </Button>
          </div>
        </form>
      </div>

      {/* ── Ledger tables ─────────────────────────────────────────────────────── */}
      <LedgerTable
        title="Token purchases"
        rows={purchases.map((p) => ({
          id: p.id,
          cols: [
            { value: PROVIDERS.find((x) => x.id === p.provider)?.label || p.provider, weight: 600, color: "var(--ink)" },
            { value: p.units ? `${p.units} ${p.unit_type || ""}` : "—", mono: true, color: "var(--muted)" },
            { value: p.note || "—", color: "var(--muted)", truncate: true },
            { value: new Date(p.purchased_at).toLocaleDateString(), mono: true, color: "var(--muted)" },
            { value: fmtCentsPrim(p.amount_cents), mono: true, color: "var(--ink)", align: "right", weight: 600 },
          ],
        }))}
        columns={["Provider", "Units", "Note", "Date", "Amount"]}
        onEdit={(id) => setEditPurchase(purchases.find((p) => p.id === id) || null)}
        onDelete={handleDeletePurchase}
      />

      <LedgerTable
        title="Other expenses"
        rows={expenses.map((e) => ({
          id: e.id,
          cols: [
            { value: e.category, weight: 600, color: "var(--ink)" },
            { value: e.description || "—", color: "var(--muted)", truncate: true },
            { value: "", color: "" },
            { value: new Date(e.incurred_at).toLocaleDateString(), mono: true, color: "var(--muted)" },
            { value: fmtCentsPrim(e.amount_cents), mono: true, color: "var(--ink)", align: "right", weight: 600 },
          ],
        }))}
        columns={["Category", "Description", "", "Date", "Amount"]}
        onEdit={(id) => setEditExpense(expenses.find((e) => e.id === id) || null)}
        onDelete={handleDeleteExpense}
      />

      <LedgerTable
        title="Revenue"
        rows={revenues.map((r) => ({
          id: r.id,
          cols: [
            { value: r.source, weight: 600, color: "var(--ink)" },
            { value: r.note || "—", color: "var(--muted)", truncate: true },
            { value: "", color: "" },
            { value: new Date(r.received_at).toLocaleDateString(), mono: true, color: "var(--muted)" },
            { value: fmtCentsPrim(r.amount_cents), mono: true, color: "var(--good)", align: "right", weight: 600 },
          ],
        }))}
        columns={["Source", "Note", "", "Date", "Amount"]}
        onEdit={(id) => setEditRevenue(revenues.find((r) => r.id === id) || null)}
        onDelete={handleDeleteRevenue}
      />

      {/* ── Edit dialogs ──────────────────────────────────────────────────────── */}
      <EditPurchaseDialog purchase={editPurchase} onClose={() => setEditPurchase(null)} onSave={handleSavePurchase} />
      <EditExpenseDialog expense={editExpense} onClose={() => setEditExpense(null)} onSave={handleSaveExpense} />
      <EditRevenueDialog revenue={editRevenue} onClose={() => setEditRevenue(null)} onSave={handleSaveRevenue} />
    </div>
  );
}

// ─── LedgerTable ─────────────────────────────────────────────────────────────

interface LedgerCol {
  value: string;
  color?: string;
  mono?: boolean;
  weight?: number;
  align?: "left" | "right";
  truncate?: boolean;
}

interface LedgerRow { id: string; cols: LedgerCol[]; }

function LedgerTable({
  title, rows, columns, onEdit, onDelete,
}: {
  title: string;
  rows: LedgerRow[];
  columns: string[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={{ ...CARD_STYLE, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <span className="le-d-label">{title}</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {rows.length} entries
        </span>
      </div>

      <div style={{ borderTop: "1px solid var(--line)" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 1fr 1fr 56px", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          {columns.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="le-d-label"
              style={{
                fontSize: 11, color: "var(--muted)", fontWeight: 600,
                textAlign: i === columns.length - 1 ? "right" : "left",
              }}
            >
              {c}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
            No entries yet
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="group"
              style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 1fr 1fr 56px", gap: 16, alignItems: "center", padding: "14px 0", borderBottom: "1px solid rgba(15,24,60,0.04)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(15,24,60,0.02)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {row.cols.map((c, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: c.mono ? 12 : 13,
                    fontWeight: c.weight ?? 400,
                    color: c.color || "var(--ink)",
                    textAlign: c.align || "left",
                    fontVariantNumeric: c.mono ? "tabular-nums" : undefined,
                    overflow: c.truncate ? "hidden" : undefined,
                    textOverflow: c.truncate ? "ellipsis" : undefined,
                    whiteSpace: c.truncate ? "nowrap" : undefined,
                  }}
                >
                  {c.value}
                </span>
              ))}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => onEdit(row.id)}
                  aria-label="Edit"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4, display: "flex", alignItems: "center" }}
                >
                  <Pencil style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(row.id)}
                  aria-label="Delete"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bad)", padding: 4, display: "flex", alignItems: "center" }}
                >
                  <Trash2 style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Edit dialogs ─────────────────────────────────────────────────────────────

function EditPurchaseDialog({ purchase, onClose, onSave }: { purchase: TokenPurchase | null; onClose: () => void; onSave: (updated: TokenPurchase) => Promise<void>; }) {
  const [provider, setProvider] = useState<TokenProvider>("runway");
  const [amount, setAmount] = useState("");
  const [units, setUnits] = useState("");
  const [unitType, setUnitType] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (purchase) {
      setProvider(purchase.provider);
      setAmount((purchase.amount_cents / 100).toFixed(2));
      setUnits(String(purchase.units ?? 0));
      setUnitType(purchase.unit_type ?? "");
      setNote(purchase.note ?? "");
    }
  }, [purchase]);

  if (!purchase) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...purchase, provider, amount_cents: parseMoneyToCents(amount), units: Number(units) || 0, unit_type: unitType || null, note: note || null });
    } catch (err) { alert(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">Edit token purchase</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as TokenProvider)}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount paid</Label>
              <div className="relative mt-2">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--muted)" }}>$</span>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="le-mono pl-7" required />
              </div>
            </div>
            <div>
              <Label className="le-d-label" style={{ color: "var(--muted)" }}>Units</Label>
              <Input type="number" value={units} onChange={(e) => setUnits(e.target.value)} className="le-mono mt-2" />
            </div>
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Unit type</Label>
            <Input value={unitType} onChange={(e) => setUnitType(e.target.value)} className="mt-2" />
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditExpenseDialog({ expense, onClose, onSave }: { expense: Expense | null; onClose: () => void; onSave: (updated: Expense) => Promise<void>; }) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expense) { setCategory(expense.category); setAmount((expense.amount_cents / 100).toFixed(2)); setDescription(expense.description ?? ""); }
  }, [expense]);

  if (!expense) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...expense, category: category.trim(), amount_cents: parseMoneyToCents(amount), description: description || null }); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">Edit expense</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-2" required />
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount</Label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--muted)" }}>$</span>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="le-mono pl-7" required />
            </div>
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRevenueDialog({ revenue, onClose, onSave }: { revenue: RevenueEntry | null; onClose: () => void; onSave: (updated: RevenueEntry) => Promise<void>; }) {
  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (revenue) { setSource(revenue.source); setAmount((revenue.amount_cents / 100).toFixed(2)); setNote(revenue.note ?? ""); }
  }, [revenue]);

  if (!revenue) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...revenue, source: source.trim(), amount_cents: parseMoneyToCents(amount), note: note || null }); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">Edit revenue</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Source</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} className="mt-2" required />
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Amount</Label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--muted)" }}>$</span>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="le-mono pl-7" required />
            </div>
          </div>
          <div>
            <Label className="le-d-label" style={{ color: "var(--muted)" }}>Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
