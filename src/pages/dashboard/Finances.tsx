import { useEffect, useMemo, useState } from "react";
import "@/v2/styles/v2.css";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { motion } from "framer-motion";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  TrendingUp,
  TrendingDown,
  Wallet,
  Film,
  DollarSign,
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
import { formatCents } from "@/lib/types";
import type {
  TokenPurchase,
  Expense,
  RevenueEntry,
  TokenProvider,
  CostEvent,
} from "@/lib/types";
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
import { KpiCard } from "@/v2/components/dashboard/KpiCard";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";

// Claude runs through a Pro subscription right now, so API cost events for
// Anthropic should not count toward finance totals. We still track unit usage
// for planning but never display a dollar amount.
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

interface ProviderSummary {
  provider: TokenProvider;
  label: string;
  purchasedCents: number;
  purchasedUnits: number;
  spentCents: number;
  spentUnits: number;
}

function parseMoneyToCents(value: string): number {
  const n = parseFloat(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}


export default function Finances() {
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<TokenPurchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [revenues, setRevenues] = useState<RevenueEntry[]>([]);
  const [costEvents, setCostEvents] = useState<CostEvent[]>([]);
  const [deliveredCount, setDeliveredCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editPurchase, setEditPurchase] = useState<TokenPurchase | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editRevenue, setEditRevenue] = useState<RevenueEntry | null>(null);

  // Token purchase form
  const [tpProvider, setTpProvider] = useState<TokenProvider>("runway");
  const [tpAmount, setTpAmount] = useState("");
  const [tpUnits, setTpUnits] = useState("");
  const [tpUnitType, setTpUnitType] = useState("credits");
  const [tpNote, setTpNote] = useState("");
  const [tpSubmitting, setTpSubmitting] = useState(false);

  // Expense form
  const [expCategory, setExpCategory] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");
  const [expSubmitting, setExpSubmitting] = useState(false);

  // Revenue form
  const [revSource, setRevSource] = useState("");
  const [revAmount, setRevAmount] = useState("");
  const [revNote, setRevNote] = useState("");
  const [revSubmitting, setRevSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, e, r, c, dc] = await Promise.all([
          listTokenPurchases(),
          listExpenses(),
          listRevenueEntries(),
          listCostEvents(500),
          countDeliveredVideos(),
        ]);
        if (cancelled) return;
        setPurchases(p);
        setExpenses(e);
        setRevenues(r);
        setCostEvents(c);
        setDeliveredCount(dc);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load finances");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Derived totals ───────────────────────────────────────────────────────
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

  // Cost per delivered video — token spend only, averaged over all deliveries.
  const costPerVideoCents =
    deliveredCount > 0 ? Math.round(totalPurchasesCents / deliveredCount) : 0;

  // Per-provider rollup (purchased vs spent from cost_events).
  // Dollar totals are zeroed for excluded providers (Claude via Pro sub) but
  // unit counts are preserved.
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
        r.purchasedCents > 0 ||
        r.spentCents > 0 ||
        r.purchasedUnits > 0 ||
        r.spentUnits > 0,
    );
  }, [purchases, costEvents]);

  // 30-day net series (revenue − spend)
  const netSeries = useMemo(() => {
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

  // ─── Handlers ─────────────────────────────────────────────────────────────
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
      setTpAmount("");
      setTpUnits("");
      setTpNote("");
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
      setExpCategory("");
      setExpAmount("");
      setExpDesc("");
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
      setRevSource("");
      setRevAmount("");
      setRevNote("");
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
      provider: updated.provider,
      amount_cents: updated.amount_cents,
      units: updated.units,
      unit_type: updated.unit_type || undefined,
      note: updated.note || undefined,
    });
    setPurchases((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    setEditPurchase(null);
  }

  async function handleSaveExpense(updated: Expense) {
    const saved = await updateExpense(updated.id, {
      category: updated.category,
      amount_cents: updated.amount_cents,
      description: updated.description || undefined,
    });
    setExpenses((prev) => prev.map((e) => (e.id === saved.id ? saved : e)));
    setEditExpense(null);
  }

  async function handleSaveRevenue(updated: RevenueEntry) {
    const saved = await updateRevenueEntry(updated.id, {
      source: updated.source,
      amount_cents: updated.amount_cents,
      note: updated.note || undefined,
    });
    setRevenues((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    setEditRevenue(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--le-text-muted)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <DashboardCard
        padding="none"
        className="p-10"
        style={{
          border: "1px solid var(--le-danger)",
          background: "var(--le-danger-soft)",
        }}
      >
        <span className="le-eyebrow" style={{ color: "var(--le-danger)" }}>
          Error
        </span>
        <p className="mt-3 text-sm" style={{ color: "var(--le-text-muted)" }}>
          {error}
        </p>
      </DashboardCard>
    );
  }

  const netGradient = netCents >= 0 ? "status-healthy" : "status-degraded";
  const costGradient = costPerVideoCents < 500 ? "status-healthy" : "status-degraded";

  return (
    <div className="flex flex-col gap-8">
      {/* ─── Page header ──────────────────────────────────────────────────── */}
      <div>
        <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
          Admin
        </div>
        <h2
          className="le-display mt-1 font-medium tracking-tight"
          style={{ fontSize: "clamp(28px, 4vw, 44px)", color: "var(--le-text)" }}
        >
          Finances
        </h2>
        <p
          className="mt-2 flex items-center gap-2 text-xs"
          style={{ color: "var(--le-text-muted)" }}
        >
          <Info className="h-3 w-3" strokeWidth={2} />
          Claude usage runs on a Pro subscription and is excluded from dollar totals. Units are still
          tracked.
        </p>
      </div>

      {/* ─── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue (30d)"
          value={formatCents(totalRevenueCents)}
          gradient="blue"
          icon={<DollarSign className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label="Spend (30d)"
          value={formatCents(totalSpendCents)}
          gradient="navy"
          icon={<Wallet className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label="Net (30d)"
          value={`${netCents >= 0 ? "+" : "−"}${formatCents(Math.abs(netCents))}`}
          gradient={netGradient}
          icon={
            netCents >= 0 ? (
              <TrendingUp className="h-5 w-5" strokeWidth={1.6} />
            ) : (
              <TrendingDown className="h-5 w-5" strokeWidth={1.6} />
            )
          }
        />
        <KpiCard
          label="Cost / video"
          value={deliveredCount > 0 ? formatCents(costPerVideoCents) : "—"}
          gradient={costGradient}
          icon={<Film className="h-5 w-5" strokeWidth={1.6} />}
        />
      </div>

      {/* ─── 30-day cashflow chart ────────────────────────────────────────── */}
      <DashboardCard>
        <div className="flex items-end justify-between">
          <div>
            <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Cashflow
            </div>
            <h3
              className="mt-1 text-xl font-medium tracking-tight"
              style={{ color: "var(--le-text)" }}
            >
              30-day net
            </h3>
          </div>
          <span
            className="le-mono text-xs"
            style={{
              color: netCents >= 0 ? "var(--le-success)" : "var(--le-danger)",
            }}
          >
            {netCents >= 0 ? "+" : "−"}
            {formatCents(Math.abs(netCents))} total
          </span>
        </div>
        <div className="mt-6 h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={netSeries} margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.5 0.16 245)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.5 0.16 245)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.78 0.05 75)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="oklch(0.78 0.05 75)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="0"
                stroke="var(--le-border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--le-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--le-text-muted)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--le-bg-elev)",
                  border: "1px solid var(--le-border)",
                  borderRadius: 8,
                  fontSize: 11,
                  padding: 10,
                }}
                formatter={(v: number, name: string) => [formatCents(v), name]}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="oklch(0.5 0.16 245)"
                strokeWidth={1.5}
                fill="url(#revArea)"
              />
              <Area
                type="monotone"
                dataKey="spend"
                stroke="oklch(0.78 0.05 75)"
                strokeWidth={1.5}
                fill="url(#spendArea)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-5 flex gap-6">
          <span
            className="le-eyebrow inline-flex items-center gap-2"
            style={{ color: "var(--le-text-muted)" }}
          >
            <span className="inline-block h-[2px] w-5" style={{ background: "oklch(0.5 0.16 245)" }} /> Revenue
          </span>
          <span
            className="le-eyebrow inline-flex items-center gap-2"
            style={{ color: "var(--le-text-muted)" }}
          >
            <span className="inline-block h-[2px] w-5" style={{ background: "oklch(0.78 0.05 75)" }} /> Spend
          </span>
        </div>
      </DashboardCard>

      {/* ─── Token balance by provider ────────────────────────────────────── */}
      {providerSummary.length > 0 && (
        <DashboardCard>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Balances
          </div>
          <h3
            className="mt-1 text-xl font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            Token balance by provider
          </h3>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {providerSummary.map((row) => {
              const balanceCents = row.purchasedCents - row.spentCents;
              const usedPct =
                row.purchasedCents > 0
                  ? Math.min(100, (row.spentCents / row.purchasedCents) * 100)
                  : 0;
              const balanceColor =
                balanceCents < 0 ? "var(--le-danger)" : "var(--le-text)";
              return (
                <div
                  key={row.provider}
                  className="rounded-[14px] p-5"
                  style={{
                    background: "var(--le-bg-sunken, var(--le-bg-elev))",
                    border: "1px solid var(--le-border)",
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className="le-eyebrow"
                        style={{ color: "var(--le-text-muted)" }}
                      >
                        {row.label}
                      </span>
                      <div
                        className="le-mono mt-3 text-2xl font-semibold"
                        style={{ color: balanceColor }}
                      >
                        {balanceCents < 0 ? "−" : ""}
                        {formatCents(Math.abs(balanceCents))}
                      </div>
                      <p
                        className="mt-1 text-[11px]"
                        style={{ color: "var(--le-text-muted)" }}
                      >
                        remaining
                      </p>
                    </div>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: PROVIDER_COLORS[row.provider] }}
                    />
                  </div>
                  <div
                    className="mt-4 h-[3px] w-full rounded-full"
                    style={{ background: "var(--le-border)" }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: PROVIDER_COLORS[row.provider] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${usedPct}%` }}
                      transition={{ duration: 1, ease: EASE }}
                    />
                  </div>
                  <div
                    className="le-mono mt-3 flex justify-between text-[11px]"
                    style={{ color: "var(--le-text-muted)" }}
                  >
                    <span>{formatCents(row.spentCents)} spent</span>
                    <span>{formatCents(row.purchasedCents)} purchased</span>
                  </div>
                  {row.purchasedUnits > 0 && (
                    <div
                      className="le-mono mt-1 flex justify-between text-[10px]"
                      style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
                    >
                      <span>{row.spentUnits.toFixed(0)} units used</span>
                      <span>{row.purchasedUnits.toFixed(0)} units bought</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DashboardCard>
      )}

      {/* ─── Log forms ────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Log token purchase */}
        <form
          onSubmit={handleAddPurchase}
          className="rounded-[14px] border p-6"
          style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
        >
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Log
          </div>
          <h3
            className="mt-1 text-lg font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            New token purchase
          </h3>
          <div className="mt-5 space-y-4">
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Provider
              </Label>
              <Select
                value={tpProvider}
                onValueChange={(v) => setTpProvider(v as TokenProvider)}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label
                  className="le-eyebrow"
                  style={{ color: "var(--le-text-muted)" }}
                >
                  Amount paid
                </Label>
                <div className="relative mt-2">
                  <span
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
                  >
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={tpAmount}
                    onChange={(e) => setTpAmount(e.target.value)}
                    placeholder="250.00"
                    className="le-mono pl-7"
                    required
                  />
                </div>
              </div>
              <div>
                <Label
                  className="le-eyebrow"
                  style={{ color: "var(--le-text-muted)" }}
                >
                  Units
                </Label>
                <Input
                  type="number"
                  value={tpUnits}
                  onChange={(e) => setTpUnits(e.target.value)}
                  placeholder="25000"
                  className="le-mono mt-2"
                />
              </div>
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Unit type
              </Label>
              <Input
                value={tpUnitType}
                onChange={(e) => setTpUnitType(e.target.value)}
                placeholder="credits / tokens / kling_units"
                className="mt-2"
              />
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Note
              </Label>
              <Input
                value={tpNote}
                onChange={(e) => setTpNote(e.target.value)}
                placeholder="Receipt #, reference…"
                className="mt-2"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={tpSubmitting || !tpAmount}
              className="w-full"
            >
              {tpSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Log purchase
            </Button>
          </div>
        </form>

        {/* Log expense */}
        <form
          onSubmit={handleAddExpense}
          className="rounded-[14px] border p-6"
          style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
        >
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Log
          </div>
          <h3
            className="mt-1 text-lg font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            New expense
          </h3>
          <div className="mt-5 space-y-4">
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Category
              </Label>
              <Input
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                placeholder="Hosting, tools, marketing…"
                className="mt-2"
                required
              />
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Amount
              </Label>
              <div className="relative mt-2">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
                >
                  $
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  placeholder="0.00"
                  className="le-mono pl-7"
                  required
                />
              </div>
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Description
              </Label>
              <Input
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="What was it for?"
                className="mt-2"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={expSubmitting || !expCategory || !expAmount}
              className="w-full"
            >
              {expSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Log expense
            </Button>
          </div>
        </form>

        {/* Log revenue */}
        <form
          onSubmit={handleAddRevenue}
          className="rounded-[14px] border p-6"
          style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
        >
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Log
          </div>
          <h3
            className="mt-1 text-lg font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            New revenue
          </h3>
          <div className="mt-5 space-y-4">
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Source
              </Label>
              <Input
                value={revSource}
                onChange={(e) => setRevSource(e.target.value)}
                placeholder="Customer name, invoice, etc"
                className="mt-2"
                required
              />
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Amount
              </Label>
              <div className="relative mt-2">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
                >
                  $
                </span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={revAmount}
                  onChange={(e) => setRevAmount(e.target.value)}
                  placeholder="0.00"
                  className="le-mono pl-7"
                  required
                />
              </div>
            </div>
            <div>
              <Label
                className="le-eyebrow"
                style={{ color: "var(--le-text-muted)" }}
              >
                Note
              </Label>
              <Input
                value={revNote}
                onChange={(e) => setRevNote(e.target.value)}
                placeholder="Stripe, manual, subscription…"
                className="mt-2"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={revSubmitting || !revSource || !revAmount}
              className="w-full"
            >
              {revSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Log revenue
            </Button>
          </div>
        </form>
      </div>

      {/* ─── Ledger tables ────────────────────────────────────────────────── */}
      <LedgerTable
        title="Token purchases"
        rows={purchases.map((p) => ({
          id: p.id,
          cols: [
            {
              value: PROVIDERS.find((x) => x.id === p.provider)?.label || p.provider,
              className: "le-eyebrow",
              style: { color: "var(--le-text)" },
            },
            {
              value: p.units ? `${p.units} ${p.unit_type || ""}` : "—",
              className: "le-mono text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            {
              value: p.note || "—",
              className: "truncate text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            {
              value: new Date(p.purchased_at).toLocaleDateString(),
              className: "le-mono text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            {
              value: formatCents(p.amount_cents),
              className: "le-mono text-right text-sm font-semibold",
              style: { color: "var(--le-text)" },
            },
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
            {
              value: e.category,
              className: "le-eyebrow",
              style: { color: "var(--le-text)" },
            },
            {
              value: e.description || "—",
              className: "truncate text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            { value: "", className: "", style: {} },
            {
              value: new Date(e.incurred_at).toLocaleDateString(),
              className: "le-mono text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            {
              value: formatCents(e.amount_cents),
              className: "le-mono text-right text-sm font-semibold",
              style: { color: "var(--le-text)" },
            },
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
            {
              value: r.source,
              className: "le-eyebrow",
              style: { color: "var(--le-text)" },
            },
            {
              value: r.note || "—",
              className: "truncate text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            { value: "", className: "", style: {} },
            {
              value: new Date(r.received_at).toLocaleDateString(),
              className: "le-mono text-xs",
              style: { color: "var(--le-text-muted)" },
            },
            {
              value: formatCents(r.amount_cents),
              className: "le-mono text-right text-sm font-semibold",
              style: { color: "var(--le-success)" },
            },
          ],
        }))}
        columns={["Source", "Note", "", "Date", "Amount"]}
        onEdit={(id) => setEditRevenue(revenues.find((r) => r.id === id) || null)}
        onDelete={handleDeleteRevenue}
      />

      {/* ─── Edit dialogs ─────────────────────────────────────────────────── */}
      <EditPurchaseDialog
        purchase={editPurchase}
        onClose={() => setEditPurchase(null)}
        onSave={handleSavePurchase}
      />
      <EditExpenseDialog
        expense={editExpense}
        onClose={() => setEditExpense(null)}
        onSave={handleSaveExpense}
      />
      <EditRevenueDialog
        revenue={editRevenue}
        onClose={() => setEditRevenue(null)}
        onSave={handleSaveRevenue}
      />
    </div>
  );
}

// ─── LedgerTable ─────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string;
  cols: { value: string; className: string; style: React.CSSProperties }[];
}

function LedgerTable({
  title,
  rows,
  columns,
  onEdit,
  onDelete,
}: {
  title: string;
  rows: LedgerRow[];
  columns: string[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <DashboardCard>
      <div className="flex items-end justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Ledger
          </div>
          <h3
            className="mt-1 text-xl font-medium tracking-tight"
            style={{ color: "var(--le-text)" }}
          >
            {title}
          </h3>
        </div>
        <span
          className="le-mono text-xs"
          style={{ color: "var(--le-text-muted)" }}
        >
          {rows.length} entries
        </span>
      </div>

      <div className="mt-6" style={{ borderTop: "1px solid var(--le-border)" }}>
        {/* Column headers */}
        <div
          className="grid grid-cols-[1.2fr_2fr_1fr_1fr_1fr_64px] gap-6 py-3"
          style={{ borderBottom: "1px solid var(--le-border)" }}
        >
          {columns.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="le-eyebrow"
              style={{
                color: "var(--le-text-muted)",
                textAlign: i === columns.length - 1 ? "right" : "left",
              }}
            >
              {c}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div
            className="py-12 text-center text-sm"
            style={{ color: "var(--le-text-muted)" }}
          >
            No entries yet
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="group grid grid-cols-[1.2fr_2fr_1fr_1fr_1fr_64px] items-center gap-6 py-4 transition-colors duration-300"
              style={{
                borderBottom: "1px solid var(--le-border)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "var(--le-bg-sunken, rgba(255,255,255,0.03))";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              {row.cols.map((c, i) => (
                <span key={i} className={c.className} style={c.style}>
                  {c.value}
                </span>
              ))}
              <div className="flex items-center justify-end gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100">
                <DashboardButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(row.id)}
                  aria-label="Edit"
                  style={{ color: "var(--le-text-muted)" }}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                </DashboardButton>
                <DashboardButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(row.id)}
                  aria-label="Delete"
                  style={{ color: "var(--le-text-muted)", borderColor: "var(--le-danger)" }}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </DashboardButton>
              </div>
            </div>
          ))
        )}
      </div>
    </DashboardCard>
  );
}

// ─── Edit dialogs ─────────────────────────────────────────────────────────────

function EditPurchaseDialog({
  purchase,
  onClose,
  onSave,
}: {
  purchase: TokenPurchase | null;
  onClose: () => void;
  onSave: (updated: TokenPurchase) => Promise<void>;
}) {
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
      await onSave({
        ...purchase,
        provider,
        amount_cents: parseMoneyToCents(amount),
        units: Number(units) || 0,
        unit_type: unitType || null,
        note: note || null,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Edit token purchase
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Provider
            </Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as TokenProvider)}>
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
                Amount paid
              </Label>
              <div className="relative mt-2">
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                  style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
                >
                  $
                </span>
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="le-mono pl-7"
                  required
                />
              </div>
            </div>
            <div>
              <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
                Units
              </Label>
              <Input
                type="number"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="le-mono mt-2"
              />
            </div>
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Unit type
            </Label>
            <Input value={unitType} onChange={(e) => setUnitType(e.target.value)} className="mt-2" />
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Note
            </Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditExpenseDialog({
  expense,
  onClose,
  onSave,
}: {
  expense: Expense | null;
  onClose: () => void;
  onSave: (updated: Expense) => Promise<void>;
}) {
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (expense) {
      setCategory(expense.category);
      setAmount((expense.amount_cents / 100).toFixed(2));
      setDescription(expense.description ?? "");
    }
  }, [expense]);

  if (!expense) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...expense,
        category: category.trim(),
        amount_cents: parseMoneyToCents(amount),
        description: description || null,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Edit expense
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Category
            </Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-2"
              required
            />
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Amount
            </Label>
            <div className="relative mt-2">
              <span
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
              >
                $
              </span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="le-mono pl-7"
                required
              />
            </div>
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Description
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRevenueDialog({
  revenue,
  onClose,
  onSave,
}: {
  revenue: RevenueEntry | null;
  onClose: () => void;
  onSave: (updated: RevenueEntry) => Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (revenue) {
      setSource(revenue.source);
      setAmount((revenue.amount_cents / 100).toFixed(2));
      setNote(revenue.note ?? "");
    }
  }, [revenue]);

  if (!revenue) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...revenue,
        source: source.trim(),
        amount_cents: parseMoneyToCents(amount),
        note: note || null,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">
            Edit revenue
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Source
            </Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="mt-2"
              required
            />
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Amount
            </Label>
            <div className="relative mt-2">
              <span
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: "var(--le-text-muted)", opacity: 0.6 }}
              >
                $
              </span>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="le-mono pl-7"
                required
              />
            </div>
          </div>
          <div>
            <Label className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              Note
            </Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
