import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { authedFetch } from "@/lib/api";
import type {
  Verdict,
  TransitionTag,
  PickerPrediction,
  ApprenticePrediction,
  PickerFeatures,
} from "../../../../lib/gen2-v21/types";

// ─── API shapes ──────────────────────────────────────────────────────────────

interface QueueItem {
  candidate_id: string;
  listing_id: string;
  photo_a_id: string;
  photo_b_id: string;
  photo_a_url: string;
  photo_b_url: string;
  candidate_type: string;
  heuristic_score: number;
  reasoning: string;
  picker_prediction: PickerPrediction | null;
  apprentice_prediction: ApprenticePrediction | null;
  /** Pre-computed by pair-queue server — passed back on label submit for picker training. */
  features_blob: PickerFeatures | null;
  /** Scene graph model version at queue time — required by pair-label API. */
  scene_graph_version: string;
}

interface PairQueueResponse {
  items: QueueItem[];
  total_remaining: number;
  listing_name: string;
  total_labels_for_property: number;
  offset: number;
}

interface FilmstripPhoto {
  photo_id: string;
  url: string;
  rejected?: boolean;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function sha256Hex(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return "hash-unavailable";
    const buf = await res.arrayBuffer();
    const hashBuf = await crypto.subtle.digest("SHA-256", buf);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex;
  } catch {
    return "hash-unavailable";
  }
}

const TRANSITION_TAGS: Array<{ tag: TransitionTag; label: string; key: string }> = [
  { tag: "push_in",       label: "Push-in",      key: "1" },
  { tag: "walk_through",  label: "Walk-through",  key: "2" },
  { tag: "reveal",        label: "Reveal",        key: "3" },
  { tag: "orbit",         label: "Orbit",         key: "4" },
  { tag: "drone_descent", label: "Drone-descent", key: "5" },
];

function Spinner() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth={2}
      strokeLinecap="round"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ─── FeatureBar — a single feature-weight row ─────────────────────────────────

