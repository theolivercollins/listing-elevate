import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeading } from "@/components/dashboard/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtCents } from "@/components/dashboard/primitives";
// ── Types ──────────────────────────────────────────────────────────────────
interface RendersRow {
  outcome_id: string;
  pair_label_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  photo_a_url: string;
  photo_b_url: string;
  video_url: string | null;
  status: string;
  judge_score: number | null;
  judge_reasoning: string | null;
  cost_cents: number;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

// ── authedFetch helper ─────────────────────────────────────────────────────
async function authedFetch<T>(path: string): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(path, { headers });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body as T;
}

// ── Status badge ───────────────────────────────────────────────────────────
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  submitted: "secondary",
  polling: "secondary",
  rendered: "default",
  judged: "default",
  completed: "default",
  failed: "destructive",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className="capitalize text-xs">
      {status}
    </Badge>
  );
}

// ── Judge score pill ───────────────────────────────────────────────────────
function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-[var(--muted)]">—</span>;
  const label = score.toFixed(2);
  if (score >= 0.85) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        {label}
      </span>
    );
  }
  if (score >= 0.6) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      {label}
    </span>
  );
}

// ── Multi-take attempts parser ─────────────────────────────────────────────
interface TakeAttempt {
  videoUrl: string;
  lineVariance: number;
  turbulence: number;
  passed: boolean;
}

function parseAttempts(judgeReasoning: string | null): TakeAttempt[] | null {
  if (!judgeReasoning) return null;
  try {
    const parsed = JSON.parse(judgeReasoning);
    if (Array.isArray(parsed) && parsed.length > 0 && "passed" in parsed[0]) {
      return parsed as TakeAttempt[];
    }
  } catch {
    // not JSON — plain reasoning text
  }
  return null;
}

