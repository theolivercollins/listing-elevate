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
  X,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// New-dashboard primitives (Card, KpiCard, Sparkline, MoneyValue, fmtMoney)
import {
  KpiCard,
  Card,
  Sparkline,
  MoneyValue,
  fmtMoney,
  Skeleton,
  SkeletonRow,
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
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from "@/lib/finances";
import type {
  TokenPurchase,
  Expense,
  RevenueEntry,
  TokenProvider,
  CostEvent,
  Subscription,
  BillingPeriod,
  SubscriptionStatus,
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
  { id: "atlas", label: "Atlas" },
  { id: "runway", label: "Runway" },
  { id: "kling", label: "Kling" },
  { id: "anthropic", label: "Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "other", label: "Other" },
];

const PROVIDER_COLORS: Record<TokenProvider, string> = {
  atlas: "#f97316",
  runway: "#6366f1",
  kling: "#22d3ee",
  anthropic: "#d97706",
  openai: "#10b981",
  other: "#64748b",
};

// Extended provider list for Log Purchase and Subscriptions
const ALL_PROVIDERS = [
  "anthropic",
  "atlas",
  "apify",
  "browserbase",
  "creatomate",
  "elevenlabs",
  "gemini",
  "google",
  "higgsfield",
  "kling",
  "openai",
  "openrouter",
  "runway",
  "shotstack",
  "supabase",
  "other",
] as const;

type AllProvider = (typeof ALL_PROVIDERS)[number];

const ALL_PROVIDER_LABELS: Record<AllProvider, string> = {
  anthropic: "Anthropic / Claude",
  atlas: "Atlas (MongoDB)",
  apify: "Apify",
  browserbase: "Browserbase",
  creatomate: "Creatomate",
  elevenlabs: "ElevenLabs",
  gemini: "Gemini",
  google: "Google",
  higgsfield: "Higgsfield",
  kling: "Kling",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  runway: "Runway",
  shotstack: "Shotstack",
  supabase: "Supabase",
  other: "Other",
};

const PURCHASE_TYPES = [
  { id: "credits", label: "API credits" },
  { id: "tokens", label: "Token credits" },
  { id: "one_time", label: "One-time charge" },
];

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Native form input (v3 token-aligned) ────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "var(--le-r-sm)",
  border: "1px solid var(--line, var(--le-border))",
  background: "var(--surface, var(--le-surface))",
  color: "var(--ink, var(--le-text))",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color .15s",
  boxSizing: "border-box",
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
  paddingRight: 32,
};

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted, var(--le-muted))",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  marginBottom: 6,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={LABEL_STYLE}>{children}</span>;
}

function NativeInput(props: React.InputHTMLAttributes<HTMLInputElement> & { style?: React.CSSProperties }) {
  const { style, ...rest } = props;
  return (
    <input
      style={{ ...INPUT_STYLE, ...style }}
      onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--accent, var(--le-accent))"; }}
      onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "var(--line, var(--le-border))"; }}
      {...rest}
    />
  );
}

function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement> & { style?: React.CSSProperties }) {
  const { style, ...rest } = props;
  return (
    <select
      style={{ ...SELECT_STYLE, ...style }}
      onFocus={(e) => { (e.target as HTMLSelectElement).style.borderColor = "var(--accent, var(--le-accent))"; }}
      onBlur={(e) => { (e.target as HTMLSelectElement).style.borderColor = "var(--line, var(--le-border))"; }}
      {...rest}
    />
  );
}

function MoneyInput({ value, onChange, placeholder = "0.00", required }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--muted, var(--le-muted))", pointerEvents: "none" }}>$</span>
      <NativeInput
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        style={{ paddingLeft: 24, fontVariantNumeric: "tabular-nums" }}
      />
    </div>
  );
}

// ─── Legend helper ────────────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--le-r-pill)",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12, color: "var(--muted, var(--le-muted))", fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// ─── Breakdown tabs ───────────────────────────────────────────────────────────

const BREAKDOWN_TABS = ["provider", "model", "scope", "stage"] as const;
type BreakdownTab = (typeof BREAKDOWN_TABS)[number];

// ─── Card style (matches old Finances ledger sections) ────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: "var(--surface, var(--le-surface))",
  border: "1px solid var(--line, var(--le-border))",
  borderRadius: "var(--le-r-xl)",
  boxShadow: "var(--shadow-sm, 0 1px 4px rgba(11,11,16,0.06))",
};

// ─── Submit button ────────────────────────────────────────────────────────────

function SubmitBtn({ loading, disabled, children }: { loading: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      style={{
        width: "100%",
        padding: "10px 16px",
        borderRadius: "var(--le-r-sm)",
        border: "none",
        background: disabled || loading ? "rgba(15,24,60,0.08)" : "var(--ink, var(--le-text))",
        color: disabled || loading ? "var(--muted, var(--le-muted))" : "var(--surface, var(--le-surface))",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        transition: "background .15s, color .15s",
        fontFamily: "inherit",
      }}
    >
      {loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : children}
    </button>
  );
}

