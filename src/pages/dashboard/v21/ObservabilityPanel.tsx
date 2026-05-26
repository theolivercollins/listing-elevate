// ObservabilityPanel.tsx — V2 Lab: live observability sidebar
// Polls /api/gen2/lab/observability every 5 seconds.
// Can also be refreshed imperatively via the `refresh()` handle (forwardRef).

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LabMode, ModeState } from "../../../../lib/gen2-v21/types.js";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

// ─── API response shape ───────────────────────────────────────────────────────

interface RollingAccuracy {
  last_20: number | null;
  last_50: number | null;
  last_100: number | null;
}

interface FeatureWeight {
  name: string;
  weight: number;
}

interface ApprenticeAgreement {
  rolling_20: number | null;
  rolling_50: number | null;
}

interface HeldOutEval {
  accuracy: number;
  evaluated_at: string;
  label_count: number;
}

interface ObservabilityData {
  mode_state: ModeState;
  total_labels: number;
  labels_by_property: Record<string, number>;
  rolling_accuracy: RollingAccuracy;
  top_3_feature_weights: FeatureWeight[];
  apprentice_agreement: ApprenticeAgreement | null;
  model_id: string | null;
  label_count_at_train: number | null;
  held_out_eval: HeldOutEval | null;
}

// ─── public handle ────────────────────────────────────────────────────────────

export interface ObservabilityPanelHandle {
  refresh: () => void;
}

// ─── props ────────────────────────────────────────────────────────────────────

interface ObservabilityPanelProps {
  listingId: string | null; // null = global
  onSwitchMode?: (mode: LabMode) => void;
}

// ─── mode helpers ─────────────────────────────────────────────────────────────

const MODE_LABEL: Record<LabMode, string> = {
  directors_cut: "Director's Cut",
  apprentice_review: "Apprentice Review",
  autopilot: "Autopilot",
};

function modeBadgeColors(mode: LabMode): { bg: string; color: string } {
  if (mode === "directors_cut") {
    return { bg: "rgba(42,111,219,0.1)", color: "var(--accent, #2a6fdb)" };
  }
  if (mode === "apprentice_review") {
    return { bg: "rgba(182,128,44,0.1)", color: "var(--warn, #b6802c)" };
  }
  return { bg: "rgba(47,138,85,0.1)", color: "var(--good, #2f8a55)" };
}

// ─── small helpers ────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v === null) return "—";
  return Math.round(v * 100) + "%";
}

function accuracyColor(v: number | null): string {
  if (v === null) return "var(--muted)";
  if (v >= 0.85) return "var(--good, #2f8a55)";
  if (v >= 0.7) return "var(--warn, #b6802c)";
  return "var(--bad, #c44a4a)";
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

// ─── AccuracySparkline ────────────────────────────────────────────────────────

function AccuracySparkline({ values }: { values: Array<number | null> }) {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  const max = Math.max(...valid, 0.01);
  return (
    <div className="flex items-end gap-0.5 h-4">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm transition-all duration-300"
          style={{
            height: v !== null ? Math.max(3, Math.round((v / max) * 16)) : 3,
            background: v !== null ? "var(--accent)" : "var(--line)",
          }}
        />
      ))}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

