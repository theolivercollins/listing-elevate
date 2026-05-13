import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ArrowLeft,
  Search,
  Pause,
  Play,
  Download,
} from "lucide-react";
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
import { fetchLogs } from "@/lib/api";
import type { PipelineLog, PipelineStage, LogLevel } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "@/v2/styles/v2.css";

// Auto-refresh every 30s while the tab is visible. Cheap — one endpoint.
const REFRESH_MS = 30_000;

// ── Card wrapper ──────────────────────────────────────────────────────────────

function LeCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: "var(--le-bg-elev)",
        border: "1px solid var(--le-border)",
        borderRadius: "var(--le-r-lg)",
        boxShadow: "var(--le-shadow-md)",
        padding: "20px 24px",
      }}
    >
      {children}
    </div>
  );
}

// ── Section eyebrow + header ──────────────────────────────────────────────────

function SectionLabel({ label, aside }: { label: string; aside?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
      <span className="le-eyebrow">{label}</span>
      {aside && (
        <span style={{ fontSize: 11, color: "var(--le-text-muted)" }}>{aside}</span>
      )}
    </div>
  );
}

// ── Ghost button ──────────────────────────────────────────────────────────────

function GhostBtn({
  children,
  onClick,
  disabled,
  danger,
  accent,
  small,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  small?: boolean;
}) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: small ? "4px 10px" : "6px 14px",
    fontSize: small ? 11 : 12,
    fontWeight: 500,
    fontFamily: "var(--le-font-sans)",
    cursor: disabled ? "default" : "pointer",
    border: "1px solid",
    borderRadius: "var(--le-r-sm)",
    transition: "all 0.12s ease",
    opacity: disabled ? 0.5 : 1,
    background: accent ? "var(--le-accent)" : "var(--le-bg-elev)",
    color: accent
      ? "var(--le-accent-fg)"
      : danger
      ? "var(--le-danger)"
      : "var(--le-text)",
    borderColor: accent
      ? "var(--le-accent)"
      : danger
      ? "var(--le-danger)"
      : "var(--le-border-strong)",
  };
  return (
    <button type="button" style={base} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ tone, children }: { tone: "success" | "warn" | "danger" | "muted"; children: React.ReactNode }) {
  const bg =
    tone === "success" ? "var(--le-success-soft)"
    : tone === "warn" ? "var(--le-warn-soft)"
    : tone === "danger" ? "var(--le-danger-soft)"
    : "var(--le-bg-sunken)";
  const color =
    tone === "success" ? "var(--le-success)"
    : tone === "warn" ? "var(--le-warn)"
    : tone === "danger" ? "var(--le-danger)"
    : "var(--le-text-muted)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 500,
        fontFamily: "var(--le-font-mono)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
    <div className="le-root" style={{ padding: 0, background: "transparent" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              to="/dashboard/dev"
              style={{ color: "var(--le-text-muted)", display: "flex", alignItems: "center" }}
            >
              <ArrowLeft style={{ width: 16, height: 16 }} />
            </Link>
            <div>
              <div className="le-eyebrow" style={{ marginBottom: 8 }}>Studio / Dev</div>
              <h1
                className="le-display"
                style={{
                  fontSize: "clamp(28px, 4vw, 40px)",
                  fontWeight: 500,
                  color: "var(--le-text)",
                  margin: 0,
                  lineHeight: 1,
                }}
              >
                System Status
              </h1>
              <p style={{ marginTop: 8, fontSize: 13, color: "var(--le-text-muted)", maxWidth: 500 }}>
                Live ops — kill-switches, regressions, queue depth, pipeline logs. Auto-refreshes every 30s.
              </p>
            </div>
          </div>
          <GhostBtn onClick={reload} disabled={loading}>
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
            Refresh
          </GhostBtn>
        </div>

        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "12px 16px",
              background: "var(--le-danger-soft)",
              border: "1px solid var(--le-danger)",
              borderRadius: "var(--le-r-md)",
              fontSize: 13,
              color: "var(--le-danger)",
            }}
          >
            <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {loading && !status ? (
          <div style={{ padding: "80px 0", textAlign: "center" }}>
            <Loader2 style={{ width: 20, height: 20, margin: "0 auto", color: "var(--le-text-muted)" }} className="animate-spin" />
          </div>
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
            <PipelineLogsPanel />
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Budget / spend headline ───────────────────────────────────────────────────

function BudgetBar({ budget }: { budget: SystemStatusResponse["budget"] }) {
  return (
    <LeCard>
      <SectionLabel label="Spend" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatCard label="Today" value={fmtDollars(budget.today_cents)} />
        <StatCard label="Last 7 days" value={fmtDollars(budget.last_7d_cents)} />
        <StatCard label="Last 30 days" value={fmtDollars(budget.last_30d_cents)} />
      </div>
    </LeCard>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "warn" | "error" }) {
  const bg =
    tone === "error" ? "var(--le-danger-soft)"
    : tone === "warn" ? "var(--le-warn-soft)"
    : "var(--le-bg-sunken)";
  const border =
    tone === "error" ? "var(--le-danger)"
    : tone === "warn" ? "var(--le-warn)"
    : "var(--le-border)";
  return (
    <div
      style={{
        padding: "12px 16px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "var(--le-r-md)",
      }}
    >
      <div className="le-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div
        className="le-mono"
        style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--le-text)" }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Kill-switch toggles ───────────────────────────────────────────────────────

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
    <LeCard>
      <SectionLabel label="Kill switches" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {flags.map((f) => (
          <div
            key={f.name}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: f.value ? "var(--le-warn-soft)" : "var(--le-bg-sunken)",
              border: `1px solid ${f.value ? "var(--le-warn)" : "var(--le-border)"}`,
              borderRadius: "var(--le-r-md)",
            }}
          >
            <span className="le-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--le-text)" }}>{f.name}</span>
            <StatusPill tone={f.value ? "warn" : "success"}>
              {f.value ? "PAUSED" : "RUNNING"}
            </StatusPill>
            {f.reason && (
              <span style={{ fontSize: 11, color: "var(--le-text-muted)" }}>"{f.reason}"</span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--le-text-muted)" }}>
              set {new Date(f.set_at).toLocaleString()}
            </span>
            <GhostBtn
              small
              danger={!f.value}
              onClick={() => toggle(f)}
              disabled={pending === f.name}
            >
              {pending === f.name ? "…" : f.value ? "Resume" : "Pause"}
            </GhostBtn>
          </div>
        ))}
      </div>
    </LeCard>
  );
}

