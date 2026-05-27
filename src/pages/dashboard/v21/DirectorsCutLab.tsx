import React, { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/api";
import type {
  Verdict,
  TransitionTag,
  PickerPrediction,
  ApprenticePrediction,
  PickerFeatures,
} from "../../../../lib/gen2-v21/types";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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
  already_labeled_count: number;
  all_property_photos: Array<{ id: string; url: string }>;
  offset: number;
}

interface FilmstripPhoto {
  photo_id: string;
  url: string;
  rejected?: boolean;
}

interface ObservabilityData {
  total_labels: number;
  labels_by_property: Record<string, number>;
  rolling_accuracy?: { last_20: number | null; last_50: number | null; last_100: number | null };
}

interface DirectorsCutLabProps {
  listingId: string;
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

// ─── FeatureBar ───────────────────────────────────────────────────────────────

function FeatureBar({ name, weight }: { name: string; weight: number }) {
  const pct = Math.min(Math.abs(weight) / 0.6, 1) * 100;
  const positive = weight >= 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-[var(--muted)] tracking-wide">{name}</span>
        <span
          className="text-[11px] font-semibold tabular-nums"
          style={{ color: positive ? "var(--good)" : "var(--bad)" }}
        >
          {weight >= 0 ? "+" : ""}
          {weight.toFixed(2)}
        </span>
      </div>
      <div className="h-1 rounded-full bg-black/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: positive ? "var(--good)" : "var(--bad)",
          }}
        />
      </div>
    </div>
  );
}

// ─── ProgressStrip ────────────────────────────────────────────────────────────

interface ProgressStripProps {
  currentIdx: number;
  queueLength: number;
  totalLabelsForProperty: number;
  observability: ObservabilityData | null;
  listingId: string;
}

