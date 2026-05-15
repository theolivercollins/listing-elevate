import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertTriangle, RefreshCw, ChevronDown, ExternalLink } from "lucide-react";
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
import { fetchModelHealth, type ModelHealthResponse } from "@/lib/api";
import { PageHeading, KpiCard, Card, SectionTitle } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// Auto-refresh every 30s while the tab is visible. Cheap — one endpoint.
const REFRESH_MS = 30_000;

export default function SystemStatus() {
  const [tab, setTab] = useState<"health" | "models">("health");
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [affinity, setAffinity] = useState<SkuAffinityResponse | null>(null);
  const [modelHealth, setModelHealth] = useState<ModelHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [s, a, mh] = await Promise.all([
        fetchSystemStatus(),
        fetchSkuAffinity(),
        fetchModelHealth().catch(() => null),
      ]);
      setStatus(s);
      setAffinity(a);
      setModelHealth(mh);
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

  const hasDegraded = status
    ? status.queues.renders_orphan_over_30m > 0 || status.recent_regressions.length > 0
    : false;

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeading
        eyebrow="Infrastructure · Health"
        title="System status"
        sub="Live view of every API call, queue depth, and budget. Auto-refreshes every 30s while this tab is visible."
        actions={
          <button
            type="button"
            className="le-btn-ghost"
            onClick={reload}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 500 }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      />

      {/* In-page tab control */}
      <nav
        style={{
          display: "inline-flex",
          padding: 4,
          background: "rgba(11,11,16,0.04)",
          borderRadius: 999,
          alignSelf: "flex-start",
        }}
        aria-label="System status sub-navigation"
      >
        {(["health", "models"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
              border: "none",
              background: tab === t ? "var(--ink)" : "transparent",
              color: tab === t ? "var(--surface)" : "var(--muted)",
              transition: "background .15s, color .15s",
            }}
          >
            {t === "health" ? "Health" : "Models"}
          </button>
        ))}
      </nav>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(196,74,74,0.06)",
            border: "1px solid rgba(196,74,74,0.20)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {tab === "health" ? (
        loading && !status ? (
          <div style={{ padding: "80px 0", textAlign: "center" }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--muted)" }} className="animate-spin mx-auto" />
          </div>
        ) : status ? (
          <>
            {/* Hero health card */}
            <Card padding={20}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  className="le-dot-pulse"
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: hasDegraded ? "var(--warn)" : "var(--good)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "var(--ink)",
                  }}
                >
                  {hasDegraded ? "Degraded — review alerts below" : "All systems operational"}
                </span>
              </div>
              {hasDegraded && (
                <p style={{ margin: "8px 0 0 22px", fontSize: 13, color: "var(--muted)" }}>
                  {status.queues.renders_orphan_over_30m > 0
                    ? `${status.queues.renders_orphan_over_30m} render orphan(s) detected · failover may be active`
                    : "One or more regressions detected — see alerts below"}
                </p>
              )}
            </Card>

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
        ) : null
      ) : (
        <ModelsView data={modelHealth} loading={loading} />
      )}
    </div>
  );
}

// ── Budget / spend headline ────────────────────────────────