// ── Alerts (regressions + queue health) ──────────────────────────────────────

function AlertsSection({
  regressions,
  queues,
  affinity,
}: {
  regressions: SystemStatusResponse["recent_regressions"];
  queues: SystemStatusResponse["queues"];
  affinity: SkuAffinityResponse | null;
}) {
  const items: Array<{ tone: "warn" | "danger"; title: string; detail: string }> = [];
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
      tone: "danger",
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
    <LeCard>
      <SectionLabel label="Alerts" />
      {items.length === 0 ? (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--le-success-soft)",
            border: "1px solid var(--le-success)",
            borderRadius: "var(--le-r-md)",
            fontSize: 13,
            color: "var(--le-success)",
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
                padding: "12px 16px",
                background: it.tone === "danger" ? "var(--le-danger-soft)" : "var(--le-warn-soft)",
                border: `1px solid ${it.tone === "danger" ? "var(--le-danger)" : "var(--le-warn)"}`,
                borderRadius: "var(--le-r-md)",
                color: it.tone === "danger" ? "var(--le-danger)" : "var(--le-warn)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{it.title}</div>
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.85 }}>{it.detail}</div>
            </div>
          ))}
        </div>
      )}
    </LeCard>
  );
}

// ── Provider × stage summary ──────────────────────────────────────────────────