function FeatureBar({ name, weight }: { name: string; weight: number }) {
  const pct = Math.min(Math.abs(weight) / 0.6, 1) * 100;
  const positive = weight >= 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.01em" }}>
          {name}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontVariantNumeric: "tabular-nums",
            color: positive ? "var(--good)" : "var(--bad)",
            fontWeight: 600,
          }}
        >
          {weight >= 0 ? "+" : ""}
          {weight.toFixed(2)}
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 99,
          background: "rgba(11,11,16,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 99,
            background: positive ? "var(--good)" : "var(--bad)",
            transition: "width 0.35s ease",
          }}
        />
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function DirectorsCutLab() {
  const [searchParams] = useSearchParams();
  const listingId = searchParams.get("listingId") ?? "";

  // queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOffset, setQueueOffset] = useState(0);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [listingName, setListingName] = useState("");
  const [totalLabels, setTotalLabels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // current pair
  const [currentIdx, setCurrentIdx] = useState(0);
  const [overridePhotoB, setOverridePhotoB] = useState<FilmstripPhoto | null>(null);

  // hashes — computed when pair changes
  const [hashA, setHashA] = useState<string>("computing");
  const [hashB, setHashB] = useState<string>("computing");

  // labeling state
  const [selectedTag, setSelectedTag] = useState<TransitionTag>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejectedCandidateIds, setRejectedCandidateIds] = useState<Set<string>>(new Set());

  // filmstrip
  const [filmstripPhotos, setFilmstripPhotos] = useState<FilmstripPhoto[]>([]);
  const filmstripRef = useRef<HTMLDivElement>(null);

  const currentItem = queue[currentIdx] ?? null;

  // ── fetch queue ─────────────────────────────────────────────────────────────

  const fetchQueue = useCallback(
    async (offset: number, append: boolean) => {
      if (!listingId) return;
      const isFetchingMore = append;
      if (isFetchingMore) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await authedFetch(
          `/api/gen2/lab/pair-queue?listingId=${listingId}&limit=20&mode=directors_cut&offset=${offset}`
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Queue fetch failed ${res.status}: ${text || res.statusText}`);
        }
        const data: PairQueueResponse = await res.json();
        setListingName(data.listing_name ?? "");
        setTotalLabels(data.total_labels_for_property ?? 0);
        setTotalRemaining(data.total_remaining ?? 0);
        setQueueOffset(offset + data.items.length);

        if (append) {
          setQueue((prev) => [...prev, ...data.items]);
        } else {
          setQueue(data.items);
          setCurrentIdx(0);
          setOverridePhotoB(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (isFetchingMore) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [listingId]
  );

  useEffect(() => {
    fetchQueue(0, false);
  }, [fetchQueue]);

  // ── build filmstrip when item changes ───────────────────────────────────────

  useEffect(() => {
    if (!currentItem) {
      setFilmstripPhotos([]);
      return;
    }
    // We don't have a full property photo list from the queue endpoint,
    // so we derive a filmstrip from all OTHER candidates in the queue
    // (any photo_b that isn't already photo_a or current photo_b).
    const seen = new Set<string>([currentItem.photo_a_id, currentItem.photo_b_id]);
    const strips: FilmstripPhoto[] = [];
    for (const item of queue) {
      if (!seen.has(item.photo_b_id)) {
        seen.add(item.photo_b_id);
        strips.push({
          photo_id: item.photo_b_id,
          url: item.photo_b_url,
          rejected: rejectedCandidateIds.has(item.candidate_id),
        });
      }
      if (!seen.has(item.photo_a_id)) {
        seen.add(item.photo_a_id);
        strips.push({
          photo_id: item.photo_a_id,
          url: item.photo_a_url,
          rejected: rejectedCandidateIds.has(item.candidate_id),
        });
      }
    }
    setFilmstripPhotos(strips);
  }, [currentItem, queue, rejectedCandidateIds]);

  // ── compute hashes when pair changes ────────────────────────────────────────

  useEffect(() => {
    if (!currentItem) return;
    setHashA("computing");
    setHashB("computing");

    const photoAUrl = currentItem.photo_a_url;
    const photoBUrl = overridePhotoB ? overridePhotoB.url : currentItem.photo_b_url;

    let cancelled = false;
    (async () => {
      const [hA, hB] = await Promise.all([
        sha256Hex(photoAUrl),
        sha256Hex(photoBUrl),
      ]);
      if (!cancelled) {
        setHashA(hA);
        setHashB(hB);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentItem, overridePhotoB]);

  // ── submit label ─────────────────────────────────────────────────────────────

  const submitLabel = useCallback(
    async (verdict: Verdict) => {
      if (!currentItem || submitting) return;
      setSubmitting(true);

      const photoBId = overridePhotoB ? overridePhotoB.photo_id : currentItem.photo_b_id;

      const payload = {
        candidate_id: currentItem.candidate_id,
        listing_id: currentItem.listing_id,
        photo_a_id: currentItem.photo_a_id,
        photo_b_id: photoBId,
        verdict,
        transition_tag: selectedTag,
        thumbnail_hash_a: hashA,
        thumbnail_hash_b: hashB,
        model_prediction_at_time:
          currentItem.picker_prediction?.score ?? null,
        model_version_at_prediction:
          currentItem.picker_prediction?.model_version ?? null,
        source_mode: "directors_cut" as const,
        apprentice_predicted_verdict:
          currentItem.apprentice_prediction?.predicted_verdict ?? null,
        override_photo_b: overridePhotoB ? true : undefined,
        // picker training data — pre-computed by pair-queue server
        features_blob: currentItem.features_blob ?? null,
        scene_graph_version: currentItem.scene_graph_version,
      };

      try {
        const res = await authedFetch("/api/gen2/lab/pair-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(`Label POST failed ${res.status}: ${text}`);
        }

        if (verdict === "bad") {
          setRejectedCandidateIds((prev) => new Set([...prev, currentItem.candidate_id]));
        }

        setTotalLabels((n) => n + 1);
        setSelectedTag(null);
        setOverridePhotoB(null);

        // advance
        const nextIdx = currentIdx + 1;
        if (nextIdx < queue.length) {
          setCurrentIdx(nextIdx);
        } else {
          // fetch more if available
          if (totalRemaining > queueOffset) {
            await fetchQueue(queueOffset, true);
            setCurrentIdx(nextIdx);
          } else {
            setCurrentIdx(nextIdx); // will hit null → empty state
          }
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      currentItem,
      submitting,
      overridePhotoB,
      selectedTag,
      hashA,
      hashB,
      currentIdx,
      queue.length,
      totalRemaining,
      queueOffset,
      fetchQueue,
    ]
  );

  // ── keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // ignore when typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        submitLabel("good");
        return;
      }

      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        submitLabel("bad");
        return;
      }

      const tagEntry = TRANSITION_TAGS.find((t) => t.key === e.key);
      if (tagEntry) {
        e.preventDefault();
        setSelectedTag((prev) => (prev === tagEntry.tag ? null : tagEntry.tag));
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [submitLabel]);

  // ── derived display values ───────────────────────────────────────────────────

  const pickerPred = currentItem?.picker_prediction ?? null;
  const apprenticePred = currentItem?.apprentice_prediction ?? null;

  const confidencePct = pickerPred
    ? Math.round(pickerPred.confidence * 100)
    : null;
  const usedHeuristic = pickerPred?.used_fallback_heuristic ?? true;

  const photoBDisplay = overridePhotoB
    ? overridePhotoB.url
    : currentItem?.photo_b_url ?? "";

  // ── render: loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Spinner />
        <span style={{ fontSize: 13, color: "var(--muted)", fontFamily: "var(--le-font-sans)" }}>
          Loading pair queue…
        </span>
      </div>
    );
  }

  // ── render: error ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 12,
          fontFamily: "var(--le-font-sans)",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderRadius: "var(--radius)",
            border: "1px solid rgba(196,74,74,0.3)",
            background: "rgba(196,74,74,0.05)",
            fontSize: 13,
            color: "var(--bad)",
            maxWidth: 480,
            textAlign: "center",
          }}
        >
          {error}
        </div>
        <button
          type="button"
          className="le-btn-ghost"
          onClick={() => fetchQueue(0, false)}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── render: queue empty ──────────────────────────────────────────────────────

  if (!currentItem) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          fontFamily: "var(--le-font-sans)",
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: "rgba(47,138,85,0.10)",
            display: "grid",
            placeItems: "center",
            color: "var(--good)",
          }}
        >
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
          Queue complete
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {totalLabels} label{totalLabels !== 1 ? "s" : ""} recorded for this property.
        </div>
        <button
          type="button"
          className="le-btn-dark"
          onClick={() => fetchQueue(0, false)}
        >
          Refresh queue
        </button>
      </div>
    );
  }

  // ── render: main ─────────────────────────────────────────────────────────────

  return (
    <div
      className="le-fade-up"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--canvas)",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 20px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {listingName || listingId || "Unknown property"}
          </span>
          <span style={{ color: "var(--line)", fontSize: 12 }}>·</span>
          <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
            {totalLabels} label{totalLabels !== 1 ? "s" : ""}
          </span>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 99,
            background: "rgba(11,11,16,0.07)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "var(--ink-2)",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          <svg width={9} height={9} viewBox="0 0 10 10" fill="currentColor">
            <circle cx={5} cy={5} r={5} />
          </svg>
          Director's Cut
        </div>

        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {currentIdx + 1} / {Math.max(queue.length, currentIdx + 1)}
          {loadingMore && (
            <span style={{ marginLeft: 6 }}>
              <Spinner />
            </span>
          )}
        </div>
      </div>

      {/* ── Main canvas: 40 / 20 / 40 ───────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "40% 20% 40%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left: photo_a */}
        <div
          style={{
            background: "#0a0a0a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <img
            key={currentItem.photo_a_url}
            src={currentItem.photo_a_url}
            alt="Photo A"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: 12,
              fontSize: 10.5,
              color: "rgba(255,255,255,0.55)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            A · Start frame
          </div>
        </div>

        {/* Center column */}
        <div
          style={{
            background: "var(--surface)",
            borderLeft: "1px solid var(--line)",
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            padding: "16px 14px",
            gap: 16,
            overflowY: "auto",
          }}
        >
          {/* ML confidence */}
          <div
            style={{
              background: "rgba(11,11,16,0.04)",
              borderRadius: "var(--radius)",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "var(--muted)",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
              }}
            >
              ML Confidence
            </div>

            {confidencePct !== null && !usedHeuristic ? (
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: "var(--ink)",
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.02em",
                }}
              >
                {confidencePct}%
              </div>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  background: "rgba(182,128,44,0.12)",
                  color: "var(--warn)",
                  alignSelf: "flex-start",
                }}
              >
                Heuristic
              </span>
            )}

            {/* Top-3 feature weights */}
            {pickerPred && pickerPred.top_3_features.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
                {pickerPred.top_3_features.map((f) => (
                  <FeatureBar
                    key={f.name as string}
                    name={f.name as string}
                    weight={f.weight}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Apprentice prediction (informational only) */}
          {apprenticePred && (
            <div
              style={{
                borderRadius: "var(--radius)",
                border: "1px solid var(--line)",
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--ink-2)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  marginBottom: 5,
                }}
              >
                Apprentice
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 15,
                    lineHeight: 1,
                    color:
                      apprenticePred.predicted_verdict === "good"
                        ? "var(--good)"
                        : apprenticePred.predicted_verdict === "bad"
                        ? "var(--bad)"
                        : "var(--muted)",
                  }}
                >
                  {apprenticePred.predicted_verdict === "good"
                    ? "✓"
                    : apprenticePred.predicted_verdict === "bad"
                    ? "✗"
                    : "~"}
                </span>
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                  {apprenticePred.predicted_verdict}
                </span>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                  ({Math.round(apprenticePred.confidence * 100)}%)
                </span>
              </div>
            </div>
          )}

          {/* Transition tags */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "var(--muted)",
                letterSpacing: "0.07em",
                textTransform: "uppercase",
              }}
            >
              Transition tag
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {TRANSITION_TAGS.map((t) => {
                const active = selectedTag === t.tag;
                return (
                  <button
                    key={t.tag}
                    type="button"
                    onClick={() => setSelectedTag((prev) => (prev === t.tag ? null : t.tag))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      borderRadius: "var(--radius-sm)",
                      border: active
                        ? "1px solid var(--accent)"
                        : "1px solid var(--line)",
                      background: active
                        ? "rgba(var(--accent-rgb, 14,96,253),0.07)"
                        : "transparent",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: active ? 600 : 400,
                      color: active ? "var(--ink)" : "var(--ink-2)",
                      fontFamily: "var(--le-font-sans)",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <span>{t.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: active ? "var(--accent)" : "var(--muted)",
                        background: "rgba(11,11,16,0.05)",
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {t.key}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              disabled={submitting}
              onClick={() => submitLabel("good")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "11px 0",
                borderRadius: "var(--radius)",
                border: "none",
                background: submitting
                  ? "rgba(47,138,85,0.3)"
                  : "var(--good)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "var(--le-font-sans)",
                transition: "opacity 0.15s",
                letterSpacing: "0.01em",
              }}
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Confirm
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  opacity: 0.75,
                  background: "rgba(255,255,255,0.18)",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                SPACE
              </span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => submitLabel("bad")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "11px 0",
                borderRadius: "var(--radius)",
                border: "none",
                background: submitting
                  ? "rgba(196,74,74,0.3)"
                  : "var(--bad)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "var(--le-font-sans)",
                transition: "opacity 0.15s",
                letterSpacing: "0.01em",
              }}
            >
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1={18} y1={6} x2={6} y2={18} />
                <line x1={6} y1={6} x2={18} y2={18} />
              </svg>
              Reject
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  opacity: 0.75,
                  background: "rgba(255,255,255,0.18)",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                X
              </span>
            </button>
          </div>

          {/* Keyboard hint */}
          <div
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            SPACE confirm · X reject
            <br />
            1–5 tag · click filmstrip to swap B
          </div>
        </div>

        {/* Right: photo_b */}
        <div
          style={{
            background: "#0a0a0a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {photoBDisplay && (
            <img
              key={photoBDisplay}
              src={photoBDisplay}
              alt="Photo B"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          )}
          {overridePhotoB && (
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                fontSize: 10.5,
                color: "rgba(255,255,255,0.85)",
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                background: "rgba(14,96,253,0.7)",
                borderRadius: 6,
                padding: "3px 8px",
                pointerEvents: "none",
              }}
            >
              Override
            </div>
          )}
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 12,
              fontSize: 10.5,
              color: "rgba(255,255,255,0.55)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              pointerEvents: "none",
            }}
          >
            B · End frame
          </div>
        </div>
      </div>

      {/* ── Filmstrip ────────────────────────────────────────────────────────── */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--line)",
          background: "#111",
          height: 80,
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <div
          ref={filmstripRef}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "0 12px",
            overflowX: "auto",
            height: "100%",
            scrollbarWidth: "none",
          }}
        >
          {filmstripPhotos.map((photo) => {
            const isCurrentB =
              overridePhotoB
                ? overridePhotoB.photo_id === photo.photo_id
                : currentItem.photo_b_id === photo.photo_id;

            return (
              <button
                key={photo.photo_id}
                type="button"
                onClick={() => {
                  if (photo.photo_id === currentItem.photo_a_id) return; // can't override with photo_a
                  setOverridePhotoB(
                    isCurrentB ? null : { photo_id: photo.photo_id, url: photo.url }
                  );
                }}
                title={photo.rejected ? "Previously rejected" : undefined}
                style={{
                  flexShrink: 0,
                  width: 60,
                  height: 60,
                  borderRadius: 6,
                  border: isCurrentB
                    ? "2px solid var(--accent, #0e60fd)"
                    : "2px solid transparent",
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  background: "none",
                  position: "relative",
                  opacity: photo.rejected ? 0.6 : 1,
                  transition: "border-color 0.15s, opacity 0.15s",
                }}
              >
                <img
                  src={photo.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                {photo.rejected && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(196,74,74,0.45)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
                      <line x1={18} y1={6} x2={6} y2={18} />
                      <line x1={6} y1={6} x2={18} y2={18} />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
          {filmstripPhotos.length === 0 && (
            <span
              style={{
                fontSize: 11.5,
                color: "rgba(255,255,255,0.3)",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              No other candidates in queue
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
