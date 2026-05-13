import { useState, useEffect } from "react";
import { AlertTriangle, Check, RotateCcw, SkipForward, Loader2, CheckCircle2 } from "lucide-react";
import type { Scene } from "@/lib/types";
import { fetchProperties, fetchProperty, approveScene, retryScene, resubmitScene, skipScene } from "@/lib/api";
import { motion } from "framer-motion";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import "@/v2/styles/v2.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
const Pipeline = () => {
  const [reviewScenes, setReviewScenes] = useState<(Scene & { propertyAddress?: string })[]>([]);
  const [totalProperties, setTotalProperties] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const reviewRes = await fetchProperties({ status: "needs_review", limit: 20 });
        if (cancelled) return;
        setTotalProperties(reviewRes.total ?? reviewRes.properties.length);
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

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--le-text-muted)" }} />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="rounded-[14px] border p-10"
        style={{
          background: "var(--le-bg-elev)",
          borderColor: "var(--le-border)",
          boxShadow: "var(--le-shadow-md)",
        }}
      >
        <div className="flex items-start gap-5">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--le-danger-soft, rgba(239,68,68,0.08))", color: "var(--le-danger)" }}
          >
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <div className="le-eyebrow" style={{ color: "var(--le-danger)" }}>Error</div>
            <p className="mt-2 text-sm" style={{ color: "var(--le-text-muted)" }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Orders</div>
        <h2
          className="le-display mt-1 text-[28px] font-medium tracking-tight"
          style={{ color: "var(--le-text)" }}
        >
          Pipeline
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--le-text-muted)", maxWidth: 560 }}>
          Failing scenes requiring manual review. Approve to deliver as-is, resubmit with a new prompt, try a different provider, or skip.
        </p>
      </div>

      {/* Review queue card */}
      <div
        className="rounded-[14px] border"
        style={{
          background: "var(--le-bg-elev)",
          borderColor: "var(--le-border)",
          boxShadow: "var(--le-shadow-md)",
        }}
      >
        {/* Card header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--le-border)" }}
        >
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Manual review</div>
          {reviewScenes.length > 0 && (
            <span
              className="le-mono rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
              style={{
                background: "var(--le-warn-soft, rgba(245,158,11,0.1))",
                color: "var(--le-warn, rgb(245,158,11))",
              }}
            >
              {reviewScenes.length}
            </span>
          )}
        </div>

        {/* Empty state */}
        {reviewScenes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20">
            <CheckCircle2
              className="h-10 w-10"
              strokeWidth={1.25}
              style={{ color: "var(--le-success, rgb(34,197,94))" }}
            />
            <p className="text-sm font-medium" style={{ color: "var(--le-text-muted)" }}>
              No scenes need review. Pipeline is clean.
            </p>
          </div>
        ) : (
          /* Scene rows */
          <div>
            {reviewScenes.map((scene, i) => (
              <motion.div
                key={scene.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: i * 0.04, ease: EASE }}
                className="flex items-start gap-5 px-6 py-5"
                style={{
                  borderBottom: i < reviewScenes.length - 1 ? "1px solid var(--le-border)" : undefined,
                  opacity: actionLoading[scene.id] ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {/* Thumbnail placeholder */}
                <div
                  className="h-8 w-8 shrink-0 rounded overflow-hidden"
                  style={{ background: "var(--le-bg-sunken, rgba(255,255,255,0.04))", flexShrink: 0 }}
                />

                {/* Scene info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className="le-mono text-xs font-semibold"
                      style={{ color: "var(--le-text)" }}
                    >
                      Scene {scene.scene_number}
                    </span>
                    <span
                      className="le-mono rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        background: "var(--le-danger-soft, rgba(239,68,68,0.08))",
                        color: "var(--le-danger)",
                      }}
                    >
                      {scene.status.replace(/_/g, " ")}
                    </span>
                    {scene.qc_confidence != null && (
                      <span
                        className="le-mono text-[10px]"
                        style={{ color: "var(--le-text-muted)" }}
                      >
                        {(scene.qc_confidence * 100).toFixed(0)}% confidence
                      </span>
                    )}
                  </div>

                  {scene.propertyAddress && (
                    <p className="mt-0.5 truncate text-xs" style={{ color: "var(--le-text-muted)" }}>
                      {scene.propertyAddress}
                    </p>
                  )}

                  {scene.prompt && (
                    <p
                      className="mt-2 line-clamp-2 text-xs leading-relaxed"
                      style={{ color: "var(--le-text-muted)" }}
                    >
                      {scene.prompt}
                    </p>
                  )}

                  {scene.qc_issues?.issues && (
                    <ul className="mt-2 space-y-1">
                      {scene.qc_issues.issues.slice(0, 3).map((issue: string, idx: number) => (
                        <li
                          key={idx}
                          className="flex items-start gap-1.5 text-[11px]"
                          style={{ color: "var(--le-danger)" }}
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.5} />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <DashboardButton
                    variant="primary"
                    size="sm"
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await approveScene(scene.id); })}
                    leftIcon={<Check className="h-3.5 w-3.5" strokeWidth={2} />}
                  >
                    Approve
                  </DashboardButton>

                  <DashboardButton
                    variant="ghost"
                    size="sm"
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await resubmitScene(scene.id); })}
                    title="Resubmit with current prompt. Auto-fails over to another provider on permanent errors."
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />}
                  >
                    Resubmit
                  </DashboardButton>

                  <DashboardButton
                    variant="ghost"
                    size="sm"
                    disabled={actionLoading[scene.id]}
                    onClick={() =>
                      wrap(scene.id, async () => {
                        const target = scene.provider === "kling" ? "runway" : "kling";
                        await resubmitScene(scene.id, { provider: target });
                      })
                    }
                    title="Retry on the other provider (force failover)."
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />}
                  >
                    {scene.provider === "kling" ? "Try Runway" : "Try Kling"}
                  </DashboardButton>

                  <DashboardButton
                    variant="ghost"
                    size="sm"
                    disabled={actionLoading[scene.id]}
                    onClick={async () => {
                      const next = window.prompt("Edit prompt then resubmit:", scene.prompt);
                      if (!next || !next.trim() || next.trim() === scene.prompt) return;
                      await wrap(scene.id, async () => { await retryScene(scene.id, next.trim()); });
                    }}
                    title="Edit the prompt and resubmit."
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />}
                  >
                    Edit prompt
                  </DashboardButton>

                  <DashboardButton
                    variant="destructive"
                    size="sm"
                    disabled={actionLoading[scene.id]}
                    onClick={() => wrap(scene.id, async () => { await skipScene(scene.id); })}
                    leftIcon={<SkipForward className="h-3.5 w-3.5" strokeWidth={2} />}
                  >
                    Skip
                  </DashboardButton>
                </div>
              </motion.div>
            ))}
            {totalProperties > 20 && (
              <div
                className="px-6 py-3 text-center text-xs"
                style={{ borderTop: "1px solid var(--le-border)", color: "var(--le-text-muted)" }}
              >
                Showing 20 of {totalProperties} — refresh to see more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Pipeline;