function ProviderSummarySection({ rows }: { rows: SystemStatusResponse["provider_summary"] }) {
  return (
    <LeCard>
      <SectionLabel label="Providers × stage (7d)" aside="Sorted by 7-day spend" />
      {rows.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--le-text-muted)",
            border: "1px dashed var(--le-border)",
            borderRadius: "var(--le-r-md)",
          }}
        >
          No API calls recorded in the last 7 days.
        </div>
      ) : (
        <>
          <div
            className="le-eyebrow"
            style={{
              display: "grid",
              gridTemplateColumns: "120px 140px 80px 90px 90px 90px 1fr",
              gap: "0 12px",
              padding: "0 4px 8px",
              borderBottom: "1px solid var(--le-border)",
            }}
          >
            <div>Provider</div>
            <div>Stage</div>
            <div style={{ textAlign: "right" }}>24h n</div>
            <div style={{ textAlign: "right" }}>24h $</div>
            <div style={{ textAlign: "right" }}>7d $</div>
            <div style={{ textAlign: "right" }}>Mean $</div>
            <div>Last call</div>
          </div>
          {rows.map((r) => (
            <div
              key={`${r.provider}|${r.stage}`}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 140px 80px 90px 90px 90px 1fr",
                gap: "0 12px",
                padding: "8px 4px",
                borderBottom: "1px solid var(--le-border)",
                fontSize: 12,
              }}
            >
              <div className="le-mono" style={{ fontWeight: 600, color: "var(--le-text)" }}>{r.provider}</div>
              <div style={{ color: "var(--le-text-muted)" }}>{r.stage}</div>
              <div className="le-mono" style={{ textAlign: "right" }}>{r.count_24h}</div>
              <div className="le-mono" style={{ textAlign: "right" }}>{fmtDollars(r.cost_cents_24h)}</div>
              <div className="le-mono" style={{ textAlign: "right" }}>{fmtDollars(r.cost_cents_7d)}</div>
              <div className="le-mono" style={{ textAlign: "right" }}>{fmtDollars(r.mean_cost_cents)}</div>
              <div style={{ color: "var(--le-text-muted)", fontSize: 11 }}>
                {r.last_at ? new Date(r.last_at).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </>
      )}
    </LeCard>
  );
}

// ── Queue depth ───────────────────────────────────────────────────────────────

function QueuesSection({ queues }: { queues: SystemStatusResponse["queues"] }) {
  return (
    <LeCard>
      <SectionLabel label="Queue depth" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
        <StatCard label="Judge pending" value={String(queues.judge_pending)} tone={queues.judge_pending > 20 ? "warn" : undefined} />
        <StatCard label="Judge errors 24h" value={String(queues.judge_errors_24h)} tone={queues.judge_errors_24h > 5 ? "warn" : undefined} />
        <StatCard label="Renders in-flight" value={String(queues.renders_pending)} />
        <StatCard label="Render orphans (>30m)" value={String(queues.renders_orphan_over_30m)} tone={queues.renders_orphan_over_30m > 0 ? "error" : undefined} />
      </div>
    </LeCard>
  );
}

// ── Affinity rules ────────────────────────────────────────────────────────────