function ProgressStrip({
  currentIdx,
  queueLength,
  totalLabelsForProperty,
  observability,
  listingId,
}: ProgressStripProps) {
  const pairX = currentIdx + 1;
  const pairY = Math.max(queueLength, pairX);
  const queuePct = pairY > 0 ? Math.round((pairX / pairY) * 100) : 0;

  const todayLabels = observability?.labels_by_property?.[listingId] ?? null;
  const totalLabels = observability?.total_labels ?? null;
  const accuracy = observability?.rolling_accuracy?.last_20 ?? null;
  const pickerActive = totalLabelsForProperty >= 10;
  const pickerColdStartRemaining = Math.max(0, 10 - totalLabelsForProperty);

  return (
    <div
      className="flex-shrink-0 px-4 py-2.5 border-b border-[var(--line)] bg-[var(--surface)]"
      style={{ minHeight: 80 }}
    >
      <div className="flex items-start gap-3">
        {/* Stat cards */}
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          {/* Queue position */}
          <Card className="border-[var(--line)] bg-black/[0.03] shadow-none flex-shrink-0">
            <CardContent className="px-3 py-2 flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">Queue</span>
              <span className="text-sm font-bold tabular-nums text-[var(--ink)] leading-none">
                {pairX} / {pairY}
              </span>
            </CardContent>
          </Card>

          {/* Property labels */}
          <Card className="border-[var(--line)] bg-black/[0.03] shadow-none flex-shrink-0">
            <CardContent className="px-3 py-2 flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">This Property</span>
              <span className="text-sm font-bold tabular-nums text-[var(--ink)] leading-none">
                {totalLabelsForProperty} labeled
              </span>
            </CardContent>
          </Card>

          {/* Today's global labels */}
          {todayLabels !== null && (
            <Card className="border-[var(--line)] bg-black/[0.03] shadow-none flex-shrink-0">
              <CardContent className="px-3 py-2 flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">Today</span>
                <span className="text-sm font-bold tabular-nums text-[var(--ink)] leading-none">
                  {todayLabels} labels
                </span>
              </CardContent>
            </Card>
          )}

          {totalLabels !== null && todayLabels === null && (
            <Card className="border-[var(--line)] bg-black/[0.03] shadow-none flex-shrink-0">
              <CardContent className="px-3 py-2 flex flex-col gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">All Labels</span>
                <span className="text-sm font-bold tabular-nums text-[var(--ink)] leading-none">
                  {totalLabels} total
                </span>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Progress bars column */}
        <div className="flex flex-col gap-1.5 min-w-[180px] max-w-[240px] flex-shrink-0 pt-0.5">
          {/* Queue progress */}
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Queue progress
              </span>
              <span className="text-[10px] tabular-nums text-[var(--muted)]">{queuePct}%</span>
            </div>
            <Progress value={queuePct} className="h-1.5" />
          </div>

          {/* Picker cold-start or active */}
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Picker
              </span>
              <span className="text-[10px] tabular-nums text-[var(--muted)]">
                {pickerActive
                  ? accuracy !== null
                    ? `${Math.round(accuracy * 100)}% acc`
                    : "active"
                  : `${pickerColdStartRemaining} more`}
              </span>
            </div>
            <Progress
              value={pickerActive ? 100 : Math.round((totalLabelsForProperty / 10) * 100)}
              className="h-1.5"
              style={pickerActive ? { "--progress-bg": "var(--good)" } as React.CSSProperties : undefined}
            />
            <span className="text-[9px] text-[var(--muted)]">
              {pickerActive
                ? accuracy !== null
                  ? `Picker active (last accuracy: ${Math.round(accuracy * 100)}%)`
                  : "Picker active"
                : `Picker active in ${pickerColdStartRemaining} more label${pickerColdStartRemaining !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

type FilmstripTarget = "end" | "start";

export default function DirectorsCutLab({ listingId }: DirectorsCutLabProps) {
  // queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOffset, setQueueOffset] = useState(0);
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [listingName, setListingName] = useState("");
  const [totalLabels, setTotalLabels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // all photos for this property (for full-width filmstrip)
  const [allPropertyPhotos, setAllPropertyPhotos] = useState<Array<{ id: string; url: string }>>([]);

  // current pair
  const [currentIdx, setCurrentIdx] = useState(0);
  const [overridePhotoB, setOverridePhotoB] = useState<FilmstripPhoto | null>(null);

  // filmstrip target mode
  const [filmstripTarget, setFilmstripTarget] = useState<FilmstripTarget>("end");

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

  // observability
  const [observability, setObservability] = useState<ObservabilityData | null>(null);

  const currentItem = queue[currentIdx] ?? null;

  // ── fetch observability ──────────────────────────────────────────────────────

  const fetchObservability = useCallback(async () => {
    if (!listingId) return;
    try {
      const res = await authedFetch(`/api/gen2/lab/observability?listingId=${listingId}`);
      if (!res.ok) return;
      const data: ObservabilityData = await res.json();
      setObservability(data);
    } catch {
      // non-fatal — progress strip just won't show extra stats
    }
  }, [listingId]);

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
          // Seed all-property photos from the first page response (stable across pages)
          if (data.all_property_photos && data.all_property_photos.length > 0) {
            setAllPropertyPhotos(data.all_property_photos);
          }
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
    fetchObservability();
  }, [fetchQueue, fetchObservability]);

  // ── build filmstrip when item or all-property-photos changes ───────────────
  // Render ALL property photos in the filmstrip so Oliver can pick any start/end frame.

  useEffect(() => {
    if (!currentItem) {
      setFilmstripPhotos([]);
      return;
    }

    // Use allPropertyPhotos if available; fall back to deduped queue photos
    const source: FilmstripPhoto[] =
      allPropertyPhotos.length > 0
        ? allPropertyPhotos.map((p) => ({
            photo_id: p.id,
            url: p.url,
            rejected: false, // property-level photos don't carry per-candidate rejection
          }))
        : (() => {
            const seen = new Set<string>();
            const strips: FilmstripPhoto[] = [];
            for (const item of queue) {
              if (!seen.has(item.photo_b_id)) {
                seen.add(item.photo_b_id);
                strips.push({ photo_id: item.photo_b_id, url: item.photo_b_url, rejected: rejectedCandidateIds.has(item.candidate_id) });
              }
              if (!seen.has(item.photo_a_id)) {
                seen.add(item.photo_a_id);
                strips.push({ photo_id: item.photo_a_id, url: item.photo_a_url, rejected: rejectedCandidateIds.has(item.candidate_id) });
              }
            }
            return strips;
          })();

    setFilmstripPhotos(source);
  }, [currentItem, allPropertyPhotos, queue, rejectedCandidateIds]);

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

  // ── swap start ↔ end (local clone only) ─────────────────────────────────────

  const swapStartEnd = useCallback(() => {
    if (!currentItem) return;
    setQueue((prev) => {
      const next = [...prev];
      const old = next[currentIdx];
      if (!old) return prev;
      next[currentIdx] = {
        ...old,
        photo_a_id: old.photo_b_id,
        photo_b_id: old.photo_a_id,
        photo_a_url: old.photo_b_url,
        photo_b_url: old.photo_a_url,
        features_blob: old.features_blob
          ? { ...old.features_blob }
          : null,
      };
      return next;
    });
    // Clear any B-override since the pair flipped
    setOverridePhotoB(null);
  }, [currentItem, currentIdx]);

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

        // Refresh observability stats after each label
        fetchObservability();

        // Splice the labeled pair out of the queue so it can't be re-shown.
        // Keep cursor at the same index (which now points to the next item).
        setQueue((prev) => {
          const next = [...prev];
          next.splice(currentIdx, 1);
          return next;
        });
        // After splice, queue.length shrinks by 1. If we're now at the end,
        // try to load more from the server.
        const queueAfterSplice = queue.length - 1;
        if (currentIdx >= queueAfterSplice && totalRemaining > queueOffset) {
          await fetchQueue(queueOffset, true);
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
      fetchObservability,
    ]
  );

  // ── keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
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

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        swapStartEnd();
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
  }, [submitLabel, swapStartEnd]);

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
      <div className="flex flex-col h-[calc(100vh-4rem)] gap-0">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--line)] bg-[var(--surface)]">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex flex-1 min-h-0">
          <Skeleton className="flex-1 rounded-none" />
          <div className="w-52 border-x border-[var(--line)] p-4 flex flex-col gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="flex-1 rounded-none" />
        </div>
        <Skeleton className="h-20 rounded-none" />
      </div>
    );
  }

  // ── render: error ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-4">
        <div className="px-5 py-4 rounded-xl border border-[rgba(196,74,74,0.3)] bg-[rgba(196,74,74,0.05)] text-[var(--bad)] text-sm max-w-md text-center">
          {error}
        </div>
        <Button variant="outline" className="rounded-xl" onClick={() => fetchQueue(0, false)}>
          Retry
        </Button>
      </div>
    );
  }

  // ── render: queue empty ──────────────────────────────────────────────────────

  if (!currentItem) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] gap-5">
        <div className="w-14 h-14 rounded-2xl bg-[rgba(47,138,85,0.10)] grid place-items-center text-[var(--good)]">
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div className="text-base font-semibold text-[var(--ink)]">Queue complete</div>
        <div className="text-sm text-[var(--muted)]">
          {totalLabels} label{totalLabels !== 1 ? "s" : ""} recorded for this property.
        </div>
        <Button className="rounded-xl" onClick={() => fetchQueue(0, false)}>Refresh queue</Button>
      </div>
    );
  }

  // ── render: main ─────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div
        className="le-fade-up flex flex-col bg-[var(--canvas)]"
        style={{ height: "calc(100vh - 4rem)", overflow: "hidden" }}
      >
        {/* ── Top bar ─────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-[var(--line)] bg-[var(--surface)] z-10">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-sm font-semibold text-[var(--ink)] truncate">
              {listingName || listingId || "Unknown property"}
            </span>
            <span className="text-[var(--line)] text-xs">·</span>
            <span className="text-xs text-[var(--muted)] tabular-nums flex-shrink-0">
              {totalLabels} label{totalLabels !== 1 ? "s" : ""}
            </span>
          </div>

          <Badge variant="secondary" className="flex-shrink-0 gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <svg width={7} height={7} viewBox="0 0 10 10" fill="currentColor">
              <circle cx={5} cy={5} r={5} />
            </svg>
            Director's Cut
          </Badge>

          <span className="text-xs text-[var(--muted)] tabular-nums flex-shrink-0 flex items-center gap-1">
            {currentIdx + 1} / {Math.max(queue.length, currentIdx + 1)}
            {loadingMore && (
              <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            )}
          </span>
        </div>

        {/* ── Progress strip ───────────────────────────────────────────────────── */}
        <ProgressStrip
          currentIdx={currentIdx}
          queueLength={Math.max(queue.length, currentIdx + 1)}
          totalLabelsForProperty={totalLabels}
          observability={observability}
          listingId={listingId}
        />

        {/* ── Main canvas: 42% | center | 42% ─────────────────────────────────── */}
        <div className="flex-1 grid min-h-0 overflow-hidden relative" style={{ gridTemplateColumns: "1fr 220px 1fr" }}>
          {/* Left: photo_a */}
          <div className="bg-[#080808] flex items-center justify-center overflow-hidden relative">
            <img
              key={currentItem.photo_a_url}
              src={currentItem.photo_a_url}
              alt="Photo A"
              className="max-w-full max-h-full object-contain block"
            />
            <div className="absolute bottom-3 left-4 text-[10px] text-white/50 font-semibold uppercase tracking-widest pointer-events-none">
              A · Start frame
            </div>
          </div>

          {/* Swap button — absolutely centered between left and center column */}
          <div
            className="absolute z-20 flex flex-col items-center gap-1"
            style={{
              left: "calc(1fr)",
              // Position at the left edge of the center column, centered vertically
              top: "50%",
              transform: "translateY(-50%)",
              // Fine-tune: sit at the seam between photo A and the center column
              left: "calc((100% - 220px) / 2 - 20px)",
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="rounded-full w-9 h-9 bg-[var(--surface)] border-[var(--line)] shadow-sm hover:bg-[var(--canvas)]"
                  onClick={swapStartEnd}
                  aria-label="Swap start and end frames"
                >
                  <ArrowLeftRight size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Swap A ↔ B
              </TooltipContent>
            </Tooltip>
            <kbd className="text-[9px] font-bold text-[var(--muted)] bg-black/[0.06] rounded px-1 py-0.5 leading-none">
              S
            </kbd>
          </div>

          {/* Center column */}
          <div className="bg-[var(--surface)] border-x border-[var(--line)] flex flex-col overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-4">
                {/* ML confidence card */}
                <div className="rounded-xl bg-black/[0.04] p-3.5 flex flex-col gap-2.5">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                    ML Confidence
                  </div>

                  {confidencePct !== null && !usedHeuristic ? (
                    <div className="text-3xl font-bold text-[var(--ink)] leading-none tabular-nums tracking-tight">
                      {confidencePct}%
                    </div>
                  ) : (
                    <Badge className="self-start text-[10.5px] font-bold" style={{ background: "rgba(182,128,44,0.12)", color: "var(--warn)", border: "none" }}>
                      Heuristic
                    </Badge>
                  )}

                  {pickerPred && pickerPred.top_3_features.length > 0 && (
                    <div className="flex flex-col gap-2 mt-1">
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

                {/* Apprentice prediction */}
                {apprenticePred && (
                  <div className="rounded-xl border border-[var(--line)] p-3 flex flex-col gap-1.5">
                    <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                      Apprentice
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-base leading-none font-medium"
                        style={{
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
                      <span className="text-sm font-semibold text-[var(--ink)]">
                        {apprenticePred.predicted_verdict}
                      </span>
                      <span className="text-xs text-[var(--muted)] tabular-nums">
                        ({Math.round(apprenticePred.confidence * 100)}%)
                      </span>
                    </div>
                  </div>
                )}

                <Separator className="bg-[var(--line)]" />

                {/* Transition tags */}
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest">
                    Transition tag
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {TRANSITION_TAGS.map((t) => {
                      const active = selectedTag === t.tag;
                      return (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => setSelectedTag((prev) => (prev === t.tag ? null : t.tag))}
                          className="flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-150"
                          style={{
                            border: active
                              ? "1.5px solid var(--accent)"
                              : "1px solid var(--line)",
                            background: active
                              ? "rgba(42,111,219,0.07)"
                              : "transparent",
                            color: active ? "var(--ink)" : "var(--ink-2)",
                            fontWeight: active ? 600 : 400,
                            cursor: "pointer",
                            fontFamily: "var(--le-font-sans)",
                          }}
                        >
                          <span>{t.label}</span>
                          <span
                            className="text-[10px] font-bold rounded px-1 py-0.5 tabular-nums"
                            style={{
                              background: "rgba(11,11,16,0.05)",
                              color: active ? "var(--accent)" : "var(--muted)",
                            }}
                          >
                            {t.key}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* Action strip — pinned to bottom of center column */}
            <div className="flex-shrink-0 flex flex-col gap-2.5 p-4 border-t border-[var(--line)]">
              <Button
                size="lg"
                disabled={submitting}
                onClick={() => submitLabel("good")}
                className="w-full gap-2 text-sm font-bold rounded-xl"
                style={{
                  background: submitting ? "rgba(47,138,85,0.4)" : "var(--good)",
                  color: "#fff",
                  border: "none",
                }}
              >
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Confirm
                <kbd className="text-[10px] font-bold opacity-75 bg-white/20 rounded px-1.5 py-0.5">
                  SPACE
                </kbd>
              </Button>

              <Button
                size="lg"
                disabled={submitting}
                onClick={() => submitLabel("bad")}
                className="w-full gap-2 text-sm font-bold rounded-xl"
                style={{
                  background: submitting ? "rgba(196,74,74,0.3)" : "var(--bad)",
                  color: "#fff",
                  border: "none",
                }}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <line x1={18} y1={6} x2={6} y2={18} />
                  <line x1={6} y1={6} x2={18} y2={18} />
                </svg>
                Reject
                <kbd className="text-[10px] font-bold opacity-75 bg-white/20 rounded px-1.5 py-0.5">
                  X
                </kbd>
              </Button>

              <p className="text-[10px] text-[var(--muted)] text-center leading-relaxed">
                SPACE confirm · X reject · S swap<br />
                1–5 tag · click filmstrip to swap frame
              </p>
            </div>
          </div>

          {/* Right: photo_b */}
          <div className="bg-[#080808] flex items-center justify-center overflow-hidden relative">
            {photoBDisplay && (
              <img
                key={photoBDisplay}
                src={photoBDisplay}
                alt="Photo B"
                className="max-w-full max-h-full object-contain block"
              />
            )}
            {overridePhotoB && (
              <div className="absolute top-3 right-4 text-[10px] text-white font-bold uppercase tracking-wider bg-[rgba(42,111,219,0.75)] rounded-md px-2 py-1 pointer-events-none">
                Override
              </div>
            )}
            <div className="absolute bottom-3 right-4 text-[10px] text-white/50 font-semibold uppercase tracking-widest pointer-events-none">
              B · End frame
            </div>
          </div>
        </div>

        {/* ── Filmstrip ────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-[var(--line)] bg-[#0e0e0e] flex flex-col overflow-hidden">
          {/* Filmstrip target toggle */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">
              Click thumbnail to swap:
            </span>
            <button
              type="button"
              onClick={() => setFilmstripTarget("end")}
              className="text-[10px] font-semibold px-2 py-0.5 rounded transition-all duration-100"
              style={{
                background: filmstripTarget === "end" ? "rgba(42,111,219,0.18)" : "transparent",
                color: filmstripTarget === "end" ? "var(--accent)" : "rgba(255,255,255,0.35)",
                border: filmstripTarget === "end" ? "1px solid rgba(42,111,219,0.4)" : "1px solid transparent",
              }}
            >
              Swap end
            </button>
            <button
              type="button"
              onClick={() => setFilmstripTarget("start")}
              className="text-[10px] font-semibold px-2 py-0.5 rounded transition-all duration-100"
              style={{
                background: filmstripTarget === "start" ? "rgba(42,111,219,0.18)" : "transparent",
                color: filmstripTarget === "start" ? "var(--accent)" : "rgba(255,255,255,0.35)",
                border: filmstripTarget === "start" ? "1px solid rgba(42,111,219,0.4)" : "1px solid transparent",
              }}
            >
              Swap start
            </button>
          </div>

          <div
            ref={filmstripRef}
            className="flex items-center gap-1.5 px-3 pb-2 overflow-x-auto"
            style={{ scrollbarWidth: "none", height: 68 }}
          >
            {filmstripPhotos.map((photo) => {
              const isCurrentB =
                overridePhotoB
                  ? overridePhotoB.photo_id === photo.photo_id
                  : currentItem.photo_b_id === photo.photo_id;
              const isCurrentA = currentItem.photo_a_id === photo.photo_id;
              const isHighlighted = filmstripTarget === "end" ? isCurrentB : isCurrentA;

              return (
                <Tooltip key={photo.photo_id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        if (filmstripTarget === "end") {
                          if (photo.photo_id === currentItem.photo_a_id) return;
                          setOverridePhotoB(
                            isCurrentB ? null : { photo_id: photo.photo_id, url: photo.url }
                          );
                        } else {
                          // Swap start: mutate the queue item locally
                          if (photo.photo_id === currentItem.photo_b_id) return;
                          setQueue((prev) => {
                            const next = [...prev];
                            const old = next[currentIdx];
                            if (!old) return prev;
                            next[currentIdx] = {
                              ...old,
                              photo_a_id: photo.photo_id,
                              photo_a_url: photo.url,
                            };
                            return next;
                          });
                          setOverridePhotoB(null);
                        }
                      }}
                      className="flex-shrink-0 rounded-lg overflow-hidden relative transition-all duration-150"
                      style={{
                        width: 60,
                        height: 60,
                        border: isHighlighted
                          ? "2.5px solid var(--accent)"
                          : "2px solid transparent",
                        padding: 0,
                        background: "none",
                        cursor: "pointer",
                        opacity: photo.rejected ? 0.55 : 1,
                      }}
                    >
                      <img
                        src={photo.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover block"
                      />
                      {photo.rejected && (
                        <div className="absolute inset-0 bg-[rgba(196,74,74,0.45)] grid place-items-center">
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
                            <line x1={18} y1={6} x2={6} y2={18} />
                            <line x1={6} y1={6} x2={18} y2={18} />
                          </svg>
                        </div>
                      )}
                      {/* Label for start/end mode hints */}
                      {isCurrentA && (
                        <div className="absolute bottom-0.5 left-0.5 text-[8px] font-bold bg-black/60 text-white/80 rounded px-1 leading-tight">A</div>
                      )}
                      {isCurrentB && !overridePhotoB && (
                        <div className="absolute bottom-0.5 right-0.5 text-[8px] font-bold bg-black/60 text-white/80 rounded px-1 leading-tight">B</div>
                      )}
                    </button>
                  </TooltipTrigger>
                  {photo.rejected && (
                    <TooltipContent side="top">
                      <p>Previously rejected</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
            {filmstripPhotos.length === 0 && (
              <span className="text-[11px] text-white/25">
                No other candidates in queue
              </span>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
