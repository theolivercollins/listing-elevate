import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import "@/v2/styles/v2.css";
import { ArrowLeft, Download, RotateCcw, Copy, Check, Loader2, AlertTriangle, Star } from "lucide-react";
import { formatCents, formatDuration } from "@/lib/types";
import type { Property, Photo, Scene, PipelineLog, CostEvent, SceneRating } from "@/lib/types";
import { fetchProperty, fetchLogs, rerunProperty, fetchSystemPrompts, rateScene, resubmitScene } from "@/lib/api";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { StatusPill } from "@/v2/components/dashboard/StatusPill";

const FAILURE_TAGS = [
  "hallucinated architecture",
  "wrong motion direction",
  "camera exited room",
  "warped geometry",
  "added people/objects",
  "too static / boring",
  "too fast",
  "low quality",
];
const SUCCESS_TAGS = [
  "clean motion",
  "cinematic",
  "perfect",
  "stayed in the room",
];

type RatedScene = Scene & { rating: SceneRating | null };

function RatingWidget({
  scene,
  onRated,
}: {
  scene: RatedScene;
  onRated: (rating: SceneRating) => void;
}) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [rating, setRating] = useState<number>(scene.rating?.rating ?? 0);
  const [comment, setComment] = useState<string>(scene.rating?.comment ?? "");
  const [tags, setTags] = useState<string[]>(scene.rating?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(!!scene.rating);
  const [justSaved, setJustSaved] = useState(false);

  async function save(nextRating: number, nextComment: string, nextTags: string[]) {
    setSaving(true);
    try {
      const row = await rateScene(
        scene.id,
        nextRating,
        nextComment.trim() ? nextComment.trim() : null,
        nextTags.length > 0 ? nextTags : null,
      );
      onRated(row);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (err) {
      alert(`Rating save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function clickStar(value: number) {
    setRating(value);
    setExpanded(true);
    save(value, comment, tags);
  }

  function toggleTag(tag: string) {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    setTags(next);
    if (rating > 0) save(rating, comment, next);
  }

  function commentBlur() {
    if (rating > 0) save(rating, comment, tags);
  }

  const availableTags = rating >= 4 ? SUCCESS_TAGS : rating > 0 && rating <= 2 ? FAILURE_TAGS : [...SUCCESS_TAGS, ...FAILURE_TAGS];

  return (
    <div className="border-t p-4" style={{ borderColor: "var(--le-border)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hoverValue ?? rating) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHoverValue(n)}
                onMouseLeave={() => setHoverValue(null)}
                onClick={() => clickStar(n)}
                className="p-0.5 transition-transform hover:scale-110"
                aria-label={`${n} star`}
              >
                <Star
                  className="h-4 w-4"
                  style={{ fill: filled ? "var(--le-text)" : "transparent", color: filled ? "var(--le-text)" : "var(--le-text-muted)" }}
                  strokeWidth={1.5}
                />
              </button>
            );
          })}
          {rating > 0 && (
            <span className="tabular ml-2 text-[10px]" style={{ color: "var(--le-text-muted)" }}>{rating}/5</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3 w-3 animate-spin" style={{ color: "var(--le-text-muted)" }} />}
          {justSaved && <Check className="h-3 w-3" style={{ color: "var(--le-accent)" }} />}
          {rating > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="label transition-colors"
              style={{ color: "var(--le-text-muted)" }}
            >
              Add note
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={commentBlur}
            placeholder={rating <= 2 ? "What went wrong? (required for low ratings)" : "What worked? (optional)"}
            rows={2}
            className="w-full resize-y rounded-[8px] border p-2 text-xs leading-snug focus:outline-none focus:ring-1"
            style={{
              background: "var(--le-bg-sunken)",
              borderColor: "var(--le-border)",
              color: "var(--le-text)",
            }}
          />
          {rating > 0 && (
            <div className="flex flex-wrap gap-1">
              {availableTags.map((tag) => {
                const selected = tags.includes(tag);
                const isFail = FAILURE_TAGS.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="label rounded-[8px] px-2 py-1 transition-colors"
                    style={
                      selected
                        ? isFail
                          ? { background: "var(--le-danger-soft)", color: "var(--le-danger)", border: "1px solid var(--le-danger)" }
                          : { background: "var(--le-text)", color: "var(--le-bg)", border: "1px solid var(--le-text)" }
                        : { background: "transparent", color: "var(--le-text-muted)", border: "1px solid var(--le-border)" }
                    }
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResubmitControls({ scene }: { scene: RatedScene }) {
  const [busy, setBusy] = useState<null | "auto" | "other" | "edit">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"info" | "warn" | "error" | null>(null);

  const other: "kling" | "runway" = scene.provider === "kling" ? "runway" : "kling";

  async function call(fn: () => Promise<{ ok: boolean; provider?: string; willRetryViaCron?: boolean; message?: string }>, label: "auto" | "other" | "edit") {
    setBusy(label);
    setMessage(null);
    setKind(null);
    try {
      const r = await fn();
      if (r.ok) {
        setKind("info");
        setMessage(`Submitted to ${r.provider}. Cron will finalize when the clip lands.`);
      } else if (r.willRetryViaCron) {
        setKind("warn");
        setMessage(`Provider busy (${r.message ?? "capacity"}). Cron will retry.`);
      } else {
        setKind("error");
        setMessage(r.message ?? "Resubmit failed across all providers.");
      }
    } catch (err) {
      setKind("error");
      setMessage(err instanceof Error ? err.message : "Resubmit failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--le-border)" }}>
      <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" }}>Admin actions</span>
      <DashboardButton
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => call(() => resubmitScene(scene.id), "auto")}
        leftIcon={busy === "auto" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      >
        Resubmit
      </DashboardButton>
      <DashboardButton
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => call(() => resubmitScene(scene.id, { provider: other }), "other")}
        leftIcon={busy === "other" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
      >
        Try {other}
      </DashboardButton>
      <DashboardButton
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={async () => {
          const next = window.prompt("Edit prompt then resubmit:", scene.prompt);
          if (!next || !next.trim() || next.trim() === scene.prompt) return;
          await call(() => resubmitScene(scene.id, { prompt: next.trim() }), "edit");
        }}
        leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
      >
        Edit + resubmit
      </DashboardButton>
      {message && (
        <span
          className="text-xs"
          style={{
            color:
              kind === "error"
                ? "var(--le-danger)"
                : kind === "warn"
                ? "var(--le-warn)"
                : "var(--le-text-muted)",
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}

const ACTIVE_STATUSES = new Set([
  "queued",
  "analyzing",
  "scripting",
  "generating",
  "qc",
  "assembling",
]);

const LOG_PAGE_SIZE = 20;

const PropertyDetail = () => {
  const { id } = useParams();
  const [property, setProperty] = useState<(Property & { photos: Photo[]; scenes: RatedScene[]; costEvents: CostEvent[] }) | null>(null);
  const [logs, setLogs] = useState<(PipelineLog & { properties?: { address: string } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [prompts, setPrompts] = useState<{ analysis: string; director: string; qc: string } | null>(null);
  const [copiedScene, setCopiedScene] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"photos" | "shots" | "logs" | "prompts">("photos");
  const [logsVisible, setLogsVisible] = useState<number>(LOG_PAGE_SIZE);

  const isPolling = !!property && ACTIVE_STATUSES.has(property.status);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [propData, logsData] = await Promise.all([
          fetchProperty(id),
          fetchLogs({ property_id: id, limit: 500 }),
        ]);
        if (cancelled) return;
        setProperty(propData);
        setLogs(logsData.logs);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load property");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live polling while pipeline is running. Pauses when tab hidden, resumes on focus.
  useEffect(() => {
    if (!id || !isPolling) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const [propData, logsData] = await Promise.all([
          fetchProperty(id),
          fetchLogs({ property_id: id, limit: 500 }),
        ]);
        if (cancelled) return;
        setProperty(propData);
        setLogs(logsData.logs);
      } catch {
        // swallow transient polling errors; keep existing state
      }
    };

    const start = () => {
      if (intervalId != null) return;
      intervalId = setInterval(poll, 3000);
    };
    const stop = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        poll();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [id, isPolling]);

  const handleRerun = async () => {
    if (!id) return;
    setRerunning(true);
    try {
      await rerunProperty(id);
      const propData = await fetchProperty(id);
      setProperty(propData);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Rerun failed");
    } finally {
      setRerunning(false);
    }
  };

  const handleCopyPrompt = async (sceneId: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedScene(sceneId);
    setTimeout(() => setCopiedScene(null), 1500);
  };

  const loadPrompts = async () => {
    if (prompts) return;
    try {
      const data = await fetchSystemPrompts();
      setPrompts(data);
    } catch {
      // non-fatal
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--le-text-muted)" }} />
      </div>
    );
  }

  if (error || !property) {
    return (
      <DashboardCard
        style={{
          background: "var(--le-danger-soft)",
          borderColor: "var(--le-danger)",
        }}
      >
        <div className="flex items-start gap-5 p-4">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border"
            style={{ background: "var(--le-danger-soft)", borderColor: "var(--le-danger)", color: "var(--le-danger)" }}
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <span className="label" style={{ color: "var(--le-danger)" }}>— Error</span>
            <p className="mt-3 text-sm" style={{ color: "var(--le-text-muted)" }}>{error || "Property not found"}</p>
          </div>
        </div>
      </DashboardCard>
    );
  }

  const photos = property.photos || [];
  const scenes = property.scenes || [];
  const costEvents = property.costEvents || [];
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const deliverables = scenes.filter((s) => s.clip_url);
  const costTotalCents = costEvents.reduce((s, e) => s + (e.cost_cents ?? 0), 0);
  // Primary image: prefer the first selected photo, fall back to the first
  // photo overall. photos[] is already ordered by created_at from fetchProperty.
  const primaryPhoto = photos.find((p) => p.selected) ?? photos[0] ?? null;

  return (
    <div className="space-y-16">
      {/* Header — full-bleed photo with text overlay — intentionally preserved per audit */}
      <div style={{ position: "relative", overflow: "hidden", marginBottom: 0 }}>
        {primaryPhoto ? (
          <div style={{ position: "relative", height: 320 }}>
            <img
              src={primaryPhoto.file_url}
              alt={primaryPhoto.file_name || property.address}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.45) saturate(1.1)" }}
            />
            <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,7,14,0.4) 0%, rgba(5,7,14,0.75) 100%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, padding: "32px 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <Link
                to="/dashboard/listings"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--le-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 20 }}
              >
                <ArrowLeft style={{ width: 12, height: 12 }} /> Listings
              </Link>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: isPolling ? "rgba(80,220,120,0.9)" : "rgba(255,255,255,0.55)" }}>
                      {property.status.replace(/_/g, " ")}
                    </span>
                    {isPolling && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "rgba(80,220,120,0.9)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(80,220,120,0.9)", animation: "le-pulse 1.6s ease-in-out infinite", display: "inline-block" }} />
                        LIVE
                      </span>
                    )}
                  </div>
                  <h1 style={{ fontSize: "clamp(28px, 4vw, 52px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", fontFamily: "var(--le-font-sans)", margin: 0 }}>
                    {property.address}
                  </h1>
                  <p style={{ marginTop: 12, fontFamily: "var(--le-font-mono)", fontSize: 11, letterSpacing: "0.08em", color: "rgba(255,255,255,0.62)" }}>
                    ${property.price.toLocaleString()} · {property.bedrooms}bd · {property.bathrooms}ba · {property.listing_agent}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={handleRerun}
                    disabled={rerunning}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 2, padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: rerunning ? "not-allowed" : "pointer", fontFamily: "var(--le-font-sans)", backdropFilter: "blur(8px)" }}
                  >
                    <RotateCcw style={{ width: 12, height: 12, ...(rerunning ? { animation: "spin 1s linear infinite" } : {}) }} />
                    Rerun
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "32px 0" }}>
            <Link
              to="/dashboard/listings"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--le-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", textDecoration: "none", marginBottom: 20 }}
            >
              <ArrowLeft style={{ width: 12, height: 12 }} /> Listings
            </Link>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
              <div>
                <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", display: "block", marginBottom: 12 }}>
                  {property.status.replace(/_/g, " ")}
                </span>
                <h1 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", fontFamily: "var(--le-font-sans)", margin: 0 }}>
                  {property.address}
                </h1>
                <p style={{ marginTop: 12, fontFamily: "var(--le-font-mono)", fontSize: 11, color: "rgba(255,255,255,0.62)" }}>
                  ${property.price.toLocaleString()} · {property.bedrooms}bd · {property.bathrooms}ba · {property.listing_agent}
                </p>
              </div>
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#fff", border: "1px solid rgba(220,230,255,0.18)", borderRadius: 2, padding: "8px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "var(--le-font-sans)" }}
              >
                <RotateCcw style={{ width: 12, height: 12 }} /> Rerun
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stat strip */}
      <DashboardCard padding="none">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[
            { label: "Total cost", value: formatCents(property.total_cost_cents) },
            { label: "Processing time", value: property.processing_time_ms > 0 ? formatDuration(property.processing_time_ms) : "—" },
            { label: "Photos", value: `${property.selected_photo_count} / ${property.photo_count}` },
            { label: "Clips delivered", value: `${deliverables.length} / ${scenes.length}` },
          ].map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: "20px 24px",
                borderRight: i < 3 ? "1px solid var(--le-border)" : "none",
              }}
            >
              <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-muted)", display: "block" }}>{s.label}</span>
              <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--le-text)", marginTop: 8 }}>{s.value}</div>
            </div>
          ))}
        </div>
      </DashboardCard>

      {/* Deliverables */}
      {deliverables.length > 0 && (
        <section>
          <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>— Deliverables</span>
          <h3 style={{ marginTop: 12, fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>
            {deliverables.length} {deliverables.length === 1 ? "clip" : "clips"} ready
          </h3>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {deliverables.map((scene) => (
              <DashboardCard key={scene.id} padding="none">
                <video src={scene.clip_url!} controls playsInline preload="metadata" className="aspect-video w-full rounded-t-[14px] bg-black" />
                <div className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">
                      Scene {scene.scene_number} · {scene.camera_movement.replace(/_/g, " ")}
                    </p>
                    <p className="tabular mt-1 text-[10px]" style={{ color: "var(--le-text-muted)" }}>
                      {scene.provider ?? "—"} · {scene.duration_seconds}s
                    </p>
                  </div>
                  <a
                    href={scene.clip_url!}
                    download={`scene_${scene.scene_number}.mp4`}
                    className="inline-flex items-center justify-center rounded-[8px] border"
                    style={{ width: 32, height: 32, background: "var(--le-bg-elev)", borderColor: "var(--le-border)", color: "var(--le-text)" }}
                  >
                    <Download style={{ width: 14, height: 14 }} />
                  </a>
                </div>
                <RatingWidget
                  scene={scene}
                  onRated={(row) => {
                    setProperty((prev) =>
                      prev
                        ? {
                            ...prev,
                            scenes: prev.scenes.map((s) =>
                              s.id === scene.id ? { ...s, rating: row } : s,
                            ),
                          }
                        : prev,
                    );
                  }}
                />
              </DashboardCard>
            ))}
          </div>
        </section>
      )}

      {/* Cost breakdown */}
      {costEvents.length > 0 && (
        <section>
          <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>— Costs</span>
          <h3 style={{ marginTop: 12, fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>
            Real per-call breakdown · <span style={{ color: "var(--le-text-muted)" }}>{formatCents(costTotalCents)}</span>
          </h3>
          <DashboardCard padding="none" className="mt-8">
            <div
              className="grid grid-cols-[1.2fr_1fr_0.6fr_1fr_1fr] gap-6 px-6 py-3"
              style={{ borderBottom: "1px solid var(--le-border)" }}
            >
              <span className="le-eyebrow font-medium" style={{ color: "var(--le-text-muted)" }}>Stage</span>
              <span className="le-eyebrow font-medium" style={{ color: "var(--le-text-muted)" }}>Provider</span>
              <span className="le-eyebrow text-right font-medium" style={{ color: "var(--le-text-muted)" }}>Scene</span>
              <span className="le-eyebrow text-right font-medium" style={{ color: "var(--le-text-muted)" }}>Units</span>
              <span className="le-eyebrow text-right font-medium" style={{ color: "var(--le-text-muted)" }}>Cost</span>
            </div>
            {costEvents.map((ev) => {
              const sceneNum = ev.scene_id ? scenes.find((s) => s.id === ev.scene_id)?.scene_number ?? "—" : "—";
              const unitsLabel =
                ev.units_consumed != null
                  ? `${Math.round(ev.units_consumed).toLocaleString()} ${ev.unit_type ?? ""}`.trim()
                  : "—";
              return (
                <div
                  key={ev.id}
                  className="grid grid-cols-[1.2fr_1fr_0.6fr_1fr_1fr] items-center gap-6 px-6 py-3 text-xs"
                  style={{ borderBottom: "1px solid var(--le-border)" }}
                >
                  <span className="capitalize">{ev.stage}</span>
                  <span className="tabular">{ev.provider}</span>
                  <span className="tabular text-right" style={{ color: "var(--le-text-muted)" }}>{sceneNum}</span>
                  <span className="tabular text-right">{unitsLabel}</span>
                  <span className="tabular text-right font-semibold">{formatCents(ev.cost_cents)}</span>
                </div>
              );
            })}
            <div className="grid grid-cols-[1.2fr_1fr_0.6fr_1fr_1fr] gap-6 px-6 py-5">
              <span className="le-eyebrow font-semibold" style={{ color: "var(--le-text)" }}>Total</span>
              <span /> <span /> <span />
              <span className="tabular text-right text-base font-semibold">{formatCents(costTotalCents)}</span>
            </div>
          </DashboardCard>
        </section>
      )}

      {/* Section tabs */}
      <div style={{ borderBottom: "1px solid var(--le-border)", marginBottom: 40, display: "flex", gap: 0 }}>
        {(["photos", "shots", "logs", "prompts"] as const).map((tab) => {
          const labels: Record<string, string> = { photos: `Photos · ${photos.length}`, shots: `Shot plan · ${scenes.length}`, logs: "Timeline", prompts: "System prompts" };
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); if (tab === "prompts") loadPrompts(); }}
              style={{ padding: "12px 20px", fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 500, color: active ? "var(--le-text)" : "var(--le-text-muted)", background: "none", border: "none", borderBottom: active ? "1px solid var(--le-text)" : "1px solid transparent", cursor: "pointer", marginBottom: -1 }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {activeTab === "photos" && (
        <div style={{ marginTop: 40 }}>
          {photos.length === 0 ? (
            <p className="py-16 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No photos</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <DashboardCard
                  key={photo.id}
                  padding="none"
                  style={photo.selected ? undefined : { opacity: 0.7 }}
                >
                  <div className="relative aspect-[4/3] overflow-hidden rounded-t-[14px]" style={{ background: "var(--le-bg-sunken)" }}>
                    <img src={photo.file_url} alt={photo.file_name} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute left-2 top-2">
                      <StatusPill tone={photo.selected ? "success" : "danger"}>
                        {photo.selected ? "Selected" : "Discarded"}
                      </StatusPill>
                    </span>
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-center justify-between">
                      <span className="label" style={{ color: "var(--le-text)" }}>{photo.room_type?.replace(/_/g, " ") ?? "—"}</span>
                      <span className="tabular text-[10px]" style={{ color: "var(--le-text-muted)" }}>depth {photo.depth_rating ?? "—"}</span>
                    </div>
                    <div className="tabular flex gap-3 text-[10px]" style={{ color: "var(--le-text-muted)" }}>
                      <span>Q {photo.quality_score ?? "—"}</span>
                      <span>A {photo.aesthetic_score ?? "—"}</span>
                      {photo.video_viable === true && (
                        <span style={{ color: "var(--le-success)" }}>✓ video</span>
                      )}
                      {photo.video_viable === false && (
                        <span style={{ color: "var(--le-danger)" }}>✕ video</span>
                      )}
                    </div>
                    {photo.video_viable && photo.suggested_motion && (
                      <p className="text-[10px] leading-tight" style={{ color: "var(--le-text-muted)" }}>
                        <span className="tabular" style={{ color: "var(--le-text)" }}>{photo.suggested_motion.replace(/_/g, " ")}</span>
                        {photo.motion_rationale && <span> · {photo.motion_rationale}</span>}
                      </p>
                    )}
                    {photo.key_features && photo.key_features.length > 0 && (
                      <ul className="space-y-0.5 text-[10px] leading-tight" style={{ color: "var(--le-text-muted)" }}>
                        {photo.key_features.map((f, i) => (
                          <li key={i} className="flex gap-1">
                            <span style={{ color: "var(--le-text-muted)", opacity: 0.4 }}>·</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {photo.composition && (
                      <p className="border-t pt-2 text-[10px] italic leading-snug" style={{ borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}>
                        {photo.composition}
                      </p>
                    )}
                    {!photo.selected && photo.discard_reason && (
                      <p className="border-t pt-2 text-[11px] leading-snug" style={{ borderColor: "var(--le-border)", color: "var(--le-danger)" }}>
                        {photo.discard_reason}
                      </p>
                    )}
                  </div>
                </DashboardCard>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "shots" && (
        <div style={{ marginTop: 40 }}>
          {scenes.length === 0 ? (
            <p className="py-16 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No scenes yet</p>
          ) : (
            <div className="grid gap-4">
              {scenes.map((scene) => {
                const sourcePhoto = photoById.get(scene.photo_id);
                return (
                  <DashboardCard key={scene.id}>
                    <div className="flex items-start gap-4">
                      {sourcePhoto ? (
                        <img src={sourcePhoto.file_url} alt={sourcePhoto.file_name} className="h-16 w-24 shrink-0 rounded-[8px] object-cover" />
                      ) : (
                        <div className="h-16 w-24 shrink-0 rounded-[8px]" style={{ background: "var(--le-bg-sunken)" }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="tabular text-sm font-semibold">#{scene.scene_number}</span>
                          <span className="text-xs font-medium capitalize">{scene.camera_movement?.replace(/_/g, " ")}</span>
                          <StatusPill status={scene.status?.replace(/ /g, "_")} />
                          {scene.provider && (
                            <span className="label" style={{ color: "var(--le-text-muted)" }}>{scene.provider}</span>
                          )}
                        </div>
                        <p className="tabular mt-1 text-[10px]" style={{ color: "var(--le-text-muted)" }}>
                          source: {sourcePhoto?.file_name ?? "—"} · {sourcePhoto?.room_type?.replace(/_/g, " ") ?? "—"}
                        </p>
                      </div>
                    </div>

                    {/* Prompt */}
                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="label" style={{ color: "var(--le-text-muted)" }}>Prompt sent to {scene.provider ?? "provider"}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyPrompt(scene.id, scene.prompt)}
                          className="label inline-flex items-center gap-1 transition-colors"
                          style={{ color: "var(--le-text-muted)" }}
                        >
                          {copiedScene === scene.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copiedScene === scene.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <pre
                        className="whitespace-pre-wrap rounded-[8px] p-4 text-[11px] leading-relaxed"
                        style={{ background: "var(--le-bg-sunken)", border: "1px solid var(--le-border)", fontFamily: "var(--le-font-mono)", fontSize: 11 }}
                      >
                        {scene.prompt}
                      </pre>
                    </div>

                    {/* Metadata */}
                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-5 md:grid-cols-3 lg:grid-cols-6" style={{ borderColor: "var(--le-border)" }}>
                      {[
                        { l: "Duration", v: `${scene.duration_seconds}s` },
                        { l: "Attempts", v: scene.attempt_count ?? 0 },
                        { l: "Gen time", v: scene.generation_time_ms ? formatDuration(scene.generation_time_ms) : "—" },
                        { l: "Cost", v: scene.generation_cost_cents ? formatCents(scene.generation_cost_cents) : "—" },
                        { l: "QC verdict", v: scene.qc_verdict ?? "—" },
                        { l: "QC confidence", v: scene.qc_confidence != null ? `${Math.round(scene.qc_confidence * 100)}%` : "—" },
                      ].map((m) => (
                        <div key={m.l}>
                          <p className="label" style={{ color: "var(--le-text-muted)" }}>{m.l}</p>
                          <p className="tabular mt-1.5 text-xs">{m.v}</p>
                        </div>
                      ))}
                    </div>

                    {/* Output clip */}
                    {scene.clip_url && (
                      <div className="mt-5">
                        <span className="label" style={{ color: "var(--le-text-muted)" }}>Output clip</span>
                        <video
                          src={scene.clip_url}
                          controls
                          playsInline
                          preload="metadata"
                          className="mt-3 aspect-video w-full max-w-md rounded-[8px] bg-black"
                        />
                      </div>
                    )}

                    {(scene.status === "needs_review" ||
                      scene.status === "qc_hard_reject" ||
                      scene.status === "qc_soft_reject" ||
                      scene.status === "failed" ||
                      scene.status === "pending") && (
                      <ResubmitControls scene={scene} />
                    )}
                  </DashboardCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "logs" && (
        <div style={{ marginTop: 40 }}>
          <DashboardCard padding="none">
            {logs.length === 0 ? (
              <p className="py-16 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No logs for this property</p>
            ) : (
              <>
                <div className="divide-y" style={{ borderColor: "var(--le-border)" }}>
                  {logs.slice(0, logsVisible).map((log) => (
                    <div
                      key={log.id}
                      className="grid grid-cols-[80px_90px_60px_1fr] items-start gap-4 px-5 py-2.5 text-[11px] leading-relaxed"
                      style={{ fontFamily: "var(--le-font-mono)", borderColor: "var(--le-border)" }}
                    >
                      <span className="tabular" style={{ color: "var(--le-text-muted)", opacity: 0.6 }}>
                        {new Date(log.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span className="label" style={{ color: "var(--le-text-muted)" }}>{log.stage}</span>
                      <span
                        className="label"
                        style={{
                          color:
                            log.level === "error"
                              ? "var(--le-danger)"
                              : log.level === "warn"
                              ? "var(--le-warn)"
                              : "var(--le-text-muted)",
                        }}
                      >
                        {log.level}
                      </span>
                      <span
                        style={{
                          color:
                            log.level === "error"
                              ? "var(--le-danger)"
                              : log.level === "warn"
                              ? "var(--le-warn)"
                              : "var(--le-text)",
                        }}
                      >
                        {log.message}
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <span className="ml-2" style={{ color: "var(--le-text-muted)" }}>{JSON.stringify(log.metadata)}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {logsVisible < logs.length && (
                  <div className="border-t px-5 py-3" style={{ borderColor: "var(--le-border)" }}>
                    <DashboardButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogsVisible((v) => v + LOG_PAGE_SIZE)}
                    >
                      View {Math.min(LOG_PAGE_SIZE, logs.length - logsVisible)} more ({logs.length - logsVisible} remaining)
                    </DashboardButton>
                  </div>
                )}
              </>
            )}
          </DashboardCard>
        </div>
      )}

      {activeTab === "prompts" && (
        <div style={{ marginTop: 40 }} className="space-y-6">
          {!prompts ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
            </div>
          ) : (
            [
              { label: "Photo analysis", desc: "Used by Claude Sonnet to score every photo on quality, aesthetics, depth, and room type.", body: prompts.analysis },
              { label: "Director (shot planning)", desc: "Used to turn selected photos into an ordered shot list.", body: prompts.director },
              { label: "QC evaluator", desc: "Used to judge generated clips. Currently auto-passing pending frame-extraction infra.", body: prompts.qc },
            ].map((p) => (
              <DashboardCard key={p.label}>
                <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>— {p.label}</span>
                <h3 style={{ marginTop: 12, fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}>{p.label}</h3>
                <p className="mt-2 text-xs" style={{ color: "var(--le-text-muted)" }}>{p.desc}</p>
                <pre
                  className="mt-6 max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-[8px] p-5 text-[11px] leading-relaxed"
                  style={{ background: "var(--le-bg-sunken)", border: "1px solid var(--le-border)", fontFamily: "var(--le-font-mono)", fontSize: 11 }}
                >
                  {p.body}
                </pre>
              </DashboardCard>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default PropertyDetail;
