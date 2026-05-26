// ApprenticeReview.tsx — V2 Lab: Apprentice Review mode
// Same 3-column + filmstrip layout as Director's Cut.
// Operator reviews apprentice-predicted labels: Agree (SPACE) or Disagree (X).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprenticePrediction, PairCandidate, PickerFeatures, PickerPrediction, Verdict, TransitionTag } from "../../../../lib/gen2-v21/types.js";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

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
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-2 w-full" />
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 300px 1fr" }}>
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ─── render: queue empty ─────────────────────────────────────────
  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div className="w-12 h-12 rounded-2xl bg-[rgba(47,138,85,0.1)] grid place-items-center text-[var(--good)]">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-[var(--ink)]">
          {queue.length === 0 ? "No pairs awaiting review" : `All ${queue.length} pairs reviewed`}
        </div>
        <div className="text-xs text-[var(--muted)] max-w-xs">
          {queue.length > 0
            ? "Great work. Reload to fetch a fresh batch."
            : "The Apprentice hasn't predicted any pairs yet, or all pairs are already labeled."}
        </div>
      </div>
    );
  }

  const app = current.apprentice;
  const picker = current.picker;
  const progressPct = Math.min(100, Math.round((cursor / Math.max(1, queue.length)) * 100));

  // ─── render: main UI ─────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 rounded-xl border border-[rgba(196,74,74,0.3)] bg-[rgba(196,74,74,0.05)] text-sm text-[var(--bad)]">
          {error}
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-3">
        <Progress value={progressPct} className="flex-1 h-1" />
        <span className="text-[11px] text-[var(--muted)] tabular-nums whitespace-nowrap">
          {cursor + 1} / {queue.length}
        </span>
      </div>

      {/* Confidence pill at top */}
      <div className="flex items-center justify-center gap-2">
        <Badge
          className="text-xs font-bold px-3 py-1 gap-1.5"
          style={{
            background:
              app.predicted_verdict === "good"
                ? "rgba(47,138,85,0.12)"
                : app.predicted_verdict === "bad"
                ? "rgba(196,74,74,0.1)"
                : "rgba(182,128,44,0.1)",
            color: verdictColor(app.predicted_verdict),
            border: "none",
          }}
        >
          {app.predicted_verdict === "good" ? "✓" : app.predicted_verdict === "bad" ? "✗" : "~"}
          {verdictLabel(app.predicted_verdict)}
        </Badge>
        <span className="text-xs text-[var(--muted)]">
          {confidencePct(app.confidence)} confidence · {tagLabel(app.predicted_transition_tag)}
        </span>
      </div>

      {/* 3-column layout: left photo | center | right photo */}
      <div className="grid gap-4 items-start" style={{ gridTemplateColumns: "1fr 300px 1fr" }}>

        {/* LEFT: Photo A */}
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
            Photo A · start frame
          </div>
          <div className="rounded-xl overflow-hidden aspect-[4/3] bg-black/[0.04] relative">
            {current.photo_a_url ? (
              <img
                src={current.photo_a_url}
                alt="Photo A"
                className="w-full h-full object-cover block"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--muted)]">
                No preview
              </div>
            )}
          </div>
          <div className="text-[10px] text-[var(--muted)] truncate tabular-nums">
            hash: {current.thumbnail_hash_a}
          </div>
        </div>

        {/* CENTER: apprentice reasoning + picker score + actions */}
        <div className="flex flex-col gap-3">

          {/* Apprentice reasoning card */}
          <Card className="border-[var(--line)] bg-[var(--surface)]">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                Apprentice says
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4 flex flex-col gap-2">
              <div
                className="px-3 py-2.5 rounded-lg text-xs italic leading-relaxed text-[var(--ink-2)]"
                style={{ background: "rgba(11,11,16,0.03)", border: "1px solid var(--line)" }}
              >
                "{app.reasoning}"
              </div>
              {app.few_shot_label_ids.length > 0 && (
                <div className="text-[10.5px] text-[var(--muted)]">
                  Based on {app.few_shot_label_ids.length} prior label{app.few_shot_label_ids.length === 1 ? "" : "s"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Picker score card */}
          <Card className="border-[var(--line)] bg-[var(--surface)]">
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                ML Picker score
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {picker ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-[var(--ink)] tabular-nums tracking-tight">
                      {Math.round(picker.score * 100)}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      / 100 · {confidencePct(picker.confidence)} conf
                    </span>
                  </div>
                  {picker.used_fallback_heuristic && (
                    <Badge className="self-start text-[10.5px]" style={{ background: "rgba(182,128,44,0.12)", color: "var(--warn)", border: "none" }}>
                      Heuristic fallback
                    </Badge>
                  )}
                  {picker.top_3_features.length > 0 && (
                    <div className="flex flex-col gap-1.5 mt-1">
                      {picker.top_3_features.map((f, i) => (
                        <div key={f.name} className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--muted)] w-28 flex-shrink-0 truncate">
                            {i + 1}. {featureLabel(f.name)}
                          </span>
                          <div className="flex-1 h-1 bg-[var(--line)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--accent)]"
                              style={{ width: `${Math.min(100, Math.round(f.weight * 100))}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[var(--muted)] tabular-nums w-6 text-right">
                            {Math.round(f.weight * 100)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[var(--muted)]">
                  Picker not yet available for this pair
                </div>
              )}
            </CardContent>
          </Card>

          {/* Candidate meta */}
          <Card className="border-[var(--line)] bg-[var(--surface)]">
            <CardContent className="px-4 py-3 flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-[10.5px] text-[var(--muted)]">Candidate type</span>
                <span className="text-[11px] font-semibold text-[var(--ink)]">
                  {current.candidate.candidate_type.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[10.5px] text-[var(--muted)]">Heuristic score</span>
                <span className="text-[11px] tabular-nums text-[var(--ink-2)]">
                  {Math.round(current.candidate.heuristic_score * 100)} / 100
                </span>
              </div>
              {current.candidate.portal_id && (
                <div className="flex justify-between">
                  <span className="text-[10.5px] text-[var(--muted)]">Portal</span>
                  <span className="text-[10.5px] text-[var(--ink-2)]">{current.candidate.portal_id}</span>
                </div>
              )}
              {current.candidate.reasoning && (
                <div className="text-[11px] text-[var(--ink-2)] leading-relaxed mt-1">
                  {current.candidate.reasoning}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5">
            <Button
              size="lg"
              className="w-full gap-2 text-sm font-bold"
              disabled={posting || disagreeOpen}
              onClick={() => postLabel(false)}
              style={{
                background: "var(--good)",
                color: "#fff",
                border: "none",
                opacity: posting ? 0.5 : 1,
              }}
            >
              {posting ? (
                <svg className="animate-spin" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                </svg>
              ) : (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              Agree
              <kbd className="text-[10px] font-bold opacity-75 bg-white/20 rounded px-1.5 py-0.5">
                SPACE
              </kbd>
            </Button>

            {!disagreeOpen ? (
              <Button
                size="lg"
                variant="outline"
                className="w-full gap-2 text-sm font-semibold"
                disabled={posting}
                onClick={() => {
                  setDisagreeOpen(true);
                  setTimeout(() => disagreeRef.current?.focus(), 40);
                }}
                style={{
                  background: "rgba(196,74,74,0.07)",
                  color: "var(--bad)",
                  border: "1px solid rgba(196,74,74,0.25)",
                  opacity: posting ? 0.5 : 1,
                }}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Disagree
                <kbd className="text-[10px] font-bold opacity-70 bg-[rgba(196,74,74,0.15)] rounded px-1.5 py-0.5">
                  X
                </kbd>
              </Button>
            ) : (
              <div className="rounded-xl border border-[rgba(196,74,74,0.3)] bg-[rgba(196,74,74,0.03)] p-3 flex flex-col gap-2">
                <div className="text-[11.5px] font-semibold text-[var(--bad)]">
                  Why disagree? (optional — Enter to submit, Esc to cancel)
                </div>
                <Textarea
                  ref={disagreeRef}
                  value={disagreeReason}
                  onChange={(e) => setDisagreeReason(e.target.value)}
                  onKeyDown={onDisagreeKeyDown}
                  placeholder="e.g. wrong room, bad angle, already seen this pair…"
                  rows={2}
                  className="resize-none text-sm border-[rgba(196,74,74,0.3)] focus-visible:ring-[rgba(196,74,74,0.4)]"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDisagreeOpen(false);
                      setDisagreeReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={posting}
                    onClick={() => postLabel(true, disagreeReason)}
                    style={{ background: "var(--bad)", color: "#fff", border: "none" }}
                  >
                    Submit disagree
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Keyboard hint */}
          <div className="text-[10.5px] text-[var(--muted)] text-center">
            <kbd className="border border-[var(--line)] rounded px-1.5 py-0.5 mr-1">SPACE</kbd> Agree ·{" "}
            <kbd className="border border-[var(--line)] rounded px-1.5 py-0.5 mr-1">X</kbd> Disagree ·{" "}
            <kbd className="border border-[var(--line)] rounded px-1.5 py-0.5 mr-1">ESC</kbd> Cancel
          </div>
        </div>

        {/* RIGHT: Photo B */}
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
            Photo B · end frame
          </div>
          <div className="rounded-xl overflow-hidden aspect-[4/3] bg-black/[0.04] relative">
            {current.photo_b_url ? (
              <img
                src={current.photo_b_url}
                alt="Photo B"
                className="w-full h-full object-cover block"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--muted)]">
                No preview
              </div>
            )}
          </div>
          <div className="text-[10px] text-[var(--muted)] truncate tabular-nums">
            hash: {current.thumbnail_hash_b}
          </div>
        </div>
      </div>

      {/* Filmstrip */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 pt-1"
        style={{ scrollbarWidth: "none" }}
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
              className="flex-shrink-0 rounded-lg overflow-hidden relative transition-all"
              style={{
                width: 56,
                height: 42,
                border: isCurrent
                  ? "2.5px solid var(--accent)"
                  : isPast
                  ? "2px solid var(--good)"
                  : "1px solid var(--line)",
                padding: 0,
                cursor: "pointer",
                background: "rgba(11,11,16,0.04)",
                opacity: isFuture ? 0.45 : 1,
              }}
              title={`Pair ${idx + 1}: ${item.candidate.candidate_type}`}
            >
              {item.photo_a_url && (
                <img
                  src={item.photo_a_url}
                  alt={`pair ${idx + 1}`}
                  className="w-full h-full object-cover block"
                />
              )}
              {isPast && (
                <div className="absolute inset-0 bg-[rgba(47,138,85,0.35)] flex items-center justify-center">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
}
