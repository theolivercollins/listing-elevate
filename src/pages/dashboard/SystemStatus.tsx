import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertTriangle, RefreshCw, ChevronDown, ExternalLink, ArrowLeft } from "lucide-react";
import {
  fetchSystemStatus,
  fetchSkuAffinity,
  setSystemFlag,
  type SystemStatusResponse,
  type SystemStatusEvent,
  type SystemStatusFeedbackRow,
  type SystemStatusFlag,
  type SkuAffinityResponse,
} from "@/lib/systemStatusApi";

// Auto-refresh every 30s while the tab is visible. Cheap — one endpoint.
const REFRESH_MS = 30_000;

export default function SystemStatus() {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [affinity, setAffinity] = useState<SkuAffinityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [s, a] = await Promise.all([fetchSystemStatus(), fetchSkuAffinity()]);
      setStatus(s);
      setAffinity(a);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/development" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <span className="label text-muted-foreground">— Development</span>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em]">System status</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Live view of every API call, queue depth, and budget. Auto-refreshes every 30s while this tab is visible.
            </p>
          </div>
        </div>
        <button
          onClick={reload}
          className="inline-flex items-center gap-2 border border-border bg-background px-3 py-1.5 text-xs hover:border-foreground"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !status ? (
        <div className="py-20 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : status ? (
        <>
          <BudgetBar budget={status.budget} />
          <KillSwitchSection flags={status.system_flags} onReload={reload} />
          <AlertsSection
            regressions={status.recent_regressions}
            queues={status.queues}
            affinity={affinity}
          />
          <ProviderSummarySection rows={status.provider_summary} />
          <QueuesSection queues={status.queues} />
          <AffinitySection affinity={affinity} />
          <FeedbackLogSection rows={status.feedback_log} />
          <LiveFeedSection events={status.events} />
        </>
      ) : null}
    </div>
  );
}

// ── Budget / spend headline ────────────────────────────────