function AffinitySection({ affinity }: { affinity: SkuAffinityResponse | null }) {
  if (!affinity) return null;
  return (
    <LeCard>
      <SectionLabel
        label="SKU × motion affinity"
        aside={affinity.recent_runs[0]
          ? `Last refreshed ${new Date(affinity.recent_runs[0].ran_at).toLocaleString()}`
          : undefined}
      />
      {affinity.rules.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--le-text-muted)",
            border: "1px dashed var(--le-border)",
            borderRadius: "var(--le-r-md)",
          }}
        >
          No rules yet. The refresh cron needs ≥5 ratings per (motion × SKU) to emit a rule.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {affinity.rules.map((r) => (
            <div
              key={r.camera_movement}
              style={{
                padding: "12px 16px",
                background: "var(--le-bg-sunken)",
                border: "1px solid var(--le-border)",
                borderRadius: "var(--le-r-md)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="le-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--le-text)" }}>
                  {r.camera_movement}
                </span>
                <StatusPill
                  tone={
                    r.confidence === "high_empirical" ? "success"
                    : r.confidence === "medium_empirical" ? "warn"
                    : "muted"
                  }
                >
                  {r.confidence}
                </StatusPill>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--le-text-muted)" }}>
                  refreshed {new Date(r.last_refreshed_at).toLocaleDateString()}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--le-text-muted)" }}>{r.reason}</div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
                {r.prefer.length > 0 && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--le-success-soft)",
                      color: "var(--le-success)",
                    }}
                  >
                    ✓ prefer: {r.prefer.join(", ")}
                  </span>
                )}
                {r.avoid.length > 0 && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--le-warn-soft)",
                      color: "var(--le-warn)",
                    }}
                  >
                    ⚠ avoid: {r.avoid.join(", ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </LeCard>
  );
}

// ── Feedback log ──────────────────────────────────────────────────────────────

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
    <LeCard>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <span className="le-eyebrow">Feedback log — last 100 iterations</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "rated", "tagged", "commented", "refined"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              style={{
                padding: "2px 10px",
                fontSize: 10,
                fontFamily: "var(--le-font-mono)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                border: "1px solid",
                borderRadius: 999,
                transition: "all 0.12s",
                background: filter === k ? "var(--le-accent)" : "transparent",
                color: filter === k ? "var(--le-accent-fg)" : "var(--le-text-muted)",
                borderColor: filter === k ? "var(--le-accent)" : "var(--le-border-strong)",
              }}
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
            color: "var(--le-text-muted)",
            border: "1px dashed var(--le-border)",
            borderRadius: "var(--le-r-md)",
          }}
        >
          No feedback matching filter.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {filtered.map((r) => (
            <div
              key={r.iteration_id}
              style={{
                padding: "8px 12px",
                background: "var(--le-bg-sunken)",
                border: "1px solid var(--le-border)",
                borderRadius: "var(--le-r-sm)",
                fontSize: 11,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="le-mono" style={{ fontSize: 10, color: "var(--le-text-muted)" }}>
                  {new Date(r.created_at).toLocaleString()}
                </span>
                {r.order_id && (
                  <Link
                    to={`/dashboard/dev/prompt-lab/${r.session_id ?? ""}`}
                    style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-muted)", textDecoration: "underline" }}
                    title="Open session"
                  >
                    {r.order_id}
                  </Link>
                )}
                {r.model_used && (
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "var(--le-bg-elev)",
                      fontFamily: "var(--le-font-mono)",
                      fontSize: 10,
                      color: "var(--le-text-muted)",
                    }}
                  >
                    {r.model_used}
                  </span>
                )}
                {r.rating != null && (
                  <span
                    style={{
                      fontWeight: 600,
                      color: r.rating >= 4 ? "var(--le-success)" : r.rating <= 2 ? "var(--le-danger)" : "var(--le-text-muted)",
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
                          borderRadius: 4,
                          background: "var(--le-bg-elev)",
                          fontSize: 10,
                          color: "var(--le-text-muted)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {r.user_comment && (
                <div style={{ marginTop: 4, color: "var(--le-text-muted)", lineHeight: 1.4 }}>
                  <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.6 }}>note: </span>
                  {r.user_comment}
                </div>
              )}
              {r.refinement_instruction && (
                <div style={{ marginTop: 4, color: "var(--le-text-muted)", lineHeight: 1.4 }}>
                  <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.6 }}>refine: </span>
                  {r.refinement_instruction}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </LeCard>
  );
}

