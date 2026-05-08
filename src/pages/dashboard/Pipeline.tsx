import { useState, useEffect, type CSSProperties } from "react";
import { AlertTriangle, Check, RotateCcw, SkipForward, Loader2, Clock } from "lucide-react";
import { statusStages, getRelativeTime } from "@/lib/types";
import type { Property, Scene } from "@/lib/types";
import { fetchProperties, fetchProperty, approveScene, retryScene, resubmitScene, skipScene } from "@/lib/api";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = {
  fontFamily: "var(--le-font-mono)",
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.45)",
};
const PAGE_H1: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: "clamp(28px, 4vw, 44px)",
  fontWeight: 500,
  letterSpacing: "-0.035em",
  lineHeight: 0.98,
  color: "#fff",
  margin: 0,
};
const SECTION_H3: CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 20,
  fontWeight: 500,
  letterSpacing: "-0.025em",
  color: "#fff",
  margin: 0,
};
const GHOST_BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "#fff",
  border: "1px solid rgba(220,230,255,0.18)",
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};
const GHOST_LIGHT_BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "rgba(255,255,255,0.62)",
  border: "none",
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
};

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const Pipeline = () => {
  const [propertiesByStatus, setPropertiesByStatus] = useState<Record<string, Property[]>>({});
  const [reviewScenes, setReviewScenes] = useState<(Scene & { propertyAddress?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stagePromises = statusStages.map((stage) => fetchProperties({ status: stage.key, limit: 50 }));
        const stageResults = await Promise.all(stagePromises);
        if (cancelled) return;
        const byStatus: Record<string, Property[]> = {};
        statusStages.forEach((stage, i) => {
          byStatus[stage.key] = stageResults[i].properties;
        });
        setPropertiesByStatus(byStatus);

        const reviewRes = await fetchProperties({ status: "needs_review", limit: 20 });
        if (cancelled) return;
        const scenesWithAddress: (Scene & { propertyAddress?: string })[] = [];
        for (const prop of reviewRes.properties) {
          try {
            const detail = await fetchProperty(prop.id);
            if (cancelled) return;
            const failed = detail.scenes.filter(
              (s) => s.status === "qc_hard_reject" || s.status === "qc_soft_reject" || s.status === "needs_review",
            );
            failed.forEach((s) => scenesWithAddress.push({ ...s, propertyAddress: prop.address }));
          } catch {
            // skip
          }
        }
        setReviewScenes(scenesWithAddress);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load pipeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const wrap = async (sceneId: string, fn: () => Promise<void>) => {
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

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-destructive/40 bg-destructive/5 p-10">
        <div className="flex items-start gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-destructive/40 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <span style={{ ...EYEBROW, color: "hsl(var(--destructive))" }}>— Error</span>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-20">
      {/* Stage columns */}
      <section>
        <span style={EYEBROW}>— Pipeline</span>
        <h2 className="mt-3" style={PAGE_H1}>By stage.</h2>

        <div className="mt-12 grid gap-px bg-border md:grid-cols-3 xl:grid-cols-6">
          {statusStages.map((stage, idx) => {
            const props = propertiesByStatus[stage.key] || [];
            return (
              <div key={stage.key} className="flex min-h-[260px] flex-col bg-background p-5">
                <div className="mb-5 flex items-center justify-between">
                  <span style={{ ...EYEBROW, color: "#fff" }}>
                    <span style={{ color: "rgba(255,255,255,0.45)" }}>0{idx + 1}</span> {stage.label}
                  </span>
                  <span className="text-xs" style={{ fontFamily: "var(--le-font-mono)", color: "rgba(255,255,255,0.55)" }}>{props.length}</span>
                </div>
                <div className="flex-1 space-y-2">
                  {props.length === 0 ? (
                    <div className="border border-dashed border-border py-6 text-center">
                      <p className="text-[11px] text-muted-foreground/60">Empty</p>
                    </div>
                  ) : (
                    props.map((p, i) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: i * 0.03, ease: EASE }}
                        className="group cursor-pointer border border-border bg-secondary/30 p-3 transition-colors duration-500 hover:border-foreground/40 hover:bg-secondary"
                      >
                        <p className="truncate text-xs font-semibold tracking-[-0.005em]">{p.address}</p>
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {getRelativeTime(p.created_at)}
                        </div>
                        {stage.key === "generating" && p.selected_photo_count > 0 && (
                          <p className="tabular mt-2 text-[10px] text-accent">
                            {Math.floor(p.selected_photo_count * 0.4)} / {p.selected_photo_count} clips
                          </p>
                        )}
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Needs review */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <span style={EYEBROW}>— Manual review</span>
            <h3 className="mt-3" style={SECTION_H3}>
              {reviewScenes.length === 0 ? "All clear" : `${reviewScenes.length} scenes need a decision`}
            </h3>
          </div>
        </div>

        {reviewScenes.length === 0 ? (
          <div className="mt-10 border border-dashed border-border bg-secondary/30 py-16 text-center text-sm text-muted-foreground">
            Every clip passed automated QC.
          </div>
        ) : (
          <div className="mt-10 grid gap-px bg-border">
            {reviewScenes.map((scene, i) => (
              <motion.div
                key={scene.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: EASE }}
                className="grid gap-6 bg-background p-6 md:grid-cols-[200px_1fr_auto]"
              >
                <div className="flex aspect-video items-center justify-center border border-border bg-secondary text-[10px] text-muted-foreground">
                  Clip preview
                </div>
                <div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-xs font-semibold" style={{ fontFamily: "var(--le-font-mono)", color: "#fff" }}>Scene {scene.scene_number}</span>
                    <span style={{ ...EYEBROW, color: "hsl(var(--destructive))" }}>{scene.status.replace(/_/g, " ")}</span>
                    <span className="text-[11px]" style={{ fontFamily: "var(--le-font-mono)", color: "rgba(255,255,255,0.55)" }}>
                      Confidence {(scene.qc_confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  {scene.propertyAddress && (
                    <p className="mt-1 text-xs text-muted-foreground">{scene.propertyAddress}</p>
                  )}
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{scene.prompt}</p>
                  {scene.qc_issues?.issues && (
                    <ul className="mt-3 space-y-1.5">
                      {scene.qc_issues.issues.slice(0, 3).map((issue: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 text-[11px] text-destructive">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.5} />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-row gap-2 md:flex-col">
                  <button
                    type="button"
                    style={{ ...GHOST_BTN, opacity: actionLoading[scene.id] ? 0.4 : 1 }}
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await approveScene(scene.id); })}
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    style={{ ...GHOST_BTN, opacity: actionLoading[scene.id] ? 0.4 : 1 }}
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await resubmitScene(scene.id); })}
                    title="Resubmit with current prompt. Auto-fails over to another provider on permanent errors."
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Resubmit
                  </button>
                  <button
                    type="button"
                    style={{ ...GHOST_BTN, opacity: actionLoading[scene.id] ? 0.4 : 1 }}
                    disabled={actionLoading[scene.id]}
                    onClick={() =>
                      wrap(scene.id, async () => {
                        const target = scene.provider === "kling" ? "runway" : "kling";
                        await resubmitScene(scene.id, { provider: target });
                      })
                    }
                    title="Retry on the other provider (force failover)."
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {scene.provider === "kling" ? "Try Runway" : "Try Kling"}
                  </button>
                  <button
                    type="button"
                    style={{ ...GHOST_LIGHT_BTN, opacity: actionLoading[scene.id] ? 0.4 : 1 }}
                    disabled={actionLoading[scene.id]}
                    onClick={async () => {
                      const next = window.prompt("Edit prompt then resubmit:", scene.prompt);
                      if (!next || !next.trim() || next.trim() === scene.prompt) return;
                      await wrap(scene.id, async () => { await retryScene(scene.id, next.trim()); });
                    }}
                    title="Edit the prompt and resubmit."
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Edit prompt
                  </button>
                  <button
                    type="button"
                    style={{ ...GHOST_LIGHT_BTN, opacity: actionLoading[scene.id] ? 0.4 : 1 }}
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await skipScene(scene.id); })}
                  >
                    <SkipForward className="h-3.5 w-3.5" /> Skip
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Pipeline;