function BudgetBar({ budget }: { budget: SystemStatusResponse["budget"] }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      <KpiCard label="Today" value={fmtDollars(budget.today_cents)} />
      <KpiCard label="Last 7 days" value={fmtDollars(budget.last_7d_cents)} />
      <KpiCard label="Last 30 days" value={fmtDollars(budget.last_30d_cents)} />
    </section>
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

  return (
    <Card padding={20}>
      <SectionTitle eyebrow="Alerts" title="Active alerts" />
      <div style={{ marginTop: 14 }}>
        {items.length === 0 ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(47,138,85,0.07)",
              border: "1px solid rgba(47,138,85,0.18)",
              color: "var(--good)",
              fontSize: 13,
            }}
          >
            All systems green — no active regressions, queues are draining, affinity refresh is recent.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: it.tone === "error" ? "rgba(196,74,74,0.06)" : "rgba(182,128,44,0.06)",
                  border: `1px solid ${it.tone === "error" ? "rgba(196,74,74,0.20)" : "rgba(182,128,44,0.20)"}`,
                  color: it.tone === "error" ? "var(--bad)" : "var(--warn)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>{it.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Provider × stage summary ───────────────────────────────

function ProviderSummarySection({ rows }: { rows: SystemStatusResponse["provider_summary"] }) {
  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle eyebrow="Providers (7d)" title="Provider × stage breakdown" />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Sorted by 7-day spend</span>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          No API calls recorded in the last 7 days.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 140px 80px 90px 90px 90px 1fr",
              gap: 12,
              padding: "10px 14px",
              borderBottom: "1px solid var(--line-2)",
            }}
          >
            {["Provider", "Stage", "24h n", "24h $", "7d $", "Mean $", "Last call"].map((h, i) => (
              <span
                key={h}
                className="le-d-label"
                style={{ textAlign: i >= 2 && i <= 5 ? "right" : undefined }}
              >
                {h}
              </span>
            ))}
          </div>
          {rows.map((r) => (
            <div
              key={`${r.provider}|${r.stage}`}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 140px 80px 90px 90px 90px 1fr",
                gap: 12,
                padding: "12px 14px",
                borderBottom: "1px solid var(--line-2)",
                alignItems: "center",
                fontSize: 12.5,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.provider}</span>
              <span style={{ color: "var(--muted)" }}>{r.stage}</span>
              <span style={{ textAlign: "right" }}>{r.count_24h}</span>
              <span style={{ textAlign: "right" }}>{fmtDollars(r.cost_cents_24h)}</span>
              <span style={{ textAlign: "right" }}>{fmtDollars(r.cost_cents_7d)}</span>
              <span style={{ textAlign: "right" }}>{fmtDollars(r.mean_cost_cents)}</span>
              <span style={{ color: "var(--muted)" }}>
                {r.last_at ? new Date(r.last_at).toLocaleString() : "—"}
              </span>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

// ── Queue depth ────────────────────────────────────────────

function QueuesSection({ queues }: { queues: SystemStatusResponse["queues"] }) {
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
      <KpiCard
        label="Judge pending"
        value={String(queues.judge_pending)}
        sub={queues.judge_pending > 20 ? "above 20 — check cron" : "draining normally"}
      />
      <KpiCard
        label="Judge errors · 24h"
        value={String(queues.judge_errors_24h)}
        sub={queues.judge_errors_24h > 5 ? "elevated — review logs" : "within threshold"}
      />
      <KpiCard label="Renders in-flight" value={String(queues.renders_pending)} sub="submitted, awaiting callback" />
      <KpiCard
        label="Render orphans (>30m)"
        value={String(queues.renders_orphan_over_30m)}
        sub={queues.renders_orphan_over_30m > 0 ? "check poll-lab-renders" : "none detected"}
      />
    </section>
  );
}

// ── Affinity rules ─────────────────────────────────────────

function AffinitySection({ affinity }: { affinity: SkuAffinityResponse | null }) {
  if (!affinity) return null;

  const confStyle: Record<string, { color: string; bg: string }> = {
    high_empirical: { color: "var(--good)", bg: "rgba(47,138,85,0.10)" },
    medium_empirical: { color: "var(--warn)", bg: "rgba(182,128,44,0.10)" },
  };

  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle eyebrow="Affinity" title="SKU × motion affinity" />
        {affinity.recent_runs[0] && (
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            Last refreshed {new Date(affinity.recent_runs[0].ran_at).toLocaleString()}
          </span>
        )}
      </div>

      {affinity.rules.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          No rules yet. The refresh cron needs at least 5 ratings per (motion × SKU) to emit a rule.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {affinity.rules.map((r) => {
            const cs = confStyle[r.confidence] ?? { color: "var(--muted)", bg: "rgba(11,11,16,0.05)" };
            return (
              <div
                key={r.camera_movement}
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(11,11,16,0.025)",
                  border: "1px solid var(--line)",
                  fontSize: 13,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.camera_movement}</span>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 99,
                      fontSize: 10.5,
                      fontWeight: 600,
                      background: cs.bg,
                      color: cs.color,
                    }}
                  >
                    {r.confidence}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
                    refreshed {new Date(r.last_refreshed_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{r.reason}</div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {r.prefer.length > 0 && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontSize: 11,
                        background: "rgba(47,138,85,0.10)",
                        color: "var(--good)",
                      }}
                    >
                      prefer: {r.prefer.join(", ")}
                    </span>
                  )}
                  {r.avoid.length > 0 && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 99,
                        fontSize: 11,
                        background: "rgba(182,128,44,0.10)",
                        color: "var(--warn)",
                      }}
                    >
                      avoid: {r.avoid.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
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

  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle eyebrow="Live feed" title="Last 100 API calls" />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Click any row to expand</span>
      </div>

      {events.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          No recent API calls.
        </div>
      ) : (
        <div
          className="le-card-flat"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {events.map((e, idx) => {
            const isOpen = expanded.has(e.id);
            const iterationId = (e.metadata?.iteration_id ?? e.metadata?.session_id ?? null) as string | null;
            return (
              <div
                key={e.id}
                style={{ borderBottom: idx === events.length - 1 ? "none" : "1px solid var(--line-2)" }}
              >
                <button
                  onClick={() => toggle(e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 90px 110px 90px 1fr 20px",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 14px",
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    transition: "background .15s",
                  }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = "rgba(11,11,16,0.025)"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ color: "var(--muted)" }}>{fmtTime(e.created_at)}</span>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>{e.provider}</span>
                  <span style={{ color: "var(--muted)" }}>{e.stage}</span>
                  <span style={{ textAlign: "right", fontWeight: 600 }}>{fmtDollars(e.cost_cents ?? 0)}</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--muted)",
                    }}
                  >
                    {metadataSummary(e.metadata)}
                  </span>
                  <ChevronDown
                    style={{
                      width: 12,
                      height: 12,
                      color: "var(--muted)",
                      transition: "transform .2s",
                      transform: isOpen ? "none" : "rotate(-90deg)",
                    }}
                  />
                </button>
                {isOpen && (
                  <div
                    style={{
                      borderTop: "1px solid var(--line-2)",
                      padding: "12px 14px",
                      fontSize: 11.5,
                      color: "var(--ink-2)",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "4px 16px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span style={{ color: "var(--muted)" }}>units:</span>
                      <span>{e.units_consumed ?? "—"} {e.unit_type ?? ""}</span>
                      <span style={{ color: "var(--muted)" }}>cost:</span>
                      <span>{fmtDollars(e.cost_cents ?? 0)}</span>
                    </div>
                    {iterationId && (
                      <div style={{ marginTop: 8 }}>
                        <Link
                          to={`/dashboard/development/prompt-lab/${iterationId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11.5,
                            color: "var(--muted)",
                            textDecoration: "underline",
                          }}
                        >
                          Open iteration
                          <ExternalLink style={{ width: 11, height: 11 }} />
                        </Link>
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <span style={{ color: "var(--muted)" }}>metadata:</span>
                      <pre
                        style={{
                          marginTop: 4,
                          padding: "8px 10px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(11,11,16,0.04)",
                          fontSize: 10.5,
                          lineHeight: 1.6,
                          overflowX: "auto",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {JSON.stringify(e.metadata ?? {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
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
    <Card padding={20}>
      <SectionTitle eyebrow="Kill switches" title="System flags" />
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {flags.map((f) => (
          <div
            key={f.name}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              background: f.value ? "rgba(182,128,44,0.06)" : "rgba(11,11,16,0.025)",
              border: `1px solid ${f.value ? "rgba(182,128,44,0.20)" : "var(--line)"}`,
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}>{f.name}</span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 99,
                fontSize: 10.5,
                fontWeight: 600,
                background: f.value ? "rgba(182,128,44,0.12)" : "rgba(47,138,85,0.10)",
                color: f.value ? "var(--warn)" : "var(--good)",
              }}
            >
              {f.value ? "PAUSED" : "RUNNING"}
            </span>
            {f.reason && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>"{f.reason}"</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              set {new Date(f.set_at).toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => toggle(f)}
              disabled={pending === f.name}
              className={f.value ? "le-btn-dark" : "le-btn-ghost"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: "var(--radius-pill)",
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              {pending === f.name ? "…" : f.value ? "Resume" : "Pause"}
            </button>
          </div>
        ))}
      </div>
    </Card>
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

  const ratingColor = (rating: number) => {
    if (rating >= 4) return "var(--good)";
    if (rating <= 2) return "var(--bad)";
    return "var(--muted)";
  };

  return (
    <Card padding={20}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle eyebrow="Feedback log" title="Last 100 iterations with saved feedback" />
        <div className="le-seg" style={{ display: "inline-flex" }}>
          {(["all", "rated", "tagged", "commented", "refined"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`le-seg-item${filter === k ? " is-active" : ""}`}
              style={{ fontSize: 11, padding: "5px 10px", cursor: "pointer" }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
            border: "1px dashed var(--line)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          No feedback matching filter.
        </div>
      ) : (
        <div
          className="le-card-flat"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {filtered.map((r, idx) => (
            <div
              key={r.iteration_id}
              style={{
                padding: "10px 14px",
                borderBottom: idx === filtered.length - 1 ? "none" : "1px solid var(--line-2)",
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.order_id && (
                  <Link
                    to={`/dashboard/development/prompt-lab/${r.session_id ?? ""}`}
                    style={{
                      color: "var(--muted)",
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                      textDecoration: "underline",
                    }}
                    title="Open session"
                  >
                    {r.order_id}
                  </Link>
                )}
                {r.model_used && (
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(11,11,16,0.05)",
                      fontSize: 11,
                      color: "var(--muted)",
                    }}
                  >
                    {r.model_used}
                  </span>
                )}
                {r.rating != null && (
                  <span
                    style={{
                      fontWeight: 600,
                      color: ratingColor(r.rating),
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
                  </span>
                )}
                {r.tags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          padding: "1px 6px",
                          borderRadius: 99,
                          fontSize: 10.5,
                          background: "rgba(11,11,16,0.05)",
                          color: "var(--muted)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {r.user_comment && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                  <span style={{ fontSize: 10.5, color: "var(--muted-2)" }}>note: </span>
                  {r.user_comment}
                </div>
              )}
              {r.refinement_instruction && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                  <span style={{ fontSize: 10.5, color: "var(--muted-2)" }}>refine: </span>
                  {r.refinement_instruction}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Models view ───────────────────────────────────────────

function ModelsView({ data, loading }: { data: ModelHealthResponse | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <Loader2 style={{ width: 20, height: 20, color: "var(--muted)" }} className="animate-spin mx-auto" />
      </div>
    );
  }

  const rows = data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          fontSize: 13,
          color: "var(--muted)",
          border: "1px dashed var(--line)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        No model calls in the last 24 hours.
      </div>
    );
  }

  // KPI aggregates
  const totalCalls = rows.reduce((s, r) => s + r.calls_24h, 0);
  const totalFailures = rows.reduce((s, r) => s + r.failures_24h, 0);

  // Weighted uptime: weight each provider by its call count
  const weightedUptime =
    totalCalls > 0
      ? rows.reduce((s, r) => {
          const uptime = r.calls_24h > 0 ? (1 - r.failures_24h / r.calls_24h) * 100 : 100;
          return s + uptime * r.calls_24h;
        }, 0) / totalCalls
      : 100;

  // Median p50 across providers that have latency data
  const p50s = rows.map((r) => r.p50_ms).filter((v): v is number => v != null);
  const avgP50 = p50s.length > 0 ? Math.round(p50s.reduce((a, b) => a + b, 0) / p50s.length) : null;

  return (
    <>
      {/* KPI row */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard
          label="Avg latency · p50"
          value={avgP50 != null ? `${avgP50.toLocaleString()} ms` : "—"}
          sub="median across providers with data"
        />
        <KpiCard
          label="Uptime · 24h"
          value={`${weightedUptime.toFixed(1)}%`}
          sub="weighted by call volume"
        />
        <KpiCard label="Calls · 24h" value={totalCalls.toLocaleString()} />
        <KpiCard
          label="Failures · 24h"
          value={String(totalFailures)}
          sub={totalFailures > 0 ? "rows with metadata.error set" : "none recorded"}
        />
      </section>

      {/* Per-provider table */}
      <Card padding={0}>
        {/* Header row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "140px 90px 90px 90px 90px 1fr",
            gap: 12,
            padding: "10px 14px",
            borderBottom: "1px solid var(--line-2)",
          }}
        >
          {["Provider", "Latency p50", "Latency p95", "Uptime", "Calls (24h)", "Last call"].map((h, i) => (
            <span
              key={h}
              className="le-d-label"
              style={{ textAlign: i >= 1 && i <= 4 ? "right" : undefined }}
            >
              {h}
            </span>
          ))}
        </div>

        {rows.map((r, idx) => {
          const uptimePct = r.calls_24h > 0 ? (1 - r.failures_24h / r.calls_24h) * 100 : 100;
          const dotColor =
            uptimePct >= 99 ? "var(--good)" : uptimePct >= 95 ? "var(--warn)" : "var(--bad)";

          return (
            <div
              key={r.provider}
              style={{
                display: "grid",
                gridTemplateColumns: "140px 90px 90px 90px 90px 1fr",
                gap: 12,
                padding: "12px 14px",
                borderBottom: idx === rows.length - 1 ? "none" : "1px solid var(--line-2)",
                alignItems: "center",
                fontSize: 12.5,
                fontVariantNumeric: "tabular-nums",
                transition: "background .15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(11,11,16,0.02)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Provider + status dot */}
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.provider}</span>
              </span>

              {/* Latency p50 */}
              <span style={{ textAlign: "right", color: "var(--ink)" }}>
                {r.p50_ms != null ? `${r.p50_ms.toLocaleString()} ms` : "—"}
              </span>

              {/* Latency p95 */}
              <span style={{ textAlign: "right", color: "var(--ink)" }}>
                {r.p95_ms != null ? `${r.p95_ms.toLocaleString()} ms` : "—"}
              </span>

              {/* Uptime */}
              <span
                style={{
                  textAlign: "right",
                  color: dotColor,
                  fontWeight: 600,
                }}
              >
                {uptimePct.toFixed(1)}%
              </span>

              {/* Calls 24h */}
              <span style={{ textAlign: "right" }}>{r.calls_24h.toLocaleString()}</span>

              {/* Last call */}
              <span style={{ color: "var(--muted)" }}>
                {r.last_at ? fmtTime(r.last_at) : "—"}
              </span>
            </div>
          );
        })}
      </Card>
    </>
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
