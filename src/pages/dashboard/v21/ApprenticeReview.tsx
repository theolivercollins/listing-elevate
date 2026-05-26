// ApprenticeReview.tsx — V2 Lab: Apprentice Review mode
// Same 3-column + filmstrip layout as Director's Cut.
// Operator reviews apprentice-predicted labels: Agree (SPACE) or Disagree (X).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprenticePrediction, PairCandidate, PickerFeatures, PickerPrediction, Verdict, TransitionTag } from "../../../../lib/gen2-v21/types.js";

// ─── local types ──────────────────────────────────────────────────────────────

interface QueueItem {
  candidate: PairCandidate;
  apprentice: ApprenticePrediction;
  picker: PickerPrediction | null;
  photo_a_url: string;
  photo_b_url: string;
  thumbnail_hash_a: string;
  thumbnail_hash_b: string;
  scene_graph_version: string;
  /** Pre-computed by pair-queue server — passed back on label submit for picker training. */
  features_blob: PickerFeatures | null;
}

interface ApprenticeReviewProps {
  listingId: string;
  onLabelPosted?: () => void;
}

// ─── inline style constants ───────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: "var(--radius)",
  border: "1px solid var(--line)",
  overflow: "hidden",
};

const BTN_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "11px 22px",
  borderRadius: "var(--radius-pill)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "var(--le-font-sans)",
  border: "none",
  transition: "opacity .15s, transform .1s",
  letterSpacing: "-0.01em",
};

const AGREE_BTN: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--good, #2f8a55)",
  color: "#fff",
  minWidth: 160,
};

const DISAGREE_BTN: React.CSSProperties = {
  ...BTN_BASE,
  background: "rgba(196,74,74,0.1)",
  color: "var(--bad, #c44a4a)",
  border: "1px solid rgba(196,74,74,0.25)",
  minWidth: 160,
};

const GHOST_BTN: React.CSSProperties = {
  ...BTN_BASE,
  background: "transparent",
  color: "var(--ink-2)",
  border: "1px solid var(--line)",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "var(--muted)",
  fontFamily: "var(--le-font-sans)",
};

