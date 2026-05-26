// ObservabilityPanel.tsx — V2.1 Lab: live observability sidebar
// Polls /api/gen2/lab/observability every 5 seconds.
// Can also be refreshed imperatively via the `refresh()` handle (forwardRef).
// No charting library — pure inline-div bars and sparklines.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { LabMode, ModeState } from "../../../../lib/gen2-v21/types.js";

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

// ─── style constants ──────────────────────────────────────────────────────────

const SECTION: React.CSSProperties = {
  paddingBottom: 14,
  borderBottom: "1px solid var(--line)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase" as const,
  color: "var(--muted)",
  fontFamily: "var(--le-font-sans)",
};

const BIG_NUMBER: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  letterSpacing: "-0.03em",
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
  lineHeight: 1,
  fontFamily: "var(--le-font-sans)",
};

const SMALL_STAT_LABEL: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--muted)",
  fontFamily: "var(--le-font-sans)",
  lineHeight: 1,
};

const SMALL_STAT_VALUE: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink)",
  letterSpacing: "-0.02em",
  fontFamily: "var(--le-font-sans)",
};

const MODE_BADGE_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 10px",
  borderRadius: 99,
  fontSize: 11.5,
  fontWeight: 700,
  fontFamily: "var(--le-font-sans)",
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
};

const SWITCH_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "5px 11px",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--accent, #4f6ef7)",
  background: "transparent",
  color: "var(--accent, #4f6ef7)",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const GHOST_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--muted)",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

// ─── mode helpers ─────────────────────────────────────────────────────────────

const MODE_LABEL: Record<LabMode, string> = {
  directors_cut: "Director's Cut",
  apprentice_review: "Apprentice Review",
  autopilot: "Autopilot",
};

function modeBadgeStyle(mode: LabMode): React.CSSProperties {
  if (mode === "directors_cut") {
    return { ...MODE_BADGE_BASE, background: "rgba(79,110,247,0.1)", color: "var(--accent, #4f6ef7)" };
  }
  if (mode === "apprentice_review") {
    return { ...MODE_BADGE_BASE, background: "rgba(182,128,44,0.1)", color: "var(--warn, #b6802c)" };
  }
  return { ...MODE_BADGE_BASE, background: "rgba(47,138,85,0.1)", color: "var(--good, #2f8a55)" };
}

// ─── small helpers ────────────────────────────────────────────────────────────