function AttemptsList({ attempts }: { attempts: TakeAttempt[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {attempts.map((a, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium cursor-default ${
                a.passed
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              Take {i + 1} {a.passed ? "✓" : "✗"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[200px]">
            {a.passed
              ? "Passed guardrail"
              : `line Δ ${a.lineVariance?.toFixed(1) ?? "?"}° · turbulence ${a.turbulence?.toFixed(2) ?? "?"}`}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function V21Renders() {
  const listingId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("listingId") ?? ""
      : "";

  const [rows, setRows] = useState<RendersRow[] | null>(null);
  const [totalCostCents, setTotalCostCents] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!listingId) return;
    setLoading(true);
    setError(null);
    authedFetch<{ rows: RendersRow[]; total_cost_cents: number }>(
      `/api/gen2/lab/renders?listingId=${encodeURIComponent(listingId)}`
    )
      .then(({ rows: r, total_cost_cents }) => {
        setRows(r);
        setTotalCostCents(total_cost_cents);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [listingId]);

  return (
    <div className="le-fade-up flex flex-col gap-6">
      <PageHeading
        eyebrow="Lab · V2 Renders"
        title="V2 Render Outcomes"
        sub="Kling 3 Omni clips generated from confirmed pairs, with judge scores and attempt history."
      />

      {/* Back link */}
      <div>
        <Link
          to={listingId ? `/dashboard/development/lab/v21?listingId=${listingId}` : "/dashboard/development/lab/v21"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          <ArrowLeft style={{ width: 11, height: 11 }} />
          Back to V2 Lab
        </Link>
      </div>

      {/* Total cost summary */}
      {rows && rows.length > 0 && (
        <Card className="border-[var(--line)] bg-[var(--surface)]">
          <CardContent className="p-5 flex items-center gap-6">
            <div>
              <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
                Total renders
              </div>
              <div className="text-2xl font-semibold text-[var(--ink)] tabular-nums">
                {rows.length}
              </div>
            </div>
            <div className="w-px h-8 bg-[var(--line)]" />
            <div>
              <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
                Total cost
              </div>
              <div className="text-2xl font-semibold text-[var(--ink)] tabular-nums">
                {fmtCents(totalCostCents)}
              </div>
            </div>
            <div className="w-px h-8 bg-[var(--line)]" />
            <div>
              <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
                Judged
              </div>
              <div className="text-2xl font-semibold text-[var(--ink)] tabular-nums">
                {rows.filter((r) => r.judge_score !== null).length}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl border border-[rgba(196,74,74,0.18)] bg-[rgba(196,74,74,0.07)] text-sm text-[var(--bad)]">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-[var(--muted)] py-8">
          <svg className="animate-spin" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
          Loading renders…
        </div>
      )}

      {/* Empty state */}
      {!loading && rows !== null && rows.length === 0 && (
        <Card className="border-[var(--line)] bg-[var(--surface)]">
          <CardContent className="p-10 text-center text-sm text-[var(--muted)]">
            No V2 renders yet for this listing. Confirm a pair in Director&apos;s Cut to render.
          </CardContent>
        </Card>
      )}

      {/* Missing listingId */}
      {!listingId && (
        <Card className="border-[var(--line)] bg-[var(--surface)]">
          <CardContent className="p-10 text-center text-sm text-[var(--muted)]">
            No listing selected. Add <code className="text-xs">?listingId=X</code> to the URL.
          </CardContent>
        </Card>
      )}

      {/* Render rows */}
      {!loading && rows && rows.length > 0 && (
        <div className="flex flex-col gap-4">
          {rows.map((row) => {
            const attempts = parseAttempts(row.judge_reasoning);
            const isAttemptJson = attempts !== null;
            const reasoningText = isAttemptJson ? null : row.judge_reasoning;
            const truncatedReasoning =
              reasoningText && reasoningText.length > 200
                ? reasoningText.slice(0, 200) + "…"
                : reasoningText;

            return (
              <Card key={row.outcome_id} className="border-[var(--line)] bg-[var(--surface)]">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:gap-6">
                    {/* Photo pair */}
                    <div className="flex gap-3 shrink-0">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-24 h-16 rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--bg)]">
                          {row.photo_a_url ? (
                            <img
                              src={row.photo_a_url}
                              alt="Start frame"
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-[var(--muted)]">
                              A
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-[var(--muted)]">Start</span>
                      </div>
                      <div className="flex items-center text-[var(--muted)] self-center mb-5">
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-24 h-16 rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--bg)]">
                          {row.photo_b_url ? (
                            <img
                              src={row.photo_b_url}
                              alt="End frame"
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xs text-[var(--muted)]">
                              B
                            </div>
                          )}
                        </div>
                        <span className="text-xs text-[var(--muted)]">End</span>
                      </div>
                    </div>

                    {/* Video */}
                    <div className="shrink-0">
                      {row.video_url ? (
                        <video
                          src={row.video_url}
                          controls
                          preload="metadata"
                          className="w-48 h-28 rounded-lg border border-[var(--line)] bg-black object-contain"
                        />
                      ) : (
                        <div className="w-48 h-28 rounded-lg border border-[var(--line)] bg-[var(--bg)] flex items-center justify-center text-xs text-[var(--muted)]">
                          {["pending", "submitted", "polling"].includes(row.status)
                            ? "Rendering…"
                            : "No video"}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="flex-1 flex flex-col gap-3">
                      {/* Status + score */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <StatusBadge status={row.status} />
                        <ScorePill score={row.judge_score} />
                        <span className="text-xs text-[var(--muted)]">
                          {fmtCents(row.cost_cents)}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {new Date(row.created_at).toLocaleDateString()}{" "}
                          {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>

                      {/* Multi-take attempts */}
                      {attempts && attempts.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-[var(--muted)] mb-1">
                            Attempts ({attempts.length})
                          </div>
                          <AttemptsList attempts={attempts} />
                        </div>
                      )}

                      {/* Single attempt count fallback */}
                      {!attempts && row.retry_count > 0 && (
                        <div className="text-xs text-[var(--muted)]">
                          Retries: {row.retry_count}
                        </div>
                      )}

                      {/* Judge reasoning text */}
                      {truncatedReasoning && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="text-xs text-[var(--muted-2)] cursor-default line-clamp-2">
                              {truncatedReasoning}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-xs">
                            {row.judge_reasoning}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