const MONO: React.CSSProperties = {
  fontFamily: "var(--le-font-sans)",
  fontSize: 12,
  color: "var(--ink-2)",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function verdictColor(v: Verdict): string {
  if (v === "good") return "var(--good, #2f8a55)";
  if (v === "bad") return "var(--bad, #c44a4a)";
  return "var(--warn, #b6802c)";
}

function verdictLabel(v: Verdict): string {
  if (v === "good") return "GOOD pair";
  if (v === "bad") return "BAD pair";
  return "TIE";
}

function confidencePct(c: number): string {
  return Math.round(c * 100) + "%";
}

function tagLabel(t: TransitionTag): string {
  if (!t) return "none";
  return t.replace(/_/g, " ");
}

function featureLabel(name: string): string {
  return name.replace(/_/g, " ");
}

// Simple inline spinner
function Spinner() {
  return (
    <svg
      width={20}
      height={20}
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

// Photo panel
function PhotoPane({
  label,
  url,
  hash,
}: {
  label: string;
  url: string;
  hash: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
      <div style={LABEL_STYLE}>{label}</div>
      <div
        style={{
          ...CARD,
          aspectRatio: "4/3",
          overflow: "hidden",
          background: "rgba(11,11,16,0.04)",
          position: "relative",
        }}
      >
        {url ? (
          <img
            src={url}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            No preview
          </div>
        )}
      </div>
      <div style={{ ...MONO, fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        hash: {hash}
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function ApprenticeReview({ listingId, onLabelPosted }: ApprenticeReviewProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disagreeOpen, setDisagreeOpen] = useState(false);
  const [disagreeReason, setDisagreeReason] = useState("");
  const [filmActive, setFilmActive] = useState<number>(0);
  const disagreeRef = useRef<HTMLTextAreaElement>(null);

  // ── load queue on mount ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/gen2/lab/pair-queue?listingId=${encodeURIComponent(listingId)}&limit=20&mode=apprentice_review`,
        );
        if (!res.ok) throw new Error(`pair-queue ${res.status}`);
        const json = await res.json() as { items: QueueItem[] };
        if (!cancelled) {
          setQueue(json.items ?? []);
          setCursor(0);
          setFilmActive(0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [listingId]);

  // keep filmstrip in sync with cursor
  useEffect(() => {
    setFilmActive(cursor);
  }, [cursor]);

  const current = queue[cursor] ?? null;

  // ── post label ───────────────────────────────────────────────────
  const postLabel = useCallback(
    async (apprenticeWasWrong: boolean, reason?: string) => {
      if (!current || posting) return;
      setPosting(true);
      setError(null);
      try {
        const app = current.apprentice;
        const flippedVerdict: Verdict =
          apprenticeWasWrong
            ? app.predicted_verdict === "good"
              ? "bad"
              : app.predicted_verdict === "bad"
              ? "good"
              : "tie"
            : app.predicted_verdict;

        const body = {
          candidate_id: current.candidate.candidate_id,
          listing_id: listingId,
          photo_a_id: current.candidate.photo_a_id,
          photo_b_id: current.candidate.photo_b_id,
          scene_graph_version: current.scene_graph_version,
          model_version_at_prediction: current.picker?.model_version ?? null,
          model_prediction_at_time: current.picker?.score ?? null,
          operator_verdict: flippedVerdict,
          transition_tag: app.predicted_transition_tag,
          thumbnail_hash_a: current.thumbnail_hash_a,
          thumbnail_hash_b: current.thumbnail_hash_b,
          source_mode: "apprentice_review",
          apprentice_predicted_verdict: app.predicted_verdict,
          apprentice_was_wrong: apprenticeWasWrong,
          disagree_reason: reason ?? null,
          // picker training data — pre-computed by pair-queue server
          features_blob: current.features_blob ?? null,
        };

        const res = await fetch("/api/gen2/lab/pair-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`pair-label ${res.status}`);

        onLabelPosted?.();
        const next = cursor + 1;
        setCursor(next);
        setFilmActive(next);
        setDisagreeOpen(false);
        setDisagreeReason("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPosting(false);
      }
    },
    [current, cursor, listingId, onLabelPosted, posting],
  );

  // ── keyboard handler ─────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // skip if focused in a textarea
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLInputElement) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (!disagreeOpen) postLabel(false);
      }
      if (e.code === "KeyX") {
        e.preventDefault();
        if (!disagreeOpen) {
          setDisagreeOpen(true);
          setTimeout(() => disagreeRef.current?.focus(), 40);
        }
      }
      if (e.code === "Escape" && disagreeOpen) {
        setDisagreeOpen(false);
        setDisagreeReason("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disagreeOpen, postLabel]);

  // ── disagree textarea Enter to submit ────────────────────────────
  function onDisagreeKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      postLabel(true, disagreeReason);
    }
    if (e.key === "Escape") {
      setDisagreeOpen(false);
      setDisagreeReason("");
    }
  }

  // ─── render: loading ─────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", gap: 12 }}>
        <Spinner />
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading pair queue…</span>
      </div>
    );
  }

  // ─── render: queue empty ─────────────────────────────────────────
  if (!current) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 0",
          gap: 12,
          textAlign: "center",
        }}
      >
        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="var(--good, #2f8a55)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
          {queue.length === 0 ? "No pairs awaiting review" : `All ${queue.length} pairs reviewed`}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {queue.length > 0
            ? "Great work. Reload to fetch a fresh batch."
            : "The Apprentice hasn't predicted any pairs yet, or all pairs are already labeled."}
        </div>
      </div>
    );
  }

  const app = current.apprentice;
  const picker = current.picker;

  // ─── render: main UI ─────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(196,74,74,0.3)",
            background: "rgba(196,74,74,0.05)",
            fontSize: 13,
            color: "var(--bad, #c44a4a)",
          }}
        >
          {error}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, height: 3, background: "var(--line)", borderRadius: 99, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, (cursor / Math.max(1, queue.length)) * 100)}%`,
              background: "var(--accent, #4f6ef7)",
              borderRadius: 99,
              transition: "width .3s ease",
            }}
          />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {cursor + 1} / {queue.length}
        </span>
      </div>

      {/* 3-column layout: left photo | center | right photo */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px 1fr", gap: 16, alignItems: "start" }}>

        {/* LEFT: Photo A */}
        <PhotoPane
          label="Photo A · start frame"
          url={current.photo_a_url}
          hash={current.thumbnail_hash_a}
        />

        {/* CENTER: apprentice reasoning + picker score + action */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Apprentice verdict card */}
          <div style={{ ...CARD, padding: 16 }}>
            <div style={LABEL_STYLE}>Apprentice says</div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px",
                  borderRadius: 99,
                  fontSize: 11.5,
                  fontWeight: 700,
                  fontFamily: "var(--le-font-sans)",
                  background: app.predicted_verdict === "good"
                    ? "rgba(47,138,85,0.12)"
                    : app.predicted_verdict === "bad"
                    ? "rgba(196,74,74,0.1)"
                    : "rgba(182,128,44,0.1)",
                  color: verdictColor(app.predicted_verdict),
                }}
              >
                {app.predicted_verdict === "good" ? "✓" : app.predicted_verdict === "bad" ? "✗" : "~"}{" "}
                {verdictLabel(app.predicted_verdict)}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--muted)",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                type={tagLabel(app.predicted_transition_tag)}, {confidencePct(app.confidence)} confident
              </span>
            </div>

            {/* Reasoning */}
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(11,11,16,0.03)",
                border: "1px solid var(--line-2, var(--line))",
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                fontStyle: "italic",
                fontFamily: "var(--le-font-sans)",
              }}
            >
              "{app.reasoning}"
            </div>

            {/* Few-shot references */}
            {app.few_shot_label_ids.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                Based on {app.few_shot_label_ids.length} prior label{app.few_shot_label_ids.length === 1 ? "" : "s"}
              </div>
            )}
          </div>

          {/* Picker score card (runs in parallel — training signal) */}
          <div style={{ ...CARD, padding: 14 }}>
            <div style={LABEL_STYLE}>ML Picker score (training signal)</div>
            {picker ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--ink)",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {Math.round(picker.score * 100)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>/ 100 · {confidencePct(picker.confidence)} conf</span>
                </div>

                {picker.used_fallback_heuristic && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "var(--warn, #b6802c)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Heuristic fallback (cold start)
                  </div>
                )}

                {picker.top_3_features.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                    {picker.top_3_features.map((f, i) => (
                      <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 10.5, color: "var(--muted)", width: 130, flexShrink: 0 }}>
                          {i + 1}. {featureLabel(f.name)}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            background: "var(--line)",
                            borderRadius: 99,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.min(100, Math.round(f.weight * 100))}%`,
                              background: "var(--accent, #4f6ef7)",
                              borderRadius: 99,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", width: 30, textAlign: "right" }}>
                          {Math.round(f.weight * 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted)" }}>
                Picker not yet available for this pair
              </div>
            )}
          </div>

          {/* Candidate meta */}
          <div style={{ ...CARD, padding: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Candidate type</span>
                <span style={{ ...MONO, fontWeight: 600 }}>{current.candidate.candidate_type.replace(/_/g, " ")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Heuristic score</span>
                <span style={{ ...MONO }}>{Math.round(current.candidate.heuristic_score * 100)} / 100</span>
              </div>
              {current.candidate.portal_id && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>Portal</span>
                  <span style={{ ...MONO, fontSize: 11 }}>{current.candidate.portal_id}</span>
                </div>
              )}
            </div>
            {current.candidate.reasoning && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
                {current.candidate.reasoning}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              style={{ ...AGREE_BTN, opacity: posting ? 0.5 : 1 }}
              disabled={posting || disagreeOpen}
              onClick={() => postLabel(false)}
            >
              {posting ? <Spinner /> : (
                <>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Agree
                </>
              )}
              <kbd
                style={{
                  marginLeft: 6,
                  fontSize: 10.5,
                  fontFamily: "var(--le-font-sans)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.2)",
                  letterSpacing: "0.02em",
                }}
              >
                SPACE
              </kbd>
            </button>

            {!disagreeOpen ? (
              <button
                type="button"
                style={{ ...DISAGREE_BTN, opacity: posting ? 0.5 : 1 }}
                disabled={posting}
                onClick={() => {
                  setDisagreeOpen(true);
                  setTimeout(() => disagreeRef.current?.focus(), 40);
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Disagree
                <kbd
                  style={{
                    marginLeft: 6,
                    fontSize: 10.5,
                    fontFamily: "var(--le-font-sans)",
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(196,74,74,0.15)",
                    letterSpacing: "0.02em",
                  }}
                >
                  X
                </kbd>
              </button>
            ) : (
              <div
                style={{
                  ...CARD,
                  padding: 12,
                  border: "1px solid rgba(196,74,74,0.3)",
                  background: "rgba(196,74,74,0.03)",
                }}
              >
                <div style={{ fontSize: 11.5, color: "var(--bad, #c44a4a)", marginBottom: 6, fontWeight: 600 }}>
                  Why disagree? (optional — press Enter to submit, Esc to cancel)
                </div>
                <textarea
                  ref={disagreeRef}
                  value={disagreeReason}
                  onChange={(e) => setDisagreeReason(e.target.value)}
                  onKeyDown={onDisagreeKeyDown}
                  placeholder="e.g. wrong room, bad angle, already seen this pair…"
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(196,74,74,0.3)",
                    background: "var(--surface)",
                    fontSize: 12.5,
                    fontFamily: "var(--le-font-sans)",
                    color: "var(--ink)",
                    outline: "none",
                    resize: "none",
                    boxSizing: "border-box",
                    lineHeight: 1.5,
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    style={{ ...GHOST_BTN, padding: "7px 12px", fontSize: 12 }}
                    onClick={() => {
                      setDisagreeOpen(false);
                      setDisagreeReason("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={{ ...DISAGREE_BTN, padding: "7px 14px", fontSize: 12, opacity: posting ? 0.5 : 1 }}
                    disabled={posting}
                    onClick={() => postLabel(true, disagreeReason)}
                  >
                    Submit disagree
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Photo B */}
        <PhotoPane
          label="Photo B · end frame"
          url={current.photo_b_url}
          hash={current.thumbnail_hash_b}
        />
      </div>

      {/* Filmstrip */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 4,
          paddingTop: 4,
        }}
      >
        {queue.map((item, idx) => {
          const isPast = idx < cursor;
          const isCurrent = idx === cursor;
          const isFuture = idx > cursor;
          return (
            <button
              key={item.candidate.candidate_id}
              type="button"
              onClick={() => {
                setCursor(idx);
                setFilmActive(idx);
                setDisagreeOpen(false);
                setDisagreeReason("");
              }}
              style={{
                flexShrink: 0,
                width: 52,
                height: 39,
                borderRadius: "var(--radius-sm)",
                border: isCurrent
                  ? "2px solid var(--accent, #4f6ef7)"
                  : isPast
                  ? "2px solid var(--good, #2f8a55)"
                  : "1px solid var(--line)",
                overflow: "hidden",
                padding: 0,
                cursor: "pointer",
                background: "rgba(11,11,16,0.04)",
                opacity: isFuture ? 0.5 : 1,
                position: "relative",
              }}
              title={`Pair ${idx + 1}: ${item.candidate.candidate_type}`}
            >
              {item.photo_a_url && (
                <img
                  src={item.photo_a_url}
                  alt={`pair ${idx + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              )}
              {isPast && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(47,138,85,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Keyboard hint */}
      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
        <kbd style={{ fontFamily: "var(--le-font-sans)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--line)", marginRight: 3 }}>SPACE</kbd> Agree ·{" "}
        <kbd style={{ fontFamily: "var(--le-font-sans)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--line)", marginRight: 3 }}>X</kbd> Disagree ·{" "}
        <kbd style={{ fontFamily: "var(--le-font-sans)", padding: "1px 6px", borderRadius: 4, border: "1px solid var(--line)", marginRight: 3 }}>ESC</kbd> Cancel disagree
      </div>
    </div>
  );
}