// ── Live API-call feed ────────────────────────────────────────────────────────

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
    <LeCard>
      <SectionLabel label="Live feed — last 100 API calls" aside="Click any row to expand" />
      {events.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--le-text-muted)",
            border: "1px dashed var(--le-border)",
            borderRadius: "var(--le-r-md)",
          }}
        >
          No recent API calls.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {events.map((e) => {
            const isOpen = expanded.has(e.id);
            const iterationId = (e.metadata?.iteration_id ?? e.metadata?.session_id ?? null) as string | null;
            return (
              <div
                key={e.id}
                style={{
                  border: "1px solid var(--le-border)",
                  borderRadius: "var(--le-r-sm)",
                  overflow: "hidden",
                  background: "var(--le-bg-sunken)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 90px 110px 90px 1fr 20px",
                    alignItems: "center",
                    gap: "0 12px",
                    width: "100%",
                    padding: "6px 12px",
                    textAlign: "left",
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                    fontSize: 11,
                    color: "var(--le-text)",
                  }}
                >
                  <span className="le-mono" style={{ color: "var(--le-text-muted)" }}>{fmtTime(e.created_at)}</span>
                  <span className="le-mono" style={{ fontWeight: 600 }}>{e.provider}</span>
                  <span style={{ color: "var(--le-text-muted)" }}>{e.stage}</span>
                  <span className="le-mono" style={{ textAlign: "right", fontWeight: 600 }}>{fmtDollars(e.cost_cents ?? 0)}</span>
                  <span style={{ color: "var(--le-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {metadataSummary(e.metadata)}
                  </span>
                  <ChevronDown
                    style={{
                      width: 12,
                      height: 12,
                      color: "var(--le-text-muted)",
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 0.15s",
                    }}
                  />
                </button>
                {isOpen && (
                  <div
                    style={{
                      borderTop: "1px solid var(--le-border)",
                      padding: "12px",
                      fontSize: 11,
                    }}
                  >
                    <div
                      className="le-mono"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "2px 16px",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: "var(--le-text-muted)" }}>units:</span>
                      <span>{e.units_consumed ?? "—"} {e.unit_type ?? ""}</span>
                      <span style={{ color: "var(--le-text-muted)" }}>cost:</span>
                      <span>{fmtDollars(e.cost_cents ?? 0)}</span>
                    </div>
                    {iterationId && (
                      <div style={{ marginTop: 8 }}>
                        <Link
                          to={`/dashboard/dev/prompt-lab/${iterationId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 11,
                            color: "var(--le-text-muted)",
                            textDecoration: "underline",
                          }}
                        >
                          Open iteration <ExternalLink style={{ width: 10, height: 10 }} />
                        </Link>
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: "var(--le-text-muted)", marginBottom: 4 }}>metadata:</div>
                      <pre
                        className="le-mono"
                        style={{
                          fontSize: 10,
                          lineHeight: 1.6,
                          overflowX: "auto",
                          padding: "8px 10px",
                          background: "var(--le-bg-elev)",
                          borderRadius: "var(--le-r-sm)",
                          color: "var(--le-text-muted)",
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
    </LeCard>
  );
}

// ── Pipeline logs panel (merged from Logs.tsx) ────────────────────────────────

function PipelineLogsPanel() {
  const [open, setOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<(PipelineLog & { properties?: { address: string } })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only fetch when the panel is first opened
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const params: { limit: number; stage?: string; level?: string } = { limit: 500 };
        if (stageFilter !== "all") params.stage = stageFilter;
        if (levelFilter !== "all") params.level = levelFilter;
        const res = await fetchLogs(params);
        if (cancelled) return;
        setLogs(res.logs);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load logs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, stageFilter, levelFilter]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = search
    ? logs.filter((l) => l.message.toLowerCase().includes(search.toLowerCase()))
    : logs;

  const getAddress = (log: PipelineLog & { properties?: { address: string } }) =>
    log.properties?.address?.split(",")[0] || "Unknown";

  const exportCSV = () => {
    const header = "Timestamp,Property,Stage,Level,Message\n";
    const rows = filtered
      .map((l) => `"${l.created_at}","${getAddress(l)}","${l.stage}","${l.level}","${l.message}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pipeline-logs.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const levelPillTone = (level: string): "danger" | "warn" | "muted" => {
    if (level === "error") return "danger";
    if (level === "warn") return "warn";
    return "muted";
  };

  return (
    <LeCard>
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
        }}
      >
        {open
          ? <ChevronDown style={{ width: 14, height: 14, color: "var(--le-text-muted)", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 14, height: 14, color: "var(--le-text-muted)", flexShrink: 0 }} />}
        <span className="le-eyebrow" style={{ flex: 1 }}>Pipeline logs</span>
        {!open && (
          <span style={{ fontSize: 11, color: "var(--le-text-muted)" }}>
            500-row tail — click to expand
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Filters row */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {/* Search */}
            <div style={{ position: "relative", minWidth: 240, flex: 1 }}>
              <Search
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 14,
                  height: 14,
                  color: "var(--le-text-muted)",
                  pointerEvents: "none",
                }}
              />
              <Input
                placeholder="Search log messages…"
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 12 }}
              />
            </div>
            {/* Stage select */}
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger style={{ width: 160, fontSize: 12 }}>
                <SelectValue placeholder="All stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {(["intake", "analysis", "scripting", "generation", "qc", "assembly", "delivery"] as PipelineStage[]).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Level select */}
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger style={{ width: 140, fontSize: 12 }}>
                <SelectValue placeholder="All levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {(["info", "warn", "error", "debug"] as LogLevel[]).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Autoscroll toggle */}
            <GhostBtn small onClick={() => setAutoScroll((v) => !v)}>
              {autoScroll
                ? <Pause style={{ width: 12, height: 12 }} />
                : <Play style={{ width: 12, height: 12 }} />}
              {autoScroll ? "Pause scroll" : "Resume scroll"}
            </GhostBtn>
            {/* CSV export */}
            <GhostBtn small onClick={exportCSV}>
              <Download style={{ width: 12, height: 12 }} />
              Export CSV
            </GhostBtn>
          </div>

          {/* Log feed */}
          <div
            style={{
              border: "1px solid var(--le-border)",
              borderRadius: "var(--le-r-md)",
              background: "var(--le-bg-sunken)",
              overflow: "hidden",
            }}
          >
            <div
              ref={scrollRef}
              className="le-scroll"
              style={{ maxHeight: 480, overflowY: "auto" }}
            >
              {loading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
                  <Loader2 style={{ width: 20, height: 20, color: "var(--le-text-muted)" }} className="animate-spin" />
                </div>
              ) : error ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, fontSize: 13, color: "var(--le-danger)" }}>
                  {error}
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, fontSize: 13, color: "var(--le-text-muted)" }}>
                  No logs match your filters.
                </div>
              ) : (
                <div>
                  {filtered.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px 130px 90px auto 1fr",
                        alignItems: "start",
                        gap: "0 12px",
                        padding: "6px 14px",
                        borderBottom: "1px solid var(--le-border)",
                        fontSize: 11,
                        fontFamily: "var(--le-font-mono)",
                      }}
                    >
                      <span style={{ color: "var(--le-text-faint)" }}>
                        {new Date(log.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span style={{ color: "var(--le-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getAddress(log)}
                      </span>
                      <span className="le-eyebrow">{log.stage}</span>
                      <StatusPill tone={levelPillTone(log.level)}>{log.level}</StatusPill>
                      <span
                        style={{
                          color:
                            log.level === "error" ? "var(--le-danger)"
                            : log.level === "warn" ? "var(--le-warn)"
                            : "var(--le-text)",
                          lineHeight: 1.4,
                        }}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row count */}
          {!loading && !error && (
            <div style={{ fontSize: 11, color: "var(--le-text-muted)" }}>
              {filtered.length} row{filtered.length !== 1 ? "s" : ""} shown
              {filtered.length !== logs.length && ` (${logs.length} total after server filter)`}
            </div>
          )}
        </div>
      )}
    </LeCard>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  if (cents >= 10000) return `$${(cents / 100).toFixed(0)}`;
  if (cents >= 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(3)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
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