// ─── DegradedBadge ────────────────────────────────────────────────────────────
// Shown when a data source fetch fails (amber, distinct from EmptyState).
// EmptyState = "no rows"; DegradedBadge = "source errored, try again".

function DegradedBadge({
  testId,
  retryTestId,
  onRetry,
}: {
  testId: string;
  retryTestId: string;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: "var(--le-r-sm)",
        background: "rgba(217, 119, 6, 0.08)",
        border: "1px solid rgba(217, 119, 6, 0.25)",
        marginBottom: 12,
      }}
    >
      <Icon name="alert" size={13} style={{ color: "var(--warn, var(--le-warn))", flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--warn, var(--le-warn))" }}>
        Cost data unavailable
      </span>
      <button
        type="button"
        data-testid={retryTestId}
        onClick={onRetry}
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--warn, var(--le-warn))",
          background: "none",
          border: "1px solid rgba(217, 119, 6, 0.35)",
          borderRadius: "var(--le-r-sm)",
          padding: "2px 8px",
          cursor: "pointer",
          marginLeft: 4,
          fontFamily: "inherit",
        }}
      >
        Retry
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Finances() {
  // ── Ledger state (token_purchases, expenses, revenue_entries) ────────────
  const [purchases, setPurchases] = useState<TokenPurchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [revenues, setRevenues] = useState<RevenueEntry[]>([]);
  const [costEvents, setCostEvents] = useState<CostEvent[]>([]);
  const [deliveredCount, setDeliveredCount] = useState<number>(0);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  // ── Cost-breakdown API state ─────────────────────────────────────────────
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [costBreakdownFailed, setCostBreakdownFailed] = useState(false);
  const [overviewAvgCents, setOverviewAvgCents] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>("provider");

  // ── Edit state ───────────────────────────────────────────────────────────
  const [editPurchase, setEditPurchase] = useState<TokenPurchase | null>(null);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [editRevenue, setEditRevenue] = useState<RevenueEntry | null>(null);
  const [editSubscription, setEditSubscription] = useState<Subscription | null>(null);

  // ── Log Purchase form (v3 reskin) ────────────────────────────────────────
  const [tpProvider, setTpProvider] = useState<AllProvider>("runway");
  const [tpAmount, setTpAmount] = useState("");
  const [tpType, setTpType] = useState("credits");
  const [tpDate, setTpDate] = useState(todayIso());
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

  // ── Add Subscription modal ───────────────────────────────────────────────
  const [showAddSub, setShowAddSub] = useState(false);
  const [subProvider, setSubProvider] = useState<AllProvider>("openrouter");
  const [subAmount, setSubAmount] = useState("");
  const [subPeriod, setSubPeriod] = useState<BillingPeriod>("monthly");
  const [subStartDate, setSubStartDate] = useState(todayIso());
  const [subNote, setSubNote] = useState("");
  const [subSubmitting, setSubSubmitting] = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, e, r, c, dc, dailyRes, cbRes, overviewRes, subs] = await Promise.all([
          listTokenPurchases(),
          listExpenses(),
          listRevenueEntries(),
          listCostEvents(500),
          countDeliveredVideos(),
          fetchDailyStats(30).catch(() => null),
          fetchCostBreakdown().catch(() => { if (!cancelled) setCostBreakdownFailed(true); return null; }),
          fetchStatsOverview().catch(() => null),
          listSubscriptions().catch(() => [] as Subscription[]),
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
        setSubscriptions(subs);
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

  // ── Cost breakdown retry ──────────────────────────────────────────────────
  function retryCostBreakdown() {
    setCostBreakdownFailed(false);
    fetchCostBreakdown()
      .then((res) => setCostBreakdown(res))
      .catch(() => setCostBreakdownFailed(true));
  }

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

  // ── Derived: subscriptions KPIs ──────────────────────────────────────────
  const activeSubs = useMemo(
    () => subscriptions.filter((s) => s.status === "active"),
    [subscriptions],
  );

  const estimatedMonthlyCents = useMemo(() => {
    return activeSubs.reduce((sum, sub) => {
      if (sub.billing_period === "monthly") return sum + sub.amount_cents;
      if (sub.billing_period === "yearly") return sum + Math.round(sub.amount_cents / 12);
      return sum;
    }, 0);
  }, [activeSubs]);

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

  // ── Handlers: Log Purchase ────────────────────────────────────────────────
  async function handleAddPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!tpAmount) return;
    setTpSubmitting(true);
    try {
      // Map AllProvider → TokenProvider (coerce unknowns to "other")
      const tokenProvider: TokenProvider = (PROVIDERS.find((p) => p.id === tpProvider)?.id ?? "other") as TokenProvider;
      const p = await createTokenPurchase({
        provider: tokenProvider,
        amount_cents: parseMoneyToCents(tpAmount),
        units: 0,
        unit_type: tpType || undefined,
        note: tpNote || undefined,
        purchased_at: tpDate ? new Date(tpDate).toISOString() : undefined,
      });
      setPurchases((prev) => [p, ...prev]);
      setTpAmount(""); setTpNote(""); setTpDate(todayIso());
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

  // ── Handlers: Subscriptions ──────────────────────────────────────────────
  async function handleAddSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!subAmount || !subStartDate) return;
    setSubSubmitting(true);
    try {
      const sub = await createSubscription({
        provider: subProvider,
        amount_cents: parseMoneyToCents(subAmount),
        billing_period: subPeriod,
        started_at: subStartDate,
        next_charge_at: subStartDate,
        note: subNote || undefined,
      });
      setSubscriptions((prev) => [sub, ...prev]);
      setSubAmount(""); setSubNote(""); setSubStartDate(todayIso());
      setShowAddSub(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubSubmitting(false);
    }
  }

  async function handleToggleSubPause(sub: Subscription) {
    const next: SubscriptionStatus = sub.status === "paused" ? "active" : "paused";
    const updated = await updateSubscription(sub.id, { status: next });
    setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function handleCancelSub(sub: Subscription) {
    if (!confirm(`Cancel ${ALL_PROVIDER_LABELS[sub.provider as AllProvider] || sub.provider} subscription?`)) return;
    const updated = await deleteSubscription(sub.id);
    setSubscriptions((prev) => prev.map((s) => (s.id === (updated as Subscription).id ? (updated as Subscription) : s)));
  }

  async function handleSaveSubscription(updated: Subscription) {
    const saved = await updateSubscription(updated.id, {
      provider: updated.provider,
      amount_cents: updated.amount_cents,
      billing_period: updated.billing_period,
      next_charge_at: updated.next_charge_at,
      status: updated.status,
      note: updated.note ?? undefined,
    });
    setSubscriptions((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
    setEditSubscription(null);
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
      <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="le-kpi-card">
              <Skeleton width="55%" height={13} style={{ marginBottom: 14 }} />
              <Skeleton width="70%" height={30} style={{ marginBottom: 10 }} />
              <Skeleton width="45%" height={12} />
            </div>
          ))}
        </section>
        <Card>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="le-fade-up p-10" style={{ ...CARD_STYLE, border: "1px solid var(--bad, var(--le-bad))", background: "rgba(196,74,74,0.06)" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--bad, var(--le-bad))", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          — Error
        </span>
        <p className="mt-3 text-sm" style={{ color: "var(--muted, var(--le-muted))" }}>{error}</p>
      </div>
    );
  }

  const netColor = netCents >= 0 ? "var(--good, var(--le-good))" : "var(--bad, var(--le-bad))";

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Actions row ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
        <p style={{ flex: 1, fontSize: 12, color: "var(--muted, var(--le-muted))", display: "flex", alignItems: "center", gap: 6 }}>
          <Info style={{ width: 13, height: 13 }} strokeWidth={2} />
          Claude usage runs on a Pro subscription — excluded from dollar totals; units still tracked.
        </p>
        <button
          className="le-btn-ghost"
          onClick={handleReconcile}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "9px 14px", borderRadius: "var(--le-r-pill)",
            border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))",
            fontSize: 12.5, fontWeight: 500, color: "var(--ink-2, var(--le-text-secondary))", cursor: "pointer",
          }}
        >
          <Icon name="upload" size={14} />
          Reconcile
        </button>
      </div>

      {/* ── KPI row: 4 ledger totals ─────────────────────────────────────────── */}
      <section className="le-cols-2-lg le-stack-sm" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Revenue (all time)"
          value={<MoneyValue cents={totalRevenueCents} />}
          sub="from revenue_entries"
        />
        <KpiCard
          label="Spend (all time)"
          value={<MoneyValue cents={totalSpendCents} />}
          sub="token purchases + expenses"
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Net (all time)"
          value={
            <span style={{ color: netColor }}>
              {netCents >= 0 ? "+" : "−"}<MoneyValue cents={Math.abs(netCents)} />
            </span>
          }
          sub="revenue − spend"
        />
        <KpiCard
          label="Cost / video"
          value={deliveredCount > 0 ? <MoneyValue cents={costPerVideoCents} /> : "—"}
          sub={deliveredCount > 0 ? `${deliveredCount} delivered` : "no deliveries yet"}
          deltaPositiveIsGood={false}
        />
      </section>

      {/* ── KPI row: 4 cost-event metrics (from /api/stats/cost-breakdown) ────── */}
      <section className="le-cols-2-lg le-stack-sm" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Spend · MTD"
          value={<MoneyValue cents={mtdCents} />}
          sub="rolling 30d from cost_events"
          delta={hasAnySpend ? mtdDelta : null}
          deltaPositiveIsGood={false}
        />
        <KpiCard
          label="Avg / video (7d)"
          value={<MoneyValue cents={avgPerVideo} />}
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
            <h3 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink, var(--le-text))", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: netColor }}>
                {netCents >= 0 ? "+" : "−"}<MoneyValue cents={Math.abs(netCents)} /> net
              </span>
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <LegendDot color="oklch(0.7 0.14 168)" label="Revenue" />
            <LegendDot color="var(--accent, var(--le-accent))" label="Spend" />
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
                  <stop offset="0%" stopColor="var(--accent, var(--le-accent))" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent, var(--le-accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke="rgba(15,24,60,0.06)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--muted, var(--le-muted))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted, var(--le-muted))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface, var(--le-surface))",
                  border: "1px solid var(--line, var(--le-border))",
                  borderRadius: "var(--le-r-sm)",
                  fontSize: 11,
                  padding: 10,
                }}
                formatter={(v: number, name: string) => [fmtMoney(v), name]}
              />
              <Area type="monotone" dataKey="revenue" stroke="oklch(0.7 0.14 168)" strokeWidth={1.5} fill="url(#revArea)" />
              <Area type="monotone" dataKey="spend" stroke="var(--accent, var(--le-accent))" strokeWidth={1.5} fill="url(#spendArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Spend over time sparkline (from cost_events API) ─────────────────── */}
      <Card padding={24}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <span className="le-d-label">API spend over time</span>
            <h3 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink, var(--le-text))", fontVariantNumeric: "tabular-nums" }}>
              <MoneyValue cents={totalSpend14} /> · last 14 days
            </h3>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <LegendDot color="var(--accent, var(--le-accent))" label="API spend (cost_events)" />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          {costSeries.length === 0 || !hasAnySpend ? (
            <div style={{ height: 180, display: "grid", placeItems: "center", fontSize: 13, color: "var(--muted, var(--le-muted))" }}>
              No cost events recorded in the last 14 days.
            </div>
          ) : (
            <Sparkline data={costSeries} color="var(--accent, var(--le-accent))" height={180} showDots />
          )}
        </div>
      </Card>

      {/* ── Provider / model / scope / stage breakdown ────────────────────────── */}
      <Card padding={24}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span className="le-d-label">Cost breakdown</span>
          <div
            style={{
              display: "inline-flex", padding: 4, borderRadius: "var(--le-r-pill)",
              background: "rgba(15,24,60,0.05)",
            }}
          >
            {BREAKDOWN_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setBreakdownTab(t)}
                style={{
                  padding: "8px 16px", borderRadius: "var(--le-r-pill)", border: "none",
                  background: breakdownTab === t ? "var(--ink, var(--le-text))" : "transparent",
                  color: breakdownTab === t ? "var(--surface, var(--le-surface))" : "var(--muted, var(--le-muted))",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  textTransform: "capitalize", transition: "background .15s, color .15s",
                }}
              >
                By {t}
              </button>
            ))}
          </div>
        </div>

        {costBreakdownFailed ? (
          <DegradedBadge
            testId="breakdown-degraded-badge"
            retryTestId="breakdown-degraded-retry"
            onRetry={retryCostBreakdown}
          />
        ) : breakdownRows.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted, var(--le-muted))", border: "1px dashed rgba(15,24,60,0.12)", borderRadius: "var(--le-r-lg)" }}>
            No cost events in the last 30 days.
          </div>
        ) : (
          <div className="le-table-scroll is-wide">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr", gap: 16, padding: "10px 14px", borderBottom: "1px solid rgba(15,24,60,0.06)" }}>
              {[
                { label: breakdownTab === "provider" ? "Provider" : breakdownTab === "model" ? "Model" : breakdownTab === "scope" ? "Scope" : "Stage", align: "left" },
                { label: "Today", align: "right" },
                { label: "7d", align: "right" },
                { label: "30d", align: "right" },
                { label: "Events", align: "right" },
                { label: "Share", align: "left" },
              ].map(({ label, align }) => (
                <span key={label} className="le-d-label" style={{ textAlign: align as "left" | "right", fontSize: 12, color: "var(--muted, var(--le-muted))", fontWeight: 500 }}>
                  {label}
                </span>
              ))}
            </div>
            {breakdownRows.map((r) => (
              <div
                key={r.name}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.2fr", gap: 16, padding: "14px 14px", borderBottom: "1px solid rgba(15,24,60,0.04)", alignItems: "center" }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, var(--le-text))" }}>{r.name}</span>
                <span className="le-tabular" style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted, var(--le-muted))", fontVariantNumeric: "tabular-nums" }}><MoneyValue cents={r.today} /></span>
                <span className="le-tabular" style={{ fontSize: 12.5, textAlign: "right", color: "var(--muted, var(--le-muted))", fontVariantNumeric: "tabular-nums" }}><MoneyValue cents={r.week} /></span>
                <span className="le-tabular" style={{ fontSize: 14, fontWeight: 600, textAlign: "right", color: "var(--ink, var(--le-text))", fontVariantNumeric: "tabular-nums" }}><MoneyValue cents={r.month} /></span>
                <span className="le-tabular" style={{ fontSize: 12, textAlign: "right", color: "var(--muted-2, var(--le-faint))", fontVariantNumeric: "tabular-nums" }}>{r.events.toLocaleString()}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 5, background: "rgba(15,24,60,0.06)", borderRadius: "var(--le-r-pill)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${r.share}%`, background: "var(--accent, var(--le-accent))", borderRadius: "var(--le-r-pill)" }} />
                  </div>
                  <span className="le-tabular" style={{ fontSize: 11, color: "var(--muted-2, var(--le-faint))", width: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.share}%</span>
                </div>
              </div>
            ))}
          </div>
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
              const balanceColor = balanceCents < 0 ? "var(--bad, var(--le-bad))" : "var(--ink, var(--le-text))";
              return (
                <div
                  key={row.provider}
                  style={{
                    borderRadius: "var(--le-r-lg)",
                    padding: 18,
                    background: "rgba(15,24,60,0.03)",
                    border: "1px solid var(--line, var(--le-border))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted, var(--le-muted))", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                        {row.label}
                      </span>
                      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 700, color: balanceColor, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
                        {balanceCents < 0 ? "−" : ""}<MoneyValue cents={Math.abs(balanceCents)} />
                      </div>
                      <p style={{ marginTop: 2, fontSize: 11, color: "var(--muted, var(--le-muted))" }}>remaining</p>
                    </div>
                    <span
                      style={{
                        width: 12, height: 12, borderRadius: "var(--le-r-pill)",
                        background: PROVIDER_COLORS[row.provider],
                        flexShrink: 0, marginTop: 2,
                      }}
                    />
                  </div>
                  <div style={{ marginTop: 14, height: 3, width: "100%", borderRadius: "var(--le-r-pill)", background: "rgba(15,24,60,0.08)" }}>
                    <motion.div
                      style={{ height: "100%", borderRadius: "var(--le-r-pill)", background: PROVIDER_COLORS[row.provider] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${usedPct}%` }}
                      transition={{ duration: 1, ease: EASE }}
                    />
                  </div>
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted, var(--le-muted))", fontVariantNumeric: "tabular-nums" }}>
                    <span><MoneyValue cents={row.spentCents} /> spent</span>
                    <span><MoneyValue cents={row.purchasedCents} /> bought</span>
                  </div>
                  {row.purchasedUnits > 0 && (
                    <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted, var(--le-muted))", opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
                      <span>{Math.round(row.spentUnits).toLocaleString()} units used</span>
                      <span>{Math.round(row.purchasedUnits).toLocaleString()} units bought</span>
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

        {/* ── Log token purchase (v3 reskin) ───────────────────────────────────── */}
        <form onSubmit={handleAddPurchase} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log purchase</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>

            {/* 1. Provider */}
            <div>
              <FieldLabel>Provider</FieldLabel>
              <NativeSelect value={tpProvider} onChange={(e) => setTpProvider(e.target.value as AllProvider)}>
                {ALL_PROVIDERS.map((id) => (
                  <option key={id} value={id}>{ALL_PROVIDER_LABELS[id]}</option>
                ))}
              </NativeSelect>
            </div>

            {/* 2. Amount */}
            <div>
              <FieldLabel>Amount</FieldLabel>
              <MoneyInput value={tpAmount} onChange={setTpAmount} placeholder="250.00" required />
            </div>

            {/* 3. Type */}
            <div>
              <FieldLabel>Type</FieldLabel>
              <NativeSelect value={tpType} onChange={(e) => setTpType(e.target.value)}>
                {PURCHASE_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </NativeSelect>
            </div>

            {/* 4. Date */}
            <div>
              <FieldLabel>Date</FieldLabel>
              <NativeInput
                type="date"
                value={tpDate}
                onChange={(e) => setTpDate(e.target.value)}
                required
              />
            </div>

            {/* 5. Note */}
            <div>
              <FieldLabel>Note <span style={{ textTransform: "none", fontWeight: 400, opacity: 0.6 }}>(optional)</span></FieldLabel>
              <NativeInput
                type="text"
                value={tpNote}
                onChange={(e) => setTpNote(e.target.value)}
                placeholder="e.g. topped up Anthropic console"
              />
            </div>

            <SubmitBtn loading={tpSubmitting} disabled={!tpAmount}>
              <Plus style={{ width: 14, height: 14 }} />
              Log purchase
            </SubmitBtn>
          </div>
        </form>

        {/* ── Log expense ──────────────────────────────────────────────────────── */}
        <form onSubmit={handleAddExpense} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log expense</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <FieldLabel>Category</FieldLabel>
              <NativeInput
                type="text"
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                placeholder="Hosting, tools, marketing…"
                required
              />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <MoneyInput value={expAmount} onChange={setExpAmount} required />
            </div>
            <div>
              <FieldLabel>Description <span style={{ textTransform: "none", fontWeight: 400, opacity: 0.6 }}>(optional)</span></FieldLabel>
              <NativeInput
                type="text"
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="What was it for?"
              />
            </div>
            <SubmitBtn loading={expSubmitting} disabled={!expCategory || !expAmount}>
              <Plus style={{ width: 14, height: 14 }} />
              Log expense
            </SubmitBtn>
          </div>
        </form>

        {/* ── Log revenue ──────────────────────────────────────────────────────── */}
        <form onSubmit={handleAddRevenue} style={{ ...CARD_STYLE, padding: 22 }}>
          <span className="le-d-label">Log revenue</span>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <FieldLabel>Source</FieldLabel>
              <NativeInput
                type="text"
                value={revSource}
                onChange={(e) => setRevSource(e.target.value)}
                placeholder="Customer name, invoice…"
                required
              />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <MoneyInput value={revAmount} onChange={setRevAmount} required />
            </div>
            <div>
              <FieldLabel>Note <span style={{ textTransform: "none", fontWeight: 400, opacity: 0.6 }}>(optional)</span></FieldLabel>
              <NativeInput
                type="text"
                value={revNote}
                onChange={(e) => setRevNote(e.target.value)}
                placeholder="Stripe, manual, subscription…"
              />
            </div>
            <SubmitBtn loading={revSubmitting} disabled={!revSource || !revAmount}>
              <Plus style={{ width: 14, height: 14 }} />
              Log revenue
            </SubmitBtn>
          </div>
        </form>
      </div>

      {/* ── Subscriptions ─────────────────────────────────────────────────────── */}
      <Card padding={24}>
        {/* Header row with KPI + button */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
          <div>
            <span className="le-d-label">Recurring subscriptions</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginTop: 8 }}>
              <div>
                <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--ink, var(--le-text))", fontVariantNumeric: "tabular-nums" }}>
                  <MoneyValue cents={estimatedMonthlyCents} />
                </span>
                <span style={{ fontSize: 13, color: "var(--muted, var(--le-muted))", marginLeft: 6 }}>/ mo estimated</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted, var(--le-muted))" }}>
                {activeSubs.length} active · {subscriptions.filter((s) => s.status === "paused").length} paused
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAddSub(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "9px 16px", borderRadius: "var(--le-r-sm)",
              border: "none", background: "var(--ink, var(--le-text))",
              fontSize: 13, fontWeight: 600, color: "var(--surface, var(--le-surface))", cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            Add subscription
          </button>
        </div>

        {/* Subscriptions table */}
        {subscriptions.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted, var(--le-muted))", border: "1px dashed rgba(15,24,60,0.12)", borderRadius: "var(--le-r-lg)" }}>
            No subscriptions yet. Add your first recurring charge above.
          </div>
        ) : (
          <div className="le-table-scroll is-wide" style={{ borderTop: "1px solid var(--line, var(--le-border))" }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr 80px", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line, var(--le-border))" }}>
              {["Provider", "Amount", "Frequency", "Next charge", "Status", ""].map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  className="le-d-label"
                  style={{ fontSize: 11, color: "var(--muted, var(--le-muted))", fontWeight: 600, textAlign: i === 5 ? "right" : "left" }}
                >
                  {c}
                </span>
              ))}
            </div>

            {subscriptions.map((sub) => {
              const isCancelled = sub.status === "cancelled";
              const isPaused = sub.status === "paused";
              const providerLabel = ALL_PROVIDER_LABELS[sub.provider as AllProvider] || sub.provider;
              const statusColor = isCancelled ? "var(--bad, var(--le-bad))" : isPaused ? "var(--warn, var(--le-warn))" : "var(--good, var(--le-good))";
              const statusBg = isCancelled ? "rgba(196,74,74,0.08)" : isPaused ? "rgba(182,128,44,0.08)" : "rgba(47,138,85,0.08)";
              return (
                <div
                  key={sub.id}
                  style={{
                    display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1fr 80px",
                    gap: 12, alignItems: "center", padding: "14px 0",
                    borderBottom: "1px solid rgba(15,24,60,0.04)",
                    opacity: isCancelled ? 0.45 : 1,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(15,24,60,0.015)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                >
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, var(--le-text))" }}>{providerLabel}</span>
                    {sub.note && (
                      <div style={{ fontSize: 11, color: "var(--muted, var(--le-muted))", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.note}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, var(--le-text))", fontVariantNumeric: "tabular-nums" }}>
                    <MoneyValue cents={sub.amount_cents} />
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted, var(--le-muted))", textTransform: "capitalize" }}>
                    {sub.billing_period}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted, var(--le-muted))", fontVariantNumeric: "tabular-nums" }}>
                    {new Date(sub.next_charge_at).toLocaleDateString()}
                  </span>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, fontWeight: 600, color: statusColor,
                    background: statusBg, padding: "3px 8px", borderRadius: "var(--le-r-pill)",
                    textTransform: "capitalize", width: "fit-content",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "var(--le-r-pill)", background: statusColor, flexShrink: 0 }} />
                    {sub.status}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                    {!isCancelled && (
                      <button
                        type="button"
                        title={isPaused ? "Resume" : "Pause"}
                        onClick={() => handleToggleSubPause(sub)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted, var(--le-muted))", padding: 4, display: "flex", alignItems: "center" }}
                      >
                        <RefreshCw style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Edit"
                      onClick={() => setEditSubscription(sub)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted, var(--le-muted))", padding: 4, display: "flex", alignItems: "center" }}
                    >
                      <Pencil style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                    </button>
                    {!isCancelled && (
                      <button
                        type="button"
                        title="Cancel"
                        onClick={() => handleCancelSub(sub)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bad, var(--le-bad))", padding: 4, display: "flex", alignItems: "center" }}
                      >
                        <X style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Ledger tables ─────────────────────────────────────────────────────── */}
      <LedgerTable
        title="Token purchases"
        rows={purchases.map((p) => ({
          id: p.id,
          cols: [
            { value: PROVIDERS.find((x) => x.id === p.provider)?.label || p.provider, weight: 600, color: "var(--ink, var(--le-text))" },
            { value: p.units ? `${p.units} ${p.unit_type || ""}` : "—", mono: true, color: "var(--muted, var(--le-muted))" },
            { value: p.note || "—", color: "var(--muted, var(--le-muted))", truncate: true },
            { value: new Date(p.purchased_at).toLocaleDateString(), mono: true, color: "var(--muted, var(--le-muted))" },
            { value: fmtMoney(p.amount_cents), mono: true, color: "var(--ink, var(--le-text))", align: "right", weight: 600 },
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
            { value: e.category, weight: 600, color: "var(--ink, var(--le-text))" },
            { value: e.description || "—", color: "var(--muted, var(--le-muted))", truncate: true },
            { value: "", color: "" },
            { value: new Date(e.incurred_at).toLocaleDateString(), mono: true, color: "var(--muted, var(--le-muted))" },
            { value: fmtMoney(e.amount_cents), mono: true, color: "var(--ink, var(--le-text))", align: "right", weight: 600 },
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
            { value: r.source, weight: 600, color: "var(--ink, var(--le-text))" },
            { value: r.note || "—", color: "var(--muted, var(--le-muted))", truncate: true },
            { value: "", color: "" },
            { value: new Date(r.received_at).toLocaleDateString(), mono: true, color: "var(--muted, var(--le-muted))" },
            { value: fmtMoney(r.amount_cents), mono: true, color: "var(--good, var(--le-good))", align: "right", weight: 600 },
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
      <EditSubscriptionDialog subscription={editSubscription} onClose={() => setEditSubscription(null)} onSave={handleSaveSubscription} />

      {/* ── Add Subscription modal ────────────────────────────────────────────── */}
      <Dialog open={showAddSub} onOpenChange={(open) => !open && setShowAddSub(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold tracking-tight">Add subscription</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddSubscription}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
              <div>
                <FieldLabel>Provider</FieldLabel>
                <NativeSelect value={subProvider} onChange={(e) => setSubProvider(e.target.value as AllProvider)}>
                  {ALL_PROVIDERS.map((id) => (
                    <option key={id} value={id}>{ALL_PROVIDER_LABELS[id]}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <FieldLabel>Amount</FieldLabel>
                <MoneyInput value={subAmount} onChange={setSubAmount} placeholder="0.00" required />
              </div>
              <div>
                <FieldLabel>Billing period</FieldLabel>
                <NativeSelect value={subPeriod} onChange={(e) => setSubPeriod(e.target.value as BillingPeriod)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </NativeSelect>
              </div>
              <div>
                <FieldLabel>Start / next charge date</FieldLabel>
                <NativeInput type="date" value={subStartDate} onChange={(e) => setSubStartDate(e.target.value)} required />
              </div>
              <div>
                <FieldLabel>Note <span style={{ textTransform: "none", fontWeight: 400, opacity: 0.6 }}>(optional)</span></FieldLabel>
                <NativeInput
                  type="text"
                  value={subNote}
                  onChange={(e) => setSubNote(e.target.value)}
                  placeholder="e.g. Apify Pro plan"
                />
              </div>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setShowAddSub(false)}
                style={{ padding: "9px 16px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", color: "var(--ink, var(--le-text))", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
              <SubmitBtn loading={subSubmitting} disabled={!subAmount || !subStartDate}>
                <Plus style={{ width: 14, height: 14 }} />
                Add subscription
              </SubmitBtn>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
        <span style={{ fontSize: 11, color: "var(--muted, var(--le-muted))", fontVariantNumeric: "tabular-nums" }}>
          {rows.length} entries
        </span>
      </div>

      <div className="le-table-scroll is-wide" style={{ borderTop: "1px solid var(--line, var(--le-border))" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 1fr 1fr 56px", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line, var(--le-border))" }}>
          {columns.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="le-d-label"
              style={{
                fontSize: 11, color: "var(--muted, var(--le-muted))", fontWeight: 600,
                textAlign: i === columns.length - 1 ? "right" : "left",
              }}
            >
              {c}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted, var(--le-muted))" }}>
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
                    color: c.color || "var(--ink, var(--le-text))",
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
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted, var(--le-muted))", padding: 4, display: "flex", alignItems: "center" }}
                >
                  <Pencil style={{ width: 13, height: 13 }} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(row.id)}
                  aria-label="Delete"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bad, var(--le-bad))", padding: 4, display: "flex", alignItems: "center" }}
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
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <div>
              <FieldLabel>Provider</FieldLabel>
              <NativeSelect value={provider} onChange={(e) => setProvider(e.target.value as TokenProvider)}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </NativeSelect>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Amount paid</FieldLabel>
                <MoneyInput value={amount} onChange={setAmount} required />
              </div>
              <div>
                <FieldLabel>Units</FieldLabel>
                <NativeInput type="number" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <FieldLabel>Unit type</FieldLabel>
              <NativeInput value={unitType} onChange={(e) => setUnitType(e.target.value)} placeholder="credits / tokens" />
            </div>
            <div>
              <FieldLabel>Note</FieldLabel>
              <NativeInput value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: "9px 16px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", color: "var(--ink, var(--le-text))", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <SubmitBtn loading={saving}>Save</SubmitBtn>
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
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <div>
              <FieldLabel>Category</FieldLabel>
              <NativeInput value={category} onChange={(e) => setCategory(e.target.value)} required />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <MoneyInput value={amount} onChange={setAmount} required />
            </div>
            <div>
              <FieldLabel>Description</FieldLabel>
              <NativeInput value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: "9px 16px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", color: "var(--ink, var(--le-text))", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <SubmitBtn loading={saving}>Save</SubmitBtn>
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
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <div>
              <FieldLabel>Source</FieldLabel>
              <NativeInput value={source} onChange={(e) => setSource(e.target.value)} required />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <MoneyInput value={amount} onChange={setAmount} required />
            </div>
            <div>
              <FieldLabel>Note</FieldLabel>
              <NativeInput value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: "9px 16px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", color: "var(--ink, var(--le-text))", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <SubmitBtn loading={saving}>Save</SubmitBtn>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSubscriptionDialog({ subscription, onClose, onSave }: { subscription: Subscription | null; onClose: () => void; onSave: (updated: Subscription) => Promise<void>; }) {
  const [provider, setProvider] = useState<AllProvider>("openrouter");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [nextCharge, setNextCharge] = useState("");
  const [status, setStatus] = useState<SubscriptionStatus>("active");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (subscription) {
      setProvider((subscription.provider as AllProvider) || "other");
      setAmount((subscription.amount_cents / 100).toFixed(2));
      setPeriod(subscription.billing_period);
      setNextCharge(subscription.next_charge_at);
      setStatus(subscription.status);
      setNote(subscription.note ?? "");
    }
  }, [subscription]);

  if (!subscription) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...subscription,
        provider,
        amount_cents: parseMoneyToCents(amount),
        billing_period: period,
        next_charge_at: nextCharge,
        status,
        note: note || null,
      });
    } catch (err) { alert(err instanceof Error ? err.message : "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-lg font-semibold tracking-tight">Edit subscription</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
            <div>
              <FieldLabel>Provider</FieldLabel>
              <NativeSelect value={provider} onChange={(e) => setProvider(e.target.value as AllProvider)}>
                {ALL_PROVIDERS.map((id) => (
                  <option key={id} value={id}>{ALL_PROVIDER_LABELS[id]}</option>
                ))}
              </NativeSelect>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Amount</FieldLabel>
                <MoneyInput value={amount} onChange={setAmount} required />
              </div>
              <div>
                <FieldLabel>Period</FieldLabel>
                <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value as BillingPeriod)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </NativeSelect>
              </div>
            </div>
            <div>
              <FieldLabel>Next charge date</FieldLabel>
              <NativeInput type="date" value={nextCharge} onChange={(e) => setNextCharge(e.target.value)} required />
            </div>
            <div>
              <FieldLabel>Status</FieldLabel>
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </NativeSelect>
            </div>
            <div>
              <FieldLabel>Note</FieldLabel>
              <NativeInput value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={saving} style={{ padding: "9px 16px", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", color: "var(--ink, var(--le-text))", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <SubmitBtn loading={saving}>Save</SubmitBtn>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