function pct(v: number | null): string {
  if (v === null) return "—";
  return Math.round(v * 100) + "%";
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

// ─── sub-components ───────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth={2}
      strokeLinecap="round"
      style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pctFill = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: 5, background: "var(--line)", borderRadius: 99, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${pctFill}%`,
          background: color ?? "var(--accent, #4f6ef7)",
          borderRadius: 99,
          transition: "width .4s ease",
        }}
      />
    </div>
  );
}

// CSS-only sparkline — 3 bars with height proportional to each accuracy window
function AccuracySparkline({ values }: { values: Array<number | null> }) {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  const max = Math.max(...valid, 0.01);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 18 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: v !== null ? Math.max(3, Math.round((v / max) * 18)) : 3,
            borderRadius: 2,
            background: v !== null ? "var(--accent, #4f6ef7)" : "var(--line)",
            transition: "height .3s ease",
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
        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--radius)",
            border: "1px solid var(--line)",
            padding: "20px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Spinner />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading observability…</span>
        </div>
      );
    }

    if (error && !data) {
      return (
        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--radius)",
            border: "1px solid rgba(196,74,74,0.3)",
            padding: "16px",
            fontSize: 12.5,
            color: "var(--bad, #c44a4a)",
          }}
        >
          {error}
        </div>
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

    return (
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--line)",
          padding: "16px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          fontFamily: "var(--le-font-sans)",
          minWidth: 220,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              color: "var(--muted)",
            }}
          >
            Observability
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {loading && <Spinner size={12} />}
            <button type="button" style={GHOST_BTN} onClick={fetchData} title="Refresh now">
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              background: "rgba(196,74,74,0.05)",
              fontSize: 11.5,
              color: "var(--bad, #c44a4a)",
            }}
          >
            {error}
          </div>
        )}

        {/* 1. Mode */}
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Mode</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={modeBadgeStyle(currentMode)}>{MODE_LABEL[currentMode]}</span>
          </div>
          {showSwitch && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Recommended:</span>
              <span style={{ ...modeBadgeStyle(recommendedMode), fontSize: 10.5, padding: "2px 8px" }}>
                {MODE_LABEL[recommendedMode]}
              </span>
              {onSwitchMode && (
                <button type="button" style={SWITCH_BTN} onClick={() => onSwitchMode(recommendedMode)}>
                  Switch
                  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 2. Total labels */}
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Total labels</div>
          <div style={BIG_NUMBER}>{total_labels.toLocaleString()}</div>
          {Object.keys(labels_by_property).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
              {Object.entries(labels_by_property)
                .slice(0, 5)
                .map(([prop, count]) => (
                  <div key={prop} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 120,
                      }}
                    >
                      {prop}
                    </span>
                    <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: "var(--ink-2)", flexShrink: 0 }}>
                      {count}
                    </span>
                  </div>
                ))}
              {Object.keys(labels_by_property).length > 5 && (
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                  +{Object.keys(labels_by_property).length - 5} more properties
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Rolling accuracy + sparkline */}
        <div style={SECTION}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={SECTION_LABEL}>Rolling accuracy</div>
            <AccuracySparkline
              values={[rolling_accuracy.last_20, rolling_accuracy.last_50, rolling_accuracy.last_100]}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {(
              [
                { label: "Last 20", value: rolling_accuracy.last_20 },
                { label: "Last 50", value: rolling_accuracy.last_50 },
                { label: "Last 100", value: rolling_accuracy.last_100 },
              ] as Array<{ label: string; value: number | null }>
            ).map(({ label, value }) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={SMALL_STAT_LABEL}>{label}</div>
                <div
                  style={{
                    ...SMALL_STAT_VALUE,
                    color:
                      value === null
                        ? "var(--muted)"
                        : value >= 0.85
                        ? "var(--good, #2f8a55)"
                        : value >= 0.7
                        ? "var(--warn, #b6802c)"
                        : "var(--bad, #c44a4a)",
                  }}
                >
                  {pct(value)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Top-3 feature weights */}
        {top_3_feature_weights.length > 0 && (
          <div style={SECTION}>
            <div style={SECTION_LABEL}>Top feature weights</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {top_3_feature_weights.map((f, i) => {
                const max = top_3_feature_weights[0]?.weight ?? 1;
                return (
                  <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        width: 14,
                        textAlign: "right",
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {i + 1}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--ink-2)",
                        width: 110,
                        flexShrink: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name.replace(/_/g, " ")}
                    </span>
                    <Bar value={f.weight} max={max} />
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--muted)",
                        fontVariantNumeric: "tabular-nums",
                        width: 26,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {Math.round(f.weight * 100)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. Apprentice agreement rate (only when apprentice active) */}
        {showApprentice && apprentice_agreement && (
          <div style={SECTION}>
            <div style={SECTION_LABEL}>Apprentice agreement</div>
            <div style={{ display: "flex", gap: 16 }}>
              {(
                [
                  { label: "Last 20", value: apprentice_agreement.rolling_20 },
                  { label: "Last 50", value: apprentice_agreement.rolling_50 },
                ] as Array<{ label: string; value: number | null }>
              ).map(({ label, value }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={SMALL_STAT_LABEL}>{label}</div>
                  <div
                    style={{
                      ...SMALL_STAT_VALUE,
                      color:
                        value === null
                          ? "var(--muted)"
                          : value >= 0.9
                          ? "var(--good, #2f8a55)"
                          : value >= 0.7
                          ? "var(--warn, #b6802c)"
                          : "var(--bad, #c44a4a)",
                    }}
                  >
                    {pct(value)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", lineHeight: 1.4 }}>
              ≥90% rolling 50 unlocks Autopilot
            </div>
          </div>
        )}

        {/* 6. Cold-start indicator */}
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Model status</div>
          {coldStart ? (
            <div
              style={{
                padding: "9px 11px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(182,128,44,0.07)",
                border: "1px solid rgba(182,128,44,0.2)",
                fontSize: 12,
                color: "var(--warn, #b6802c)",
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontWeight: 600 }}>Heuristic active.</span>{" "}
              {10 - total_labels} more label{10 - total_labels === 1 ? "" : "s"} until LightGBM takes over.
              <div
                style={{
                  marginTop: 8,
                  height: 4,
                  background: "rgba(182,128,44,0.15)",
                  borderRadius: 99,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round((total_labels / 10) * 100)}%`,
                    background: "var(--warn, #b6802c)",
                    borderRadius: 99,
                    transition: "width .4s ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 4, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
                {total_labels} / 10
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: "9px 11px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(47,138,85,0.07)",
                border: "1px solid rgba(47,138,85,0.2)",
                fontSize: 12,
                color: "var(--good, #2f8a55)",
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontWeight: 600 }}>LightGBM active</span>
              {model_id && (
                <span style={{ marginLeft: 4, fontWeight: 400, color: "var(--muted)", fontSize: 10.5 }}>
                  (model {model_id.slice(0, 8)})
                </span>
              )}
              {label_count_at_train !== null && (
                <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--muted)" }}>
                  Trained on {label_count_at_train.toLocaleString()} labels
                </div>
              )}
            </div>
          )}
        </div>

        {/* 7. Held-out eval */}
        {held_out_eval ? (
          <div style={{ ...SECTION, borderBottom: "none", paddingBottom: 0 }}>
            <div style={SECTION_LABEL}>Held-out eval</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  ...BIG_NUMBER,
                  fontSize: 22,
                  color:
                    held_out_eval.accuracy >= 0.85
                      ? "var(--good, #2f8a55)"
                      : held_out_eval.accuracy >= 0.7
                      ? "var(--warn, #b6802c)"
                      : "var(--bad, #c44a4a)",
                }}
              >
                {pct(held_out_eval.accuracy)}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>accuracy</span>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
              {fmtTs(held_out_eval.evaluated_at)} · {held_out_eval.label_count.toLocaleString()} labels
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Held-out eval: not yet run</div>
        )}

        {/* Last-fetched timestamp */}
        {lastFetched && (
          <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "right", marginTop: -4 }}>
            Updated {lastFetched.toLocaleTimeString()}
          </div>
        )}
      </div>
    );
  },
);

export default ObservabilityPanel;
export type { ObservabilityPanelHandle, ObservabilityPanelProps };
