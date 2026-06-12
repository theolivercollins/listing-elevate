import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import "@/v2/styles/v2.css";
import { Download, RotateCcw, Copy, Check, Loader2, AlertTriangle, Star, ArrowLeft } from "lucide-react";
import { formatCents, formatDuration } from "@/lib/types";
import type { Property, Photo, Scene, PipelineLog, CostEvent, SceneRating } from "@/lib/types";
import { fetchProperty, fetchLogs, rerunProperty, fetchSystemPrompts, rateScene, resubmitScene } from "@/lib/api";
import { PageHeading, StatusChip, Card, SectionTitle } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

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
    <div
      style={{
        borderTop: "1px solid var(--line-2)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hoverValue ?? rating) >= n;
            return (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHoverValue(n)}
                onMouseLeave={() => setHoverValue(null)}
                onClick={() => clickStar(n)}
                style={{ padding: 2, background: "none", border: "none", cursor: "pointer", lineHeight: 0 }}
                aria-label={`${n} star`}
              >
                <Star
                  style={{
                    width: 14,
                    height: 14,
                    fill: filled ? "var(--ink)" : "none",
                    color: filled ? "var(--ink)" : "rgba(11,11,16,0.25)",
                    strokeWidth: 1.5,
                  }}
                />
              </button>
            );
          })}
          {rating > 0 && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                color: "var(--muted)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {rating}/5
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite", color: "var(--muted)" }} />}
          {justSaved && <Check style={{ width: 12, height: 12, color: "var(--good)" }} />}
          {rating > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontSize: 11,
                color: "var(--muted)",
                cursor: "pointer",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              Add note
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={commentBlur}
            placeholder={rating <= 2 ? "What went wrong? (required for low ratings)" : "What worked? (optional)"}
            rows={2}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "var(--le-font-sans)",
              color: "var(--ink)",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              resize: "vertical",
              outline: "none",
              lineHeight: 1.5,
              boxSizing: "border-box",
            }}
          />
          {rating > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {availableTags.map((tag) => {
                const selected = tags.includes(tag);
                const isFail = FAILURE_TAGS.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 500,
                      borderRadius: "var(--radius-pill)",
                      border: selected ? "none" : "1px solid var(--line)",
                      background: selected
                        ? isFail
                          ? "var(--bad)"
                          : "var(--ink)"
                        : "transparent",
                      color: selected ? "#fff" : "var(--muted)",
                      cursor: "pointer",
                      fontFamily: "var(--le-font-sans)",
                      transition: "background .15s, color .15s",
                    }}
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

  const rsBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    fontSize: 11.5,
    fontWeight: 500,
    background: "transparent",
    color: "var(--ink-2)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "var(--le-font-sans)",
  };

  return (
    <div
      style={{
        marginTop: 16,
        paddingTop: 14,
        borderTop: "1px solid var(--line-2)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span className="le-d-label">Admin actions</span>
      <button
        type="button"
        style={{ ...rsBtn, cursor: busy !== null ? "not-allowed" : "pointer", opacity: busy !== null ? 0.5 : 1 }}
        disabled={busy !== null}
        onClick={() => call(() => resubmitScene(scene.id), "auto")}
      >
        {busy === "auto"
          ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
          : <RotateCcw style={{ width: 13, height: 13 }} />}
        Resubmit
      </button>
      <button
        type="button"
        style={{ ...rsBtn, cursor: busy !== null ? "not-allowed" : "pointer", opacity: busy !== null ? 0.5 : 1 }}
        disabled={busy !== null}
        onClick={() => call(() => resubmitScene(scene.id, { provider: other }), "other")}
      >
        {busy === "other"
          ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
          : <RotateCcw style={{ width: 13, height: 13 }} />}
        Try {other}
      </button>
      <button
        type="button"
        style={{ ...rsBtn, cursor: busy !== null ? "not-allowed" : "pointer", opacity: busy !== null ? 0.5 : 1 }}
        disabled={busy !== null}
        onClick={async () => {
          const next = window.prompt("Edit prompt then resubmit:", scene.prompt);
          if (!next || !next.trim() || next.trim() === scene.prompt) return;
          await call(() => resubmitScene(scene.id, { prompt: next.trim() }), "edit");
        }}
      >
        <RotateCcw style={{ width: 13, height: 13 }} /> Edit + resubmit
      </button>
      {message && (
        <span
          style={{
            fontSize: 12,
            color:
              kind === "error"
                ? "var(--bad)"
                : kind === "warn"
                ? "var(--warn)"
                : "var(--muted)",
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
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Loader2 style={{ width: 20, height: 20, animation: "spin 1s linear infinite", color: "var(--muted)" }} />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div
        style={{
          padding: 32,
          borderRadius: "var(--radius)",
          background: "rgba(196,74,74,0.05)",
          border: "1px solid rgba(196,74,74,0.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "rgba(196,74,74,0.10)",
              display: "grid",
              placeItems: "center",
              color: "var(--bad)",
              flexShrink: 0,
            }}
          >
            <AlertTriangle style={{ width: 18, height: 18 }} strokeWidth={1.5} />
          </div>
          <div>
            <span className="le-d-label" style={{ color: "var(--bad)" }}>Error</span>
            <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted)" }}>{error || "Property not found"}</p>
          </div>
        </div>
      </div>
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

  const subLine = [
    `$${property.price.toLocaleString()}`,
    `${property.bedrooms}bd`,
    `${property.bathrooms}ba`,
    property.listing_agent,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Page heading */}
      <PageHeading
        eyebrow="Listing"
        title={property.address}
        sub={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <StatusChip status={property.status} />
            {isPolling && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--good)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--good)",
                    animation: "le-pulse 1.6s ease-in-out infinite",
                    display: "inline-block",
                  }}
                />
                Live
              </span>
            )}
            <span style={{ color: "var(--muted)" }}>{subLine}</span>
          </span>
        }
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              to="/dashboard/properties"
              className="le-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
            >
              <ArrowLeft style={{ width: 13, height: 13 }} />
              Properties
            </Link>
            <button
              type="button"
              onClick={handleRerun}
              disabled={rerunning}
              className="le-btn-dark"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: rerunning ? 0.5 : 1,
                cursor: rerunning ? "not-allowed" : "pointer",
              }}
            >
              <RotateCcw style={{ width: 13, height: 13, ...(rerunning ? { animation: "spin 1s linear infinite" } : {}) }} />
              Rerun
            </button>
          </div>
        }
      />

      {/* Hero photo (when available) */}
      {primaryPhoto && (
        <div style={{ borderRadius: 14, overflow: "hidden", background: "#000" }}>
          <img
            src={primaryPhoto.file_url}
            alt={primaryPhoto.file_name || property.address}
            style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block", filter: "brightness(0.85) saturate(1.05)" }}
          />
        </div>
      )}

      {/* Stat strip */}
      <Card padding={0}>
        <div className="le-cols-2-lg le-stack-sm" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[
            { label: "Total cost", value: formatCents(property.total_cost_cents) },
            { label: "Processing time", value: property.processing_time_ms > 0 ? formatDuration(property.processing_time_ms) : "—" },
            { label: "Photos", value: `${property.selected_photo_count} / ${property.photo_count}` },
            { label: "Clips delivered", value: `${deliverables.length} / ${scenes.length}` },
          ].map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: "18px 24px",
                borderRight: i < 3 ? "1px solid var(--line-2)" : "none",
              }}
            >
              <span className="le-d-label">{s.label}</span>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "var(--ink)",
                  marginTop: 6,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Deliverables */}
      {deliverables.length > 0 && (
        <Card padding={24}>
          <SectionTitle
            eyebrow="Deliverables"
            title={`${deliverables.length} ${deliverables.length === 1 ? "clip" : "clips"} ready`}
          />
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            {deliverables.map((scene) => (
              <div
                key={scene.id}
                style={{
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  overflow: "hidden",
                }}
              >
                {/* Video frame */}
                <div style={{ borderRadius: 0, overflow: "hidden", background: "#000" }}>
                  <video src={scene.clip_url!} controls playsInline preload="metadata" style={{ width: "100%", aspectRatio: "16/9", display: "block" }} />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      Scene {scene.scene_number} · {scene.camera_movement.replace(/_/g, " ")}
                    </p>
                    <p
                      style={{
                        marginTop: 3,
                        fontSize: 11,
                        color: "var(--muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {scene.provider ?? "—"} · {scene.duration_seconds}s
                    </p>
                  </div>
                  <a
                    href={scene.clip_url!}
                    download={`scene_${scene.scene_number}.mp4`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 32,
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      color: "var(--ink-2)",
                      flexShrink: 0,
                    }}
                  >
                    <Download style={{ width: 13, height: 13 }} />
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
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cost breakdown */}
      {costEvents.length > 0 && (
        <Card padding={24}>
          <SectionTitle
            eyebrow="Costs"
            title={<>Real per-call breakdown <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {formatCents(costTotalCents)}</span></>}
          />
          <div className="le-table-scroll is-mid" style={{ marginTop: 16 }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 0.6fr 1fr 1fr",
                gap: 16,
                padding: "8px 14px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span className="le-d-label">Stage</span>
              <span className="le-d-label">Provider</span>
              <span className="le-d-label" style={{ textAlign: "right" }}>Scene</span>
              <span className="le-d-label" style={{ textAlign: "right" }}>Units</span>
              <span className="le-d-label" style={{ textAlign: "right" }}>Cost</span>
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
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 0.6fr 1fr 1fr",
                    gap: 16,
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--line-2)",
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                    alignItems: "center",
                  }}
                >
                  <span style={{ textTransform: "capitalize" }}>{ev.stage}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{ev.provider}</span>
                  <span style={{ textAlign: "right", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{sceneNum}</span>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{unitsLabel}</span>
                  <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatCents(ev.cost_cents)}</span>
                </div>
              );
            })}
            {/* Total row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 0.6fr 1fr 1fr",
                gap: 16,
                padding: "14px 14px",
              }}
            >
              <span className="le-d-label" style={{ color: "var(--ink)" }}>Total</span>
              <span /><span /><span />
              <span
                style={{
                  textAlign: "right",
                  fontSize: 15,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink)",
                }}
              >
                {formatCents(costTotalCents)}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Section tabs */}
      <Card padding={0}>
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "1px solid var(--line-2)",
          }}
        >
          {(["photos", "shots", "logs", "prompts"] as const).map((tab) => {
            const labels: Record<string, string> = {
              photos: `Photos · ${photos.length}`,
              shots: `Shot plan · ${scenes.length}`,
              logs: "Timeline",
              prompts: "System prompts",
            };
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => { setActiveTab(tab); if (tab === "prompts") loadPrompts(); }}
                style={{
                  padding: "12px 18px",
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink)" : "var(--muted)",
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid var(--ink)" : "2px solid transparent",
                  cursor: "pointer",
                  marginBottom: -1,
                  fontFamily: "var(--le-font-sans)",
                  transition: "color .15s",
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === "photos" && (
          <div style={{ padding: 20 }}>
            {photos.length === 0 ? (
              <p style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No photos</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                {photos.map((photo) => (
                  <div
                    key={photo.id}
                    style={{
                      border: `1px solid ${photo.selected ? "rgba(11,11,16,0.18)" : "var(--line)"}`,
                      borderRadius: "var(--radius-sm)",
                      overflow: "hidden",
                      opacity: photo.selected ? 1 : 0.65,
                    }}
                  >
                    <div style={{ position: "relative", aspectRatio: "4/3", background: "var(--bg)" }}>
                      <img
                        src={photo.file_url}
                        alt={photo.file_name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        loading="lazy"
                      />
                      <span
                        style={{
                          position: "absolute",
                          top: 8,
                          left: 8,
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: "var(--radius-pill)",
                          background: photo.selected ? "var(--ink)" : "var(--bad)",
                          color: "#fff",
                        }}
                      >
                        {photo.selected ? "Selected" : "Discarded"}
                      </span>
                    </div>
                    <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink)" }}>
                          {photo.room_type?.replace(/_/g, " ") ?? "—"}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                          depth {photo.depth_rating ?? "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                        <span>Q {photo.quality_score ?? "—"}</span>
                        <span>A {photo.aesthetic_score ?? "—"}</span>
                        {photo.video_viable === true && (
                          <span style={{ color: "var(--good)" }}>video ok</span>
                        )}
                        {photo.video_viable === false && (
                          <span style={{ color: "var(--bad)" }}>no video</span>
                        )}
                      </div>
                      {photo.video_viable && photo.suggested_motion && (
                        <p style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4 }}>
                          <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>
                            {photo.suggested_motion.replace(/_/g, " ")}
                          </span>
                          {photo.motion_rationale && <span> · {photo.motion_rationale}</span>}
                        </p>
                      )}
                      {photo.key_features && photo.key_features.length > 0 && (
                        <ul style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4, margin: 0, padding: 0, listStyle: "none" }}>
                          {photo.key_features.map((f, i) => (
                            <li key={i} style={{ display: "flex", gap: 4 }}>
                              <span style={{ color: "var(--line)" }}>·</span>
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {photo.composition && (
                        <p
                          style={{
                            paddingTop: 6,
                            borderTop: "1px solid var(--line-2)",
                            fontSize: 10,
                            fontStyle: "italic",
                            color: "var(--muted)",
                            lineHeight: 1.4,
                          }}
                        >
                          {photo.composition}
                        </p>
                      )}
                      {!photo.selected && photo.discard_reason && (
                        <p
                          style={{
                            paddingTop: 6,
                            borderTop: "1px solid var(--line-2)",
                            fontSize: 11,
                            color: "var(--bad)",
                            lineHeight: 1.4,
                          }}
                        >
                          {photo.discard_reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "shots" && (
          <div style={{ padding: 20 }}>
            {scenes.length === 0 ? (
              <p style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No scenes yet</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {scenes.map((scene) => {
                  const sourcePhoto = photoById.get(scene.photo_id);
                  return (
                    <div
                      key={scene.id}
                      style={{
                        padding: 20,
                        borderBottom: "1px solid var(--line-2)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                        {/* Thumb — 60px as per spec */}
                        <div
                          style={{
                            width: 80,
                            height: 60,
                            borderRadius: 8,
                            overflow: "hidden",
                            flexShrink: 0,
                            background: sourcePhoto ? undefined : "var(--bg)",
                            border: "1px solid var(--line-2)",
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {sourcePhoto ? (
                            <img
                              src={sourcePhoto.file_url}
                              alt={sourcePhoto.file_name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                background: `linear-gradient(135deg, hsl(220, 10%, 78%), hsl(250, 10%, 62%))`,
                                display: "grid",
                                placeItems: "center",
                              }}
                            />
                          )}
                          {/* Play icon overlay */}
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "grid",
                              placeItems: "center",
                              background: "rgba(0,0,0,0.25)",
                            }}
                          >
                            <Icon name="play" size={14} style={{ color: "#fff" }} />
                          </div>
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "var(--ink)",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              #{scene.scene_number}
                            </span>
                            <span style={{ fontSize: 12.5, fontWeight: 500, textTransform: "capitalize", color: "var(--ink-2)" }}>
                              {scene.camera_movement?.replace(/_/g, " ")}
                            </span>
                            <StatusChip status={scene.status ?? "queued"} />
                            {scene.provider && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: "2px 8px",
                                  borderRadius: "var(--radius-pill)",
                                  background: "rgba(11,11,16,0.05)",
                                  color: "var(--muted)",
                                }}
                              >
                                {scene.provider}
                              </span>
                            )}
                          </div>
                          <p style={{ marginTop: 3, fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                            source: {sourcePhoto?.file_name ?? "—"} · {sourcePhoto?.room_type?.replace(/_/g, " ") ?? "—"}
                          </p>
                        </div>
                      </div>

                      {/* Prompt */}
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <span className="le-d-label">Prompt → {scene.provider ?? "provider"}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyPrompt(scene.id, scene.prompt)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--muted)",
                              cursor: "pointer",
                              fontFamily: "var(--le-font-sans)",
                            }}
                          >
                            {copiedScene === scene.id ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                            {copiedScene === scene.id ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            padding: "12px 14px",
                            fontSize: 11,
                            lineHeight: 1.6,
                            fontFamily: "var(--le-font-mono, monospace)",
                            color: "var(--ink-2)",
                            background: "rgba(11,11,16,0.025)",
                            border: "1px solid var(--line-2)",
                            borderRadius: 8,
                          }}
                        >
                          {scene.prompt}
                        </pre>
                      </div>

                      {/* Metadata grid */}
                      <div
                        className="le-cols-3-lg le-cols-2-sm"
                        style={{
                          marginTop: 16,
                          paddingTop: 16,
                          borderTop: "1px solid var(--line-2)",
                          display: "grid",
                          gridTemplateColumns: "repeat(6, 1fr)",
                          gap: "12px 20px",
                        }}
                      >
                        {[
                          { l: "Duration", v: `${scene.duration_seconds}s` },
                          { l: "Attempts", v: scene.attempt_count ?? 0 },
                          { l: "Gen time", v: scene.generation_time_ms ? formatDuration(scene.generation_time_ms) : "—" },
                          { l: "Cost", v: scene.generation_cost_cents ? formatCents(scene.generation_cost_cents) : "—" },
                          { l: "QC verdict", v: scene.qc_verdict ?? "—" },
                          { l: "QC confidence", v: scene.qc_confidence != null ? `${Math.round(scene.qc_confidence * 100)}%` : "—" },
                        ].map((m) => (
                          <div key={m.l}>
                            <p className="le-d-label">{m.l}</p>
                            <p style={{ marginTop: 4, fontSize: 12.5, fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}>{m.v}</p>
                          </div>
                        ))}
                      </div>

                      {/* Output clip */}
                      {scene.clip_url && (
                        <div style={{ marginTop: 16 }}>
                          <span className="le-d-label">Output clip</span>
                          <div style={{ marginTop: 8, borderRadius: 10, overflow: "hidden", background: "#000", maxWidth: 420 }}>
                            <video
                              src={scene.clip_url}
                              controls
                              playsInline
                              preload="metadata"
                              style={{ width: "100%", aspectRatio: "16/9", display: "block" }}
                            />
                          </div>
                        </div>
                      )}

                      {(scene.status === "needs_review" ||
                        scene.status === "qc_hard_reject" ||
                        scene.status === "qc_soft_reject" ||
                        scene.status === "failed" ||
                        scene.status === "pending") && (
                        <ResubmitControls scene={scene} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "logs" && (
          <div style={{ padding: 0, maxHeight: 640, overflowY: "auto" }}>
            {logs.length === 0 ? (
              <p style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
                No logs for this property
              </p>
            ) : (
              <div>
                {logs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 90px 60px 1fr",
                      alignItems: "flex-start",
                      gap: 16,
                      padding: "8px 20px",
                      borderBottom: "1px solid var(--line-2)",
                      fontSize: 11,
                      lineHeight: 1.6,
                      fontFamily: "var(--le-font-mono, monospace)",
                    }}
                  >
                    <span style={{ color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>
                      {new Date(log.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span style={{ color: "var(--muted)" }}>{log.stage}</span>
                    <span
                      style={{
                        color:
                          log.level === "error"
                            ? "var(--bad)"
                            : log.level === "warn"
                            ? "var(--warn)"
                            : "var(--muted)",
                      }}
                    >
                      {log.level}
                    </span>
                    <span
                      style={{
                        color:
                          log.level === "error"
                            ? "var(--bad)"
                            : log.level === "warn"
                            ? "var(--warn)"
                            : "var(--ink-2)",
                      }}
                    >
                      {log.message}
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <span style={{ marginLeft: 8, color: "var(--muted)" }}>{JSON.stringify(log.metadata)}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "prompts" && (
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
            {!prompts ? (
              <div style={{ display: "flex", justifyContent: "center", padding: "32px 0" }}>
                <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite", color: "var(--muted)" }} />
              </div>
            ) : (
              [
                { label: "Photo analysis", desc: "Used by Claude Sonnet to score every photo on quality, aesthetics, depth, and room type.", body: prompts.analysis },
                { label: "Director (shot planning)", desc: "Used to turn selected photos into an ordered shot list.", body: prompts.director },
                { label: "QC evaluator", desc: "Used to judge generated clips. Currently auto-passing pending frame-extraction infra.", body: prompts.qc },
              ].map((p) => (
                <section key={p.label}>
                  <SectionTitle eyebrow={p.label} title={p.label} />
                  <p style={{ marginTop: 6, fontSize: 12.5, color: "var(--muted)" }}>{p.desc}</p>
                  <pre
                    style={{
                      marginTop: 12,
                      maxHeight: 480,
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      padding: "14px 16px",
                      fontSize: 11,
                      lineHeight: 1.6,
                      fontFamily: "var(--le-font-mono, monospace)",
                      color: "var(--ink-2)",
                      background: "rgba(11,11,16,0.025)",
                      border: "1px solid var(--line-2)",
                      borderRadius: 8,
                    }}
                  >
                    {p.body}
                  </pre>
                </section>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default PropertyDetail;