const ObservabilityPanel = forwardRef<ObservabilityPanelHandle, ObservabilityPanelProps>(
  function ObservabilityPanel({ listingId, onSwitchMode }, ref) {
    const [data, setData] = useState<ObservabilityData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchData = useCallback(async () => {
      const param = listingId
        ? `listing_id=${encodeURIComponent(listingId)}`
        : "listing_id=global";
      try {
        const res = await fetch(`/api/gen2/lab/observability?${param}`);
        if (!res.ok) throw new Error(`observability ${res.status}`);
        const json = (await res.json()) as ObservabilityData;
        setData(json);
        setLastFetched(new Date());
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, [listingId]);

    useImperativeHandle(ref, () => ({ refresh: fetchData }), [fetchData]);

    useEffect(() => {
      fetchData();
      timerRef.current = setInterval(fetchData, 5000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [fetchData]);

    if (loading && !data) {
      return (
        <Card className="border-[var(--line)] bg-[var(--surface)]">
          <CardContent className="p-5 flex flex-col gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      );
    }

    if (error && !data) {
      return (
        <Card className="border-[rgba(196,74,74,0.3)] bg-[rgba(196,74,74,0.03)]">
          <CardContent className="p-4 text-sm text-[var(--bad)]">
            {error}
          </CardContent>
        </Card>
      );
    }

    if (!data) return null;

    const {
      mode_state,
      total_labels,
      labels_by_property,
      rolling_accuracy,
      top_3_feature_weights,
      apprentice_agreement,
      model_id,
      label_count_at_train,
      held_out_eval,
    } = data;

    const currentMode = mode_state.current_mode;
    const recommendedMode = mode_state.recommended_mode;
    const showSwitch = currentMode !== recommendedMode;
    const coldStart = total_labels < 10;
    const showApprentice =
      mode_state.apprentice_agreement_rate !== null &&
      mode_state.apprentice_agreement_rate !== undefined &&
      apprentice_agreement !== null;

    const currentColors = modeBadgeColors(currentMode);
    const recommendedColors = modeBadgeColors(recommendedMode);

    return (
      <Card className="border-[var(--line)] bg-[var(--surface)] min-w-[220px]">
        {/* Header */}
        <CardHeader className="px-4 pt-4 pb-0 flex-row items-center justify-between space-y-0">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
            Observability
          </span>
          <div className="flex items-center gap-2">
            {loading && (
              <svg className="animate-spin text-[var(--muted)]" width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full"
              onClick={fetchData}
              title="Refresh now"
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-4 pb-4 pt-4 flex flex-col gap-4">

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[rgba(196,74,74,0.05)] text-[11px] text-[var(--bad)]">
              {error}
            </div>
          )}

          {/* 1. Mode */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Mode</div>
            <Badge
              className="self-start text-[11px] font-bold gap-1.5"
              style={{ background: currentColors.bg, color: currentColors.color, border: "none" }}
            >
              {MODE_LABEL[currentMode]}
            </Badge>
            {showSwitch && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10.5px] text-[var(--muted)]">Recommended:</span>
                <Badge
                  className="text-[10px] font-bold"
                  style={{ background: recommendedColors.bg, color: recommendedColors.color, border: "none" }}
                >
                  {MODE_LABEL[recommendedMode]}
                </Badge>
                {onSwitchMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2 gap-1 rounded-xl"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                    onClick={() => onSwitchMode(recommendedMode)}
                  >
                    Switch
                    <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </Button>
                )}
              </div>
            )}
          </div>

          <Separator className="bg-[var(--line)]" />

          {/* 2. Total labels */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Total labels</div>
            <div className="text-2xl font-bold tabular-nums tracking-tight text-[var(--ink)] leading-none">
              {total_labels.toLocaleString()}
            </div>
            {Object.keys(labels_by_property).length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1">
                {Object.entries(labels_by_property)
                  .slice(0, 5)
                  .map(([prop, count]) => (
                    <div key={prop} className="flex justify-between items-center gap-2">
                      <span className="text-[10px] text-[var(--muted)] truncate max-w-[120px]">
                        {prop}
                      </span>
                      <span className="text-[11px] tabular-nums text-[var(--ink-2)] flex-shrink-0">
                        {count}
                      </span>
                    </div>
                  ))}
                {Object.keys(labels_by_property).length > 5 && (
                  <div className="text-[10px] text-[var(--muted)]">
                    +{Object.keys(labels_by_property).length - 5} more properties
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator className="bg-[var(--line)]" />

          {/* 3. Rolling accuracy */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Rolling accuracy</div>
              <AccuracySparkline
                values={[rolling_accuracy.last_20, rolling_accuracy.last_50, rolling_accuracy.last_100]}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { label: "Last 20", value: rolling_accuracy.last_20 },
                  { label: "Last 50", value: rolling_accuracy.last_50 },
                  { label: "Last 100", value: rolling_accuracy.last_100 },
                ] as Array<{ label: string; value: number | null }>
              ).map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <div className="text-[10px] text-[var(--muted)]">{label}</div>
                  <div
                    className="text-sm font-bold tabular-nums leading-none"
                    style={{ color: accuracyColor(value) }}
                  >
                    {pct(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Top-3 feature weights */}
          {top_3_feature_weights.length > 0 && (
            <>
              <Separator className="bg-[var(--line)]" />
              <div className="flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                  Top feature weights
                </div>
                <div className="flex flex-col gap-2">
                  {top_3_feature_weights.map((f, i) => {
                    const max = top_3_feature_weights[0]?.weight ?? 1;
                    const pctFill = max > 0 ? Math.min(100, Math.round((f.weight / max) * 100)) : 0;
                    return (
                      <div key={f.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--muted)] w-3.5 text-right flex-shrink-0 tabular-nums">
                          {i + 1}
                        </span>
                        <span className="text-[10px] text-[var(--ink-2)] w-24 flex-shrink-0 truncate">
                          {f.name.replace(/_/g, " ")}
                        </span>
                        <Progress value={pctFill} className="flex-1 h-1" />
                        <span className="text-[10px] text-[var(--muted)] tabular-nums w-5 text-right flex-shrink-0">
                          {Math.round(f.weight * 100)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* 5. Apprentice agreement */}
          {showApprentice && apprentice_agreement && (
            <>
              <Separator className="bg-[var(--line)]" />
              <div className="flex flex-col gap-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                  Apprentice agreement
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { label: "Last 20", value: apprentice_agreement.rolling_20 },
                      { label: "Last 50", value: apprentice_agreement.rolling_50 },
                    ] as Array<{ label: string; value: number | null }>
                  ).map(({ label, value }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <div className="text-[10px] text-[var(--muted)]">{label}</div>
                      <div
                        className="text-sm font-bold tabular-nums leading-none"
                        style={{
                          color:
                            value === null
                              ? "var(--muted)"
                              : value >= 0.9
                              ? "var(--good)"
                              : value >= 0.7
                              ? "var(--warn)"
                              : "var(--bad)",
                        }}
                      >
                        {pct(value)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-[var(--muted)] leading-relaxed">
                  ≥90% rolling 50 unlocks Autopilot
                </div>
              </div>
            </>
          )}

          <Separator className="bg-[var(--line)]" />

          {/* 6. Model status */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Model status</div>
            {coldStart ? (
              <div
                className="px-3 py-2.5 rounded-xl text-xs leading-relaxed"
                style={{ background: "rgba(182,128,44,0.07)", border: "1px solid rgba(182,128,44,0.2)", color: "var(--warn)" }}
              >
                <span className="font-semibold">Heuristic active.</span>{" "}
                {10 - total_labels} more label{10 - total_labels === 1 ? "" : "s"} until LightGBM takes over.
                <Progress
                  value={Math.round((total_labels / 10) * 100)}
                  className="mt-2 h-1"
                  style={{ "--progress-color": "var(--warn)" } as React.CSSProperties}
                />
                <div className="mt-1 text-[10px] tabular-nums">
                  {total_labels} / 10
                </div>
              </div>
            ) : (
              <div
                className="px-3 py-2.5 rounded-xl text-xs leading-relaxed"
                style={{ background: "rgba(47,138,85,0.07)", border: "1px solid rgba(47,138,85,0.2)", color: "var(--good)" }}
              >
                <span className="font-semibold">LightGBM active</span>
                {model_id && (
                  <span className="ml-1 font-normal text-[var(--muted)] text-[10px]">
                    (model {model_id.slice(0, 8)})
                  </span>
                )}
                {label_count_at_train !== null && (
                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                    Trained on {label_count_at_train.toLocaleString()} labels
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 7. Held-out eval */}
          {held_out_eval ? (
            <>
              <Separator className="bg-[var(--line)]" />
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                  Held-out eval
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-xl font-bold tabular-nums tracking-tight leading-none"
                    style={{ color: accuracyColor(held_out_eval.accuracy) }}
                  >
                    {pct(held_out_eval.accuracy)}
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">accuracy</span>
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  {fmtTs(held_out_eval.evaluated_at)} · {held_out_eval.label_count.toLocaleString()} labels
                </div>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[var(--muted)]">Held-out eval: not yet run</div>
          )}

          {/* Last-fetched */}
          {lastFetched && (
            <div className="text-[10px] text-[var(--muted)] text-right -mt-2">
              Updated {lastFetched.toLocaleTimeString()}
            </div>
          )}
        </CardContent>
      </Card>
    );
  },
);

export default ObservabilityPanel;
export type { ObservabilityPanelHandle, ObservabilityPanelProps };
