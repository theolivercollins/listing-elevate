import { useState, useEffect, type CSSProperties } from "react";
import type { Property, Scene, DailyStat } from "@/lib/types";
import { fetchProperties, fetchProperty, fetchStatsOverview, fetchDailyStats, approveScene, retryScene, resubmitScene, skipScene } from "@/lib/api";
import { HealthCard, StatusPill, PropertyThumb, Card, SectionTitle, fmtRel, fmtDuration } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_PROPERTIES, SAMPLE_STAGES, SAMPLE_REVIEW_SCENES } from "@/components/dashboard/sample-data";
import type { SampleProperty, SampleReviewScene } from "@/components/dashboard/sample-data";

// ─── Adapter: live Property → SampleProperty shape ───────────────
function adaptProperty(p: Property): SampleProperty {
  return {
    id: p.id,
    address: p.address,
    status: p.status,
    photos: p.photo_count,
    scenes: 0,
    cost: p.total_cost_cents,
    duration_ms: p.processing_time_ms || null,
    agent: p.listing_agent,
    created_at: new Date(p.created_at).getTime(),
    progress: progressForStatus(p.status),
    thumb_hue: hueForId(p.id),
  };
}

function progressForStatus(status: string): number {
  const map: Record<string, number> = {
    queued: 4, ingesting: 14, analyzing: 26, scripting: 42,
    generating: 64, qc: 82, assembling: 94, complete: 100, needs_review: 80,
  };
  return map[status] ?? 0;
}

function hueForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return 200 + (h % 160);
}

// ─── Style constants ──────────────────────────────────────────────
const ghostBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 12px", borderRadius: 10,
  border: "1px solid rgba(15,24,60,0.08)", background: "rgba(255,255,255,0.5)",
  color: "var(--ink-2)", fontSize: 12, fontWeight: 500, cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const primaryAction: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center",
  padding: "9px 14px", borderRadius: 10,
  background: "var(--ink)", color: "#fff", border: "none",
  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  boxShadow: "0 6px 18px -8px rgba(11,18,32,0.55), 0 1px 0 rgba(255,255,255,0.18) inset",
};

const secondaryAction: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center",
  padding: "9px 14px", borderRadius: 10,
  background: "rgba(255,255,255,0.7)", color: "var(--ink)", border: "1px solid rgba(15,24,60,0.1)",
  fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};

const ghostAction: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center",
  padding: "8px 14px", borderRadius: 10,
  background: "transparent", color: "var(--muted)", border: "none",
  fontSize: 11.5, fontWeight: 500, cursor: "pointer",
};