function BudgetBar({ budget }: { budget: SystemStatusResponse["budget"] }) {
  return (
    <section className="grid grid-cols-3 gap-3">
      <StatCard label="Today" value={fmtDollars(budget.today_cents)} />
      <StatCard label="Last 7 days" value={fmtDollars(budget.last_7d_cents)} />
      <StatCard label="Last 30 days" value={fmtDollars(budget.last_30d_cents)} />
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "warn" | "error" }) {
  const toneClass =
    tone === "error" ? "border-destructive/40 bg-destructive/5"
    : tone === "warn" ? "border-amber-500/40 bg-amber-500/5"
    : "border-border bg-background";
  return (
    <div className={`border px-4 py-3 ${toneClass}`}>
      <div className="label text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

// ── Alerts (regressions + queue health) ────────────────────

function AlertsSection({
  regressions,
  queues,
  affinity,
}: {
  regressions: SystemStatusResponse["recent_regressions"];
  queues: SystemStatusResponse["queues"];
  affinity: SkuAffinityResponse | null;
}) {
  const items: Array<{ tone: "warn" | "error"; title: string; detail: string }> = [];
  for (const r of regressions) {
    items.push({
      tone: "warn",
      title: `Banned phrasing reappeared: "${r.pattern}"`,
      detail: `${r.count} occurrence${r.count === 1 ? "" : "s"}${
        r.example_iteration_id ? ` (example: iteration ${r.example_iteration_id.slice(0, 8)})` : ""
      }. Expected 0 — investigate the sanitizer + director template.`,
    });
  }
  if (queues.judge_pending > 20) {
    items.push({
      tone: "warn",
      title: `Judge queue backing up: ${queues.judge_pending} pending`,
      detail: "poll-judge cron should drain at ~5/min. Backlog > 20 likely means the cron is failing or Gemini is 429ing.",
    });
  }
  if (queues.renders_orphan_over_30m > 0) {
    items.push({
      tone: "error",
      title: `${queues.renders_orphan_over_30m} render orphan${queues.renders_orphan_over_30m === 1 ? "" : "s"} (>30m)`,
      detail: "Renders submitted but never finalized. Check poll-lab-renders logs.",
    });
  }
  const latestRun = affinity?.recent_runs[0];
  if (latestRun && Date.now() - new Date(latestRun.ran_at).getTime() > 48 * 3600_000) {
    items.push({
      tone: "warn",
      title: "Affinity refresh cron hasn't run in >48h",
      detail: `Last run: ${new Date(latestRun.ran_at).toLocaleString()}. Check /api/cron/refresh-sku-affinity schedule.`,
    });
  }

  if (items.length === 0) {
    return (
      <section>
        <div className="label text-muted-foreground">Alerts</div>
        <div className="mt-3 border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          All systems green — no active regressions, queues are draining, affinity refresh is recent.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="label text-muted-foreground">Alerts</div>
      <div className="mt-3 space-y-2">
        {items.map((it, i) => (
          <div
            key={i}
            className={`border px-4 py-3 text-sm ${
              it.tone === "error"
                ? "border-destructive/40 bg-destructive/5 text-destructive"
                : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300"
            }`}
          >
            <div className="font-semibold">{it.title}</div>
            <div className="mt-1 text-xs opacity-90">{it.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Provider × stage summary ───────────────────────────────

function ProviderSummarySection({ rows }: { rows: SystemStatusResponse["provider_summary"] }) {
  if (rows.length === 0) {
    return (
      <section>
        <div className="label text-muted-foreground">Providers (7d)</div>
        <div className="mt-3 border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No API calls recorded in the last 7 days.
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <div className="label text-muted-foreground">Providers × stage (7d)</div>
        <div className="text-xs text-muted-foreground">Sorted by 7-day spend</div>
      </div>
      <div className="mt-3 grid grid-cols-[120px_140px_80px_90px_90px_90px_1fr] items-center gap-x-3 border-b border-border pb-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <div>Provider</div>
        <div>Stage</div>
        <div className="text-right">24h n</div>
        <div className="text-right">24h $</div>
        <div className="text-right">7d $</div>
        <div className="text-right">Mean $</div>
        <div>Last call</div>
      </div>
      {rows.map((r) => (
        <div
          key={`${r.provider}|${r.stage}`}
          className="grid grid-cols-[120px_140px_80px_90px_90px_90px_1fr] items-center gap-x-3 border-b border-border/50 py-1.5 text-xs tabular-nums"
        >
          <div className="font-sans font-medium">{r.provider}</div>
          <div className="text-muted-foreground">{r.stage}</div>
          <div className="text-right">{r.count_24h}</div>
          <div className="text-right">{fmtDollars(r.cost_cents_24h)}</div>
          <div className="text-right">{fmtDollars(r.cost_cents_7d)}</div>
          <div className="text-right">{fmtDollars(r.mean_cost_cents)}</div>
          <div className="text-muted-foreground">
            {r.last_at ? new Date(r.last_at).toLocaleString() : "—"}
          </div>
        </div>
      ))}
    </section>
  );
}

// ── Queue depth ────────────────────────────────────────────

function QueuesSection({ queues }: { queues: SystemStatusResponse["queues"] }) {
  return (
    <section>
      <div className="label text-muted-foreground">Queue depth</div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Judge pending" value={String(queues.judge_pending)} tone={queues.judge_pending > 20 ? "warn" : undefined} />
        <StatCard label="Judge errors 24h" value={String(queues.judge_errors_24h)} tone={queues.judge_errors_24h > 5 ? "warn" : undefined} />
        <StatCard label="Renders in-flight" value={String(queues.renders_pending)} />
        <StatCard label="Render orphans (>30m)" value={String(queues.renders_orphan_over_30m)} tone={queues.renders_orphan_over_30m > 0 ? "error" : undefined} />
      </div>
    </section>
  );
}

// ── Affinity rules ─────────────────────────────────────────

function AffinitySection({ affinity }: { affinity: SkuAffinityResponse | null }) {
  if (!affinity) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <div className="label text-muted-foreground">SKU × motion affinity</div>
        {affinity.recent_runs[0] && (
          <div className="text-xs text-muted-foreground">
            Last refreshed {new Date(affinity.recent_runs[0].ran_at).toLocaleString()}
          </div>
        )}
      </div>
      {affinity.rules.length === 0 ? (
        <div className="mt-3 border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No rules yet. The refresh cron needs ≥5 ratings per (motion × SKU) to emit a rule.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {affinity.rules.map((r) => (
            <div key={r.camera_movement} className="border border-border bg-background px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-sans font-medium">{r.camera_movement}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                  r.confidence === "high_empirical" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : r.confidence === "medium_empirical" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : "bg-muted text-muted-foreground"
                }`}>
                  {r.confidence}
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  refreshed {new Date(r.last_refreshed_at).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{r.reason}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {r.prefer.length > 0 && (
                  <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:text-emerald-300">
                    ✓ prefer: {r.prefer.join(", ")}
                  </span>
                )}
                {r.avoid.length > 0 && (
                  <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-300">
                    ⚠ avoid: {r.avoid.join(", ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Live feed ─────────────────────────────────────────────

function LiveFeedSection({ events }: { events: SystemStatusEvent[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (events.length === 0) {
    return (
      <section>
        <div className="label text-muted-foreground">Live feed</div>
        <div className="mt-3 border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No recent API calls.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <div className="label text-muted-foreground">Live feed — last 100 API calls</div>
        <div className="text-xs text-muted-foreground">Click any row to expand</div>
      </div>
      <div className="mt-3 space-y-1">
        {events.map((e) => {
          const isOpen = expanded.has(e.id);
          const iterationId = (e.metadata?.iteration_id ?? e.metadata?.session_id ?? null) as string | null;
          return (
            <div key={e.id} className="border border-border bg-background text-xs">
              <button
                onClick={() => toggle(e.id)}
                className="grid w-full grid-cols-[110px_90px_110px_90px_1fr_24px] items-center gap-x-3 px-3 py-1.5 text-left hover:bg-accent/30"
              >
                <span className="font-sans text-muted-foreground">{fmtTime(e.created_at)}</span>
                <span className="font-sans font-medium">{e.provider}</span>
                <span className="text-muted-foreground">{e.stage}</span>
                <span className="text-right font-medium tabular-nums">{fmtDollars(e.cost_cents ?? 0)}</span>
                <span className="truncate text-muted-foreground">
                  {metadataSummary(e.metadata)}
                </span>
                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
              </button>
              {isOpen && (
                <div className="border-t border-border px-3 py-3 text-[11px]">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-sans">
                    <span className="text-muted-foreground">units:</span><span>{e.units_consumed ?? "—"} {e.unit_type ?? ""}</span>
                    <span className="text-muted-foreground">cost:</span><span>{fmtDollars(e.cost_cents ?? 0)}</span>
                  </div>
                  {iterationId && (
                    <div className="mt-2">
                      <Link
                        to={`/dashboard/development/prompt-lab/${iterationId}`}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline"
                      >
                        Open iteration <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                  <div className="mt-2">
                    <div className="text-muted-foreground">metadata:</div>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 font-sans text-[10px] leading-relaxed">
                      {JSON.stringify(e.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Kill-switch toggles ─────────────────────────────────────

function KillSwitchSection({ flags, onReload }: { flags: SystemStatusFlag[]; onReload: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  if (flags.length === 0) return null;

  async function toggle(flag: SystemStatusFlag) {
    const nextValue = !flag.value;
    const reason = nextValue
      ? window.prompt(`Why pause "${flag.name}"?`, "operator manual pause") ?? undefined
      : "operator unpaused";
    setPending(flag.name);
    try {
      await setSystemFlag(flag.name, nextValue, reason);
      await onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <div className="label text-muted-foreground">Kill switches</div>
      <div className="mt-3 space-y-2">
        {flags.map((f) => (
          <div
            key={f.name}
            className={`flex flex-wrap items-center gap-3 border px-4 py-3 text-sm ${
              f.value ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background"
            }`}
          >
            <span className="font-sans font-medium">{f.name}</span>
            <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${
              f.value ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                      : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
            }`}>
              {f.value ? "PAUSED" : "RUNNING"}
            </span>
            {f.reason && <span className="text-muted-foreground text-xs">"{f.reason}"</span>}
            <span className="ml-auto text-[11px] text-muted-foreground">
              set {new Date(f.set_at).toLocaleString()}
            </span>
            <button
              onClick={() => toggle(f)}
              disabled={pending === f.name}
              className="shrink-0 border border-foreground/40 bg-background px-3 py-1 text-xs hover:bg-foreground hover:text-background transition"
            >
              {pending === f.name ? "…" : f.value ? "Resume" : "Pause"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Feedback log (line-by-line) ─────────────────────────────

function FeedbackLogSection({ rows }: { rows: SystemStatusFeedbackRow[] }) {
  const [filter, setFilter] = useState<"all" | "rated" | "tagged" | "commented" | "refined">("all");

  const filtered = rows.filter((r) => {
    if (filter === "rated") return r.rating != null;
    if (filter === "tagged") return r.tags.length > 0;
    if (filter === "commented") return !!r.user_comment;
    if (filter === "refined") return !!r.refinement_instruction;
    return true;
  });

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <div className="label text-muted-foreground">Feedback log — last 100 iterations with any saved feedback</div>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          {(["all","rated","tagged","commented","refined"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-full border px-2 py-0.5 transition ${
                filter === k ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="mt-3 border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No feedback matching filter.
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {filtered.map((r) => (
            <div key={r.iteration_id} className="border border-border bg-background px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-sans text-[10px] tabular-nums text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.order_id && (
                  <Link
                    to={`/dashboard/development/prompt-lab/${r.session_id ?? ""}`}
                    className="font-sans text-[10px] tabular-nums text-muted-foreground hover:text-foreground underline"
                    title="Open session"
                  >
                    {r.order_id}
                  </Link>
                )}
                {r.model_used && (
                  <span className="rounded bg-muted/60 px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
                    {r.model_used}
                  </span>
                )}
                {r.rating != null && (
                  <span className={`inline-flex items-center gap-0.5 font-medium ${
                    r.rating >= 4 ? "text-emerald-700 dark:text-emerald-300"
                    : r.rating <= 2 ? "text-destructive"
                    : "text-muted-foreground"
                  }`}>
                    {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                  </span>
                )}
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.tags.map((t) => (
                      <span key={t} className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {r.user_comment && (
                <div className="mt-1 leading-snug text-muted-foreground">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">note: </span>
                  {r.user_comment}
                </div>
              )}
              {r.refinement_instruction && (
                <div className="mt-1 leading-snug text-muted-foreground">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">refine: </span>
                  {r.refinement_instruction}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Helpers ────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  if (cents >= 10000) return `$${(cents / 100).toFixed(0)}`;
  if (cents >= 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(3)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function metadataSummary(md: Record<string, unknown> | null | undefined): string {
  if (!md) return "—";
  const keys: string[] = [];
  if (md.scope) keys.push(String(md.scope));
  if (md.subtype) keys.push(String(md.subtype));
  if (md.model) keys.push(String(md.model));
  if (md.sku) keys.push(String(md.sku));
  if (md.iteration_id) keys.push(`iter ${String(md.iteration_id).slice(0, 8)}`);
  return keys.length > 0 ? keys.join(" · ") : JSON.stringify(md).slice(0, 80);
}