// ─── PipelineCard ─────────────────────────────────────────────────
function PipelineCard({ property }: { property: SampleProperty }) {
  const isActive = !["complete", "queued"].includes(property.status);
  const parts = property.address.split(",");
  const line1 = parts[0] ?? property.address;
  const line2 = parts.slice(1).join(",").trim();
  return (
    <div
      className="le-lift"
      style={{
        padding: 12, borderRadius: 12,
        background: "rgba(255,255,255,0.7)",
        border: "1px solid rgba(15,24,60,0.06)",
        boxShadow: "0 1px 0 rgba(255,255,255,0.8) inset",
        position: "relative", overflow: "hidden",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <PropertyThumb hue={property.thumb_hue} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, color: "var(--ink)" }}>
            {line1}
          </div>
          {line2 && (
            <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>{line2}</div>
          )}
        </div>
      </div>
      <div
        style={{
          marginTop: 10, display: "flex", justifyContent: "space-between",
          alignItems: "center", fontSize: 10,
          fontVariantNumeric: "tabular-nums",
          color: "var(--muted-2)",
        }}
      >
        <span>{property.photos} photos</span>
        <span>{fmtRel(property.created_at)}</span>
      </div>
      {isActive && property.progress < 100 && (
        <div style={{ marginTop: 10, height: 3, background: "rgba(15,24,60,0.06)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${property.progress}%`, background: "var(--accent)", borderRadius: 99 }} />
        </div>
      )}
    </div>
  );
}

// ─── ReviewCard ───────────────────────────────────────────────────
function ReviewCard({
  scene,
  actionLoading,
  onApprove,
  onResubmit,
  onTryOther,
  onEditPrompt,
  onSkip,
}: {
  scene: SampleReviewScene & { propertyAddress?: string };
  actionLoading: boolean;
  onApprove: () => void;
  onResubmit: () => void;
  onTryOther: () => void;
  onEditPrompt: () => void;
  onSkip: () => void;
}) {
  const providerHue = scene.provider === "kling" ? 215 : 250;
  const otherProvider = scene.provider === "kling" ? "Runway" : "Kling";
  const opacity = actionLoading ? 0.4 : 1;

  return (
    <div
      className="le-card-flat"
      style={{ padding: 18, display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 18, alignItems: "flex-start" }}
    >
      {/* Preview */}
      <div
        style={{
          aspectRatio: "16 / 9",
          background: `linear-gradient(135deg, hsl(${providerHue}, 10%, 50%), hsl(${providerHue + 15}, 12%, 32%))`,
          borderRadius: 12, display: "grid", placeItems: "center",
          color: "rgba(255,255,255,0.9)", position: "relative", overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.5)",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.4))" }} />
        <Icon name="play" size={26} style={{ position: "absolute", zIndex: 1 }} />
        <span
          style={{
            position: "absolute", top: 8, left: 8, fontSize: 9.5, fontWeight: 600,
            padding: "2px 6px", borderRadius: 99, background: "rgba(0,0,0,0.35)",
            color: "#fff", zIndex: 1, textTransform: "uppercase",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {scene.provider}
        </span>
      </div>

      {/* Body */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
            Scene 0{scene.scene_number}
          </span>
          <StatusPill status="needs_review" />
          <span
            style={{
              fontSize: 11, color: "var(--muted)", padding: "2px 8px", borderRadius: 99,
              background: "rgba(15,24,60,0.05)", fontVariantNumeric: "tabular-nums",
            }}
          >
            Confidence {(scene.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          {scene.propertyAddress ?? scene.property}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.5 }}>
          {scene.prompt}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {scene.issues.map((issue, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--bad)" }}>
              <Icon name="alert" size={12} strokeWidth={1.8} />
              {issue}
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", minWidth: 150 }}>
        <button type="button" style={{ ...primaryAction, opacity }} disabled={actionLoading} onClick={onApprove}>
          <Icon name="check" size={14} />Approve
        </button>
        <button type="button" style={{ ...secondaryAction, opacity }} disabled={actionLoading} onClick={onResubmit}>
          <Icon name="retry" size={14} />Resubmit
        </button>
        <button type="button" style={{ ...secondaryAction, opacity }} disabled={actionLoading} onClick={onTryOther}>
          <Icon name="retry" size={14} />Try {otherProvider}
        </button>
        <button type="button" style={{ ...ghostAction, opacity }} disabled={actionLoading} onClick={onEditPrompt}>
          <Icon name="sparkles" size={13} />Edit prompt
        </button>
        <button type="button" style={{ ...ghostAction, opacity }} disabled={actionLoading} onClick={onSkip}>
          <Icon name="skip" size={13} />Skip
        </button>
      </div>
    </div>
  );
}

// ─── Pipeline page ────────────────────────────────────────────────
const Pipeline = () => {
  const [propsByStage, setPropsByStage] = useState<Record<string, SampleProperty[]>>({});
  const [reviewScenes, setReviewScenes] = useState<(SampleReviewScene & { propertyAddress?: string })[]>([]);
  const [allLiveProps, setAllLiveProps] = useState<Property[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [avgProcessingMs, setAvgProcessingMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "timeline">("kanban");
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Fetch all stage buckets + overview + daily stats in parallel
        const stageFetches = SAMPLE_STAGES.map((s) =>
          fetchProperties({ status: s.key, limit: 50 }),
        );
        const [stageResults, overviewRes, dailyRes] = await Promise.all([
          Promise.all(stageFetches),
          fetchStatsOverview().catch(() => null),
          fetchDailyStats(14).catch(() => null),
        ]);
        if (cancelled) return;

        const allLive: Property[] = stageResults.flatMap((r) => r.properties);
        const totalLive = allLive.length;
        setAllLiveProps(allLive);

        if (overviewRes?.avgProcessingMs != null) {
          setAvgProcessingMs(overviewRes.avgProcessingMs);
        }
        if (dailyRes?.stats) {
          setDailyStats(dailyRes.stats);
        }

        let displayProps: SampleProperty[];
        if (totalLive === 0) {
          displayProps = SAMPLE_PROPERTIES;
        } else {
          displayProps = allLive.map(adaptProperty);
        }

        // Group by stage
        const byStage: Record<string, SampleProperty[]> = {};
        SAMPLE_STAGES.forEach((s) => { byStage[s.key] = []; });
        displayProps.forEach((p) => {
          if (byStage[p.status]) byStage[p.status].push(p);
        });
        setPropsByStage(byStage);

        // Review scenes
        if (totalLive === 0) {
          setReviewScenes(SAMPLE_REVIEW_SCENES);
        } else {
          const reviewRes = await fetchProperties({ status: "needs_review", limit: 20 });
          if (cancelled) return;
          const liveScenes: (SampleReviewScene & { propertyAddress?: string })[] = [];
          for (const prop of reviewRes.properties) {
            try {
              const detail = await fetchProperty(prop.id);
              if (cancelled) return;
              const failed = detail.scenes.filter(
                (s: Scene) =>
                  s.status === "qc_hard_reject" ||
                  s.status === "qc_soft_reject" ||
                  s.status === "needs_review",
              );
              failed.forEach((s: Scene) => {
                liveScenes.push({
                  id: s.id,
                  property: prop.address,
                  propertyAddress: prop.address,
                  scene_number: s.scene_number,
                  status: s.status,
                  confidence: s.qc_confidence,
                  provider: s.provider,
                  prompt: s.prompt,
                  issues: (s.qc_issues as { issues?: string[] } | null)?.issues ?? [],
                });
              });
            } catch {
              // skip individual property errors
            }
          }
          // If no scene-level data found, fall back to property-level cards
          if (liveScenes.length === 0 && reviewRes.properties.length > 0) {
            reviewRes.properties.forEach((prop, idx) => {
              liveScenes.push({
                id: prop.id,
                property: prop.address,
                propertyAddress: prop.address,
                scene_number: idx + 1,
                status: "needs_review",
                confidence: 0.5,
                provider: "kling",
                prompt: "Review required — no scene detail available.",
                issues: ["Manual review required"],
              });
            });
          }
          setReviewScenes(liveScenes);
        }
      } catch {
        // Fall back to sample data on any top-level error
        const byStage: Record<string, SampleProperty[]> = {};
        SAMPLE_STAGES.forEach((s) => { byStage[s.key] = []; });
        SAMPLE_PROPERTIES.forEach((p) => { if (byStage[p.status]) byStage[p.status].push(p); });
        setPropsByStage(byStage);
        setReviewScenes(SAMPLE_REVIEW_SCENES);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const wrapAction = async (sceneId: string, fn: () => Promise<void>) => {
    setActionLoading((p) => ({ ...p, [sceneId]: true }));
    try {
      await fn();
      setReviewScenes((prev) => prev.filter((s) => s.id !== sceneId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading((p) => ({ ...p, [sceneId]: false }));
    }
  };

  // Derive "in flight" count
  const allProps = Object.values(propsByStage).flat();
  const inFlight = allProps.filter((p) => !["complete", "queued", "needs_review"].includes(p.status)).length;

  // ── Avg stage time delta: today vs avg of last week ───────────────────────
  const avgStageDisplay = avgProcessingMs != null ? fmtDuration(avgProcessingMs) : "—";
  let avgStageDelta: number | undefined = undefined;
  if (dailyStats.length >= 2) {
    const lastStat = dailyStats[dailyStats.length - 1];
    const todayAvg = lastStat?.avg_processing_time_ms ?? 0;
    const weekSlice = dailyStats.slice(-8, -1);
    const weekVals = weekSlice.map((d) => d.avg_processing_time_ms ?? 0).filter((v) => v > 0);
    if (weekVals.length > 0 && todayAvg > 0) {
      const lastWeekAvg = weekVals.reduce((s, v) => s + v, 0) / weekVals.length;
      if (lastWeekAvg > 0) {
        avgStageDelta = ((todayAvg - lastWeekAvg) / lastWeekAvg) * 100;
      }
    }
  }

  // ── Auto-resolved 24h: completed in last 24h vs previous 24h ─────────────
  const now = Date.now();
  const H24 = 24 * 60 * 60 * 1000;
  const autoResolved24h = allLiveProps.filter(
    (p) => p.status === "complete" && now - new Date(p.updated_at).getTime() < H24,
  ).length;
  const autoResolvedPrev24h = allLiveProps.filter(
    (p) =>
      p.status === "complete" &&
      now - new Date(p.updated_at).getTime() >= H24 &&
      now - new Date(p.updated_at).getTime() < 2 * H24,
  ).length;
  let autoResolvedDelta: number | undefined = undefined;
  if (allLiveProps.length > 0) {
    const prev = Math.max(autoResolvedPrev24h, 1);
    autoResolvedDelta = ((autoResolved24h - autoResolvedPrev24h) / prev) * 100;
  }

  // ── Manual review delta: current vs 24h ago (needs_review is "now") ───────
  const manualReviewCount = reviewScenes.length;
  // We can't easily compute "was" from static snapshot; leave delta undefined when no live data
  const manualReviewDelta: number | undefined = undefined;

  if (loading) {
    return (
      <div className="le-fade-up" style={{ display: "flex", justifyContent: "center", padding: "96px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 13 }}>
          <Icon name="clock" size={16} />
          Loading pipeline...
        </div>
      </div>
    );
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── 1. Health row (4-up) ── */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <HealthCard label="In flight" value={inFlight} icon="pipeline" tone="accent" />
        <HealthCard
          label="Avg stage time"
          value={avgStageDisplay}
          icon="clock"
          tone="neutral"
          delta={avgStageDelta}
        />
        <HealthCard
          label="Auto-resolved 24h"
          value={allLiveProps.length > 0 ? autoResolved24h : 0}
          icon="sparkles"
          tone="good"
          delta={autoResolvedDelta}
        />
        <HealthCard
          label="Manual review"
          value={manualReviewCount}
          icon="alert"
          tone="warn"
          delta={manualReviewDelta}
        />
      </section>

      {/* ── 2. Kanban section ── */}
      <Card padding={20}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <SectionTitle eyebrow="Stages" title="Live pipeline" />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Segmented control */}
            <div className="le-seg">
              {(["kanban", "timeline"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`le-seg-item${view === v ? " is-active" : ""}`}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <button type="button" style={ghostBtn}>
              <Icon name="filter" size={14} />Filter
            </button>
          </div>
        </div>

        {/* Kanban grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${SAMPLE_STAGES.length}, minmax(0, 1fr))`,
            gap: 12,
          }}
        >
          {SAMPLE_STAGES.map((stage) => {
            const props = propsByStage[stage.key] ?? [];
            return (
              <div
                key={stage.key}
                className="le-card-flat"
                style={{ padding: 12, minHeight: 380, display: "flex", flexDirection: "column", gap: 10 }}
              >
                {/* Column header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 10, color: "var(--muted-2)", fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {stage.short}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{stage.label}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 7px",
                      borderRadius: 99, background: "rgba(15,24,60,0.06)", color: "var(--ink-2)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {props.length}
                  </span>
                </div>

                {/* Cards */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
                  {props.length === 0 ? (
                    <div
                      style={{
                        flex: 1, display: "grid", placeItems: "center",
                        border: "1px dashed rgba(15,24,60,0.12)", borderRadius: 12,
                        color: "var(--muted-2)", fontSize: 11,
                      }}
                    >
                      Empty
                    </div>
                  ) : (
                    props.map((p) => <PipelineCard key={p.id} property={p} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── 3. Manual review section ── */}
      <Card padding={24}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
          <SectionTitle
            eyebrow="Manual review"
            title={
              reviewScenes.length === 0
                ? "All clear"
                : `${reviewScenes.length} scenes need a decision`
            }
          />
        </div>

        {reviewScenes.length === 0 ? (
          <div
            style={{
              border: "1px dashed rgba(15,24,60,0.12)", borderRadius: 12,
              padding: "48px 0", textAlign: "center",
              fontSize: 13, color: "var(--muted)",
            }}
          >
            Every clip passed automated QC.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {reviewScenes.map((scene) => (
              <ReviewCard
                key={scene.id}
                scene={scene}
                actionLoading={!!actionLoading[scene.id]}
                onApprove={() => wrapAction(scene.id, () => approveScene(scene.id))}
                onResubmit={() => wrapAction(scene.id, () => resubmitScene(scene.id))}
                onTryOther={() =>
                  wrapAction(scene.id, () => {
                    const target: "runway" | "kling" = scene.provider === "kling" ? "runway" : "kling";
                    return resubmitScene(scene.id, { provider: target });
                  })
                }
                onEditPrompt={() => {
                  const next = window.prompt("Edit prompt then resubmit:", scene.prompt);
                  if (!next || !next.trim() || next.trim() === scene.prompt) return;
                  wrapAction(scene.id, () => retryScene(scene.id, next.trim()));
                }}
                onSkip={() => wrapAction(scene.id, () => skipScene(scene.id))}
              />
            ))}
          </div>
        )}
      </Card>

    </div>
  );
};

export default Pipeline;
