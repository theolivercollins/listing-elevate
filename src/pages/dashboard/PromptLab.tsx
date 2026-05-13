import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import "@/v2/styles/v2.css";
import {
  Loader2,
  AlertTriangle,
  Upload,
  Star,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Play,
  Sparkles,
  DollarSign,
  Check,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  uploadLabImage,
  listSessions,
  createSession,
  getSession,
  deleteSession,
  updateSession,
  analyzeSession,
  refineIteration,
  renderIteration,
  rerenderWithProvider,
  rateIteration,
  overrideJudgeRating,
  fetchBatchSelection,
  type LabSession,
  type LabIteration,
  type JudgeRubricResult,
  type BatchSelectionResponse,
  type BatchSelectionItem,
} from "@/lib/promptLabApi";
import { HALLUCINATION_FLAGS, type HallucinationFlag } from "../../../lib/prompts/judge-rubric.js";
import { promoteRecipe } from "@/lib/recipesApi";
import { supabase } from "@/lib/supabase";
import { V1_ATLAS_SKUS, V1_DEFAULT_SKU, type V1AtlasSku } from "../../../lib/providers/router.js";
import { surfaceAffinityForPick } from "../../../lib/providers/sku-motion-affinity.js";

// Per-clip cost (5s render). Atlas SKUs match ATLAS_MODELS.priceCentsPerClip
// in lib/providers/atlas.ts. "kling-v2-native" and "runway-gen4-native" are
// synthetic dropdown entries that route via the native Kling/Runway providers
// (not Atlas). Runway is useful for exterior / drone / top_down shots where
// it was historically stronger than Kling.
type SkuChoice = V1AtlasSku | "kling-v2-native" | "runway-gen4-native";

const V1_SKU_COST_CENTS: Record<SkuChoice, number> = {
  "kling-v2-6-pro": 60,     // $0.60 per 5s clip (Atlas)
  "kling-v2-master": 111,   // $1.11 per 5s clip (Atlas)
  "kling-v2-native": 0,     // pre-paid credits; cash cost 0¢
  "runway-gen4-native": 25, // ~25¢ per 5s clip (gen4_turbo, 5 credits/s × 1¢/credit)
};
const V1_SKU_LABELS: Record<SkuChoice, string> = {
  "kling-v2-6-pro": "v2.6 Pro (default)",
  "kling-v2-master": "v2 Master",
  "kling-v2-native": "v2 Native (Kling credits)",
  "runway-gen4-native": "Runway gen4_turbo (exteriors)",
};
const SKU_DROPDOWN_OPTIONS: readonly SkuChoice[] = [
  "kling-v2-6-pro",
  "kling-v2-master",
  "kling-v2-native",
  "runway-gen4-native",
] as const;

// True when the selected SKU routes via the native Kling provider (not Atlas).
// Caller submits { provider: "kling" } instead of { sku }.
function isNativeKlingSku(sku: SkuChoice): sku is "kling-v2-native" {
  return sku === "kling-v2-native";
}

// True when the selected SKU routes via the native Runway provider (not Atlas).
// Caller submits { provider: "runway" } instead of { sku }.
function isNativeRunwaySku(sku: SkuChoice): sku is "runway-gen4-native" {
  return sku === "runway-gen4-native";
}

// True when the SKU bypasses Atlas (native Kling or native Runway).
function isNativeProviderSku(sku: SkuChoice): boolean {
  return isNativeKlingSku(sku) || isNativeRunwaySku(sku);
}

const RATING_TAGS = [
  "clean motion",
  "cinematic",
  "perfect",
  "stayed in room",
  "hallucinated architecture",
  "wrong motion direction",
  "camera exited room",
  "warped geometry",
  "added people/objects",
  "too static",
  "too fast",
  "low quality",
];

const PromptLab = () => {
  const { sessionId } = useParams<{ sessionId?: string }>();
  if (sessionId) return <SessionDetail sessionId={sessionId} />;
  return <SessionList />;
};

// ─── List view ───

function SessionList() {
  const [sessions, setSessions] = useState<LabSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchLabel, setBatchLabel] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const navigate = useNavigate();

  const [showArchived, setShowArchived] = useState(false);

  async function reload() {
    try {
      const r = await listSessions({ includeArchived: showArchived });
      setSessions(r.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
  }, [showArchived]);

  useEffect(() => {
    reload();
  }, []);

  // Auto-refresh every 15s while any session has an active render or a
  // clip waiting to be rated. Only when the tab is visible.
  useEffect(() => {
    if (!sessions) return;
    const anyActive = sessions.some((s) => s.pending_render || s.ready_for_approval);
    if (!anyActive) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [sessions]);

  async function handleUpload(files: FileList) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    setUploadProgress({ done: 0, total: files.length });
    const batch = batchLabel.trim() || null;
    const createdIds: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const { url, path } = await uploadLabImage(f);
        const session = await createSession({
          image_url: url,
          image_path: path,
          label: f.name.replace(/\.[^.]+$/, ""),
          batch_label: batch ?? undefined,
        });
        createdIds.push(session.id);
        setUploadProgress({ done: i + 1, total: files.length });
      }

      if (autoAnalyze) {
        // Kick off analyses in parallel, don't wait — user can watch progress in list.
        await Promise.allSettled(createdIds.map((id) => analyzeSession(id)));
      }

      // If the operator uploaded several photos with no batch label, offer to
      // group them. This is the common listing-drop flow — user drags 20
      // images and doesn't always remember to type a name first.
      if (!batch && files.length > 1 && createdIds.length > 1) {
        const makeBatch = window.confirm(
          `Group these ${createdIds.length} photos into a new batch?`,
        );
        if (makeBatch) {
          const suggested = `Batch · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
          const name = window.prompt("Name this batch:", suggested)?.trim();
          if (name) {
            await Promise.all(createdIds.map((id) => updateSession(id, { batch_label: name })));
          }
        }
      }

      await reload();

      // If only one uploaded, jump into its detail view.
      if (createdIds.length === 1) {
        navigate(`/dashboard/dev/prompt-lab/${createdIds[0]}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Studio / Dev</div>
        <h2
          className="le-display mt-1 text-[28px] font-medium tracking-tight"
          style={{ color: "var(--le-text)" }}
        >
          Prompt Lab
        </h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--le-text-muted)", maxWidth: 560 }}>
          Upload a test image, run it through photo-analysis + director, rate + refine via chat until the prompt is perfect. Optional real render via Kling/Runway.
        </p>
      </div>

      <div
        className="rounded-[14px] border"
        style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
      >
        <FileDropZone
          uploading={uploading}
          uploadProgress={uploadProgress}
          batchLabel={batchLabel}
          setBatchLabel={setBatchLabel}
          autoAnalyze={autoAnalyze}
          setAutoAnalyze={setAutoAnalyze}
          onFiles={handleUpload}
          error={error}
        />
      </div>

      {sessions === null ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="rounded-[14px] border border-dashed p-12 text-center text-sm"
          style={{ borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}
        >
          No sessions yet. Upload an image above to start.
        </div>
      ) : (
        <BatchGroups sessions={sessions} onReload={reload} showArchived={showArchived} setShowArchived={setShowArchived} />
      )}
    </div>
  );
}

// ─── File dropzone with batch + auto-analyze controls ───

function FileDropZone({
  uploading,
  uploadProgress,
  batchLabel,
  setBatchLabel,
  autoAnalyze,
  setAutoAnalyze,
  onFiles,
  error,
}: {
  uploading: boolean;
  uploadProgress: { done: number; total: number } | null;
  batchLabel: string;
  setBatchLabel: (s: string) => void;
  autoAnalyze: boolean;
  setAutoAnalyze: (b: boolean) => void;
  onFiles: (files: FileList) => void;
  error: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`rounded-[14px] p-6 transition`}
      style={dragOver ? { boxShadow: "0 0 0 2px var(--le-accent) inset", background: "var(--le-accent-soft)" } : {}}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files?.length) {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }
      }}
    >
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>New session(s)</div>
      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="flex-1">
          <label className="text-xs" style={{ color: "var(--le-text-muted)" }}>Batch label (groups these uploads together)</label>
          <Input
            value={batchLabel}
            onChange={(e) => setBatchLabel(e.target.value)}
            placeholder="e.g. Smith property · Kitchen study #2"
            className="mt-1"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
          <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} disabled={uploading} />
          Auto-analyze on upload
        </label>
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-[6px] border px-4 py-2 text-sm transition hover:opacity-80"
          style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)", color: "var(--le-text)" }}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <span>
            {uploading
              ? uploadProgress
                ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                : "Uploading…"
              : "Upload images"}
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) onFiles(e.target.files);
            }}
            disabled={uploading}
          />
        </label>
      </div>
      <p className="mt-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
        Drag files from your desktop onto this panel, or click &quot;Upload images&quot;. One session per image. With auto-analyze, the director runs on each in parallel. You can drag session cards between batches after they&apos;re created.
      </p>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-[6px] p-2 text-sm" style={{ background: "var(--le-danger-soft)", color: "var(--le-danger)" }}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ─── Batch groups with drag-drop + rename ───

type ShotStatus = "not_started" | "in_progress" | "completed";

function statusOf(s: LabSession): ShotStatus {
  if (s.completed) return "completed";
  // "Need to start" = admin hasn't given any feedback yet (no ratings,
  // tags, comments, or refinements). An auto-analyzed session without any
  // human input still counts as "need to start."
  if (!s.has_feedback) return "not_started";
  return "in_progress";
}

function BatchGroups({ sessions, onReload, showArchived, setShowArchived }: { sessions: LabSession[]; onReload: () => void; showArchived: boolean; setShowArchived: (v: boolean) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, "all" | ShotStatus>>({});
  const [organizeMode, setOrganizeMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Batches start collapsed — show as compact widgets, expand on click. Users
  // asked for this after every session in every batch rendering up-front was
  // making the Prompt Lab landing page slow and visually busy.
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInBatch(batch: string, items: LabSession[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = items.every((s) => next.has(s.id));
      for (const s of items) {
        if (allSelected) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  function toggleExpand(batch: string) {
    setExpandedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batch)) next.delete(batch);
      else next.add(batch);
      return next;
    });
  }

  async function batchMoveSelected(targetLabel: string | null) {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { batch_label: targetLabel })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function groupSelected() {
    const name = prompt("Name this batch");
    if (!name?.trim()) return;
    await batchMoveSelected(name.trim());
  }

  async function archiveSelected() {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { archived: true })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function unarchiveSelected() {
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateSession(id, { archived: false })),
      );
      setSelectedIds(new Set());
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  const groups = new Map<string, LabSession[]>();
  for (const s of sessions) {
    const key = s.batch_label?.trim() || "Unbatched";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === "Unbatched") return -1;
    if (b[0] === "Unbatched") return 1;
    const aNewest = Math.max(...a[1].map((s) => new Date(s.created_at).getTime()));
    const bNewest = Math.max(...b[1].map((s) => new Date(s.created_at).getTime()));
    return bNewest - aNewest;
  });

  async function moveSession(sessionId: string, newLabel: string | null) {
    try {
      await updateSession(sessionId, { batch_label: newLabel });
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function renameBatch(oldLabel: string, newLabel: string) {
    const target = newLabel.trim() || null;
    if (oldLabel === "Unbatched" && !target) return;
    try {
      const affected = sessions.filter((s) => (s.batch_label?.trim() || "Unbatched") === oldLabel);
      await Promise.all(affected.map((s) => updateSession(s.id, { batch_label: target })));
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function createBatchFromDrop(sessionId: string) {
    const name = prompt("Name this new batch");
    if (!name?.trim()) return;
    await moveSession(sessionId, name.trim());
  }

  return (
    <div className="space-y-10">
      {/* Organize toolbar */}
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant={organizeMode ? "default" : "outline"}
          onClick={() => {
            setOrganizeMode((prev) => !prev);
            if (organizeMode) setSelectedIds(new Set());
          }}
        >
          {organizeMode ? "Done organizing" : "Organize"}
        </Button>

        <div className="flex items-center gap-2">
          {organizeMode && selectedIds.size > 0 && (
            <>
              <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>{selectedIds.size} selected</span>
              <Button size="sm" variant="outline" onClick={groupSelected}>
                Group into batch
              </Button>
              {ordered.filter(([b]) => b !== "Unbatched").length > 0 && (
                <select
                  className="px-2 py-1 text-xs rounded-[6px]"
                  style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) batchMoveSelected(e.target.value === "__unbatched__" ? null : e.target.value);
                  }}
                >
                  <option value="" disabled>Move to...</option>
                  <option value="__unbatched__">Unbatched</option>
                  {ordered.filter(([b]) => b !== "Unbatched").map(([b]) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              )}
              {Array.from(selectedIds).some((id) => !sessions.find((s) => s.id === id)?.archived) && (
                <Button size="sm" variant="outline" onClick={archiveSelected}>
                  <Trash2 className="mr-2 h-3 w-3" /> Archive
                </Button>
              )}
              {showArchived && Array.from(selectedIds).some((id) => sessions.find((s) => s.id === id)?.archived) && (
                <Button size="sm" variant="outline" onClick={unarchiveSelected}>
                  Unarchive
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </>
          )}
          <label className="ml-auto inline-flex items-center gap-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {ordered.map(([batch, items]) => {
          const rated = items.filter((i) => typeof i.best_rating === "number");
          const avgRating = rated.length > 0 ? rated.reduce((s, i) => s + (i.best_rating ?? 0), 0) / rated.length : null;
          const isTarget = dropTarget === batch;
          const isExpanded = expandedBatches.has(batch);

          const counts = {
            all: items.length,
            not_started: items.filter((i) => statusOf(i) === "not_started").length,
            in_progress: items.filter((i) => statusOf(i) === "in_progress").length,
            completed: items.filter((i) => statusOf(i) === "completed").length,
          };
          const filter = filters[batch] ?? "all";
          const filtered = filter === "all" ? items : items.filter((i) => statusOf(i) === filter);
          // Sort: generation approval needed → iteration approval needed → rendering → rest → completed
          const visible = [...filtered].sort((a, b) => {
            const priority = (s: LabSession) => {
              if (!s.completed && !s.pending_render && s.ready_for_approval) return 0;
              if (!s.completed && !s.pending_render && !s.ready_for_approval && s.iteration_needs_attention) return 1;
              if (s.pending_render) return 2;
              if (s.completed) return 4;
              return 3;
            };
            return priority(a) - priority(b);
          });

          // Pick up to four preview images (by newest created_at) for the collapsed tile's 2×2 grid.
          const previewImages = [...items]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 4)
            .map((s) => s.image_url ?? null);

          return (
            <div
              key={batch}
              className={`${isExpanded ? "col-span-full" : ""} transition ${
                isTarget ? "outline outline-2 outline-foreground bg-accent/30" : ""
              }`}
              onDragOver={(e) => {
                if (draggingId) {
                  e.preventDefault();
                  setDropTarget(batch);
                }
              }}
              onDragLeave={() => setDropTarget((prev) => (prev === batch ? null : prev))}
              onDrop={(e) => {
                if (draggingId) {
                  e.preventDefault();
                  const newLabel = batch === "Unbatched" ? null : batch;
                  moveSession(draggingId, newLabel);
                  setDraggingId(null);
                  setDropTarget(null);
                }
              }}
            >
              {isExpanded ? (
                <div className="rounded-[8px] p-3" style={{ border: "1px solid var(--le-border)" }}>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpand(batch)}
                        className="p-1 transition hover:opacity-70"
                        style={{ color: "var(--le-text-muted)" }}
                        title="Collapse"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <BatchTitle label={batch} onRename={(v) => renameBatch(batch, v)} />
                      {organizeMode && (
                        <button
                          onClick={() => selectAllInBatch(batch, items)}
                          className="ml-2 text-[10px] underline hover:opacity-70"
                          style={{ color: "var(--le-text-muted)" }}
                        >
                          {items.every((s) => selectedIds.has(s.id)) ? "Deselect all" : "Select all"}
                        </button>
                      )}
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: "var(--le-text-muted)" }}>
                      {counts.completed}/{counts.all} completed
                      {avgRating ? ` · avg ${avgRating.toFixed(1)}★` : ""}
                    </span>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1">
                    {(
                      [
                        ["all", `All (${counts.all})`],
                        ["not_started", `Need to start (${counts.not_started})`],
                        ["in_progress", `In progress (${counts.in_progress})`],
                        ["completed", `Completed (${counts.completed})`],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setFilters((prev) => ({ ...prev, [batch]: key }))}
                        className="rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider transition"
                        style={filter === key
                          ? { borderColor: "var(--le-text)", background: "var(--le-text)", color: "var(--le-bg)" }
                          : { borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <ListingSelectionSection batchLabel={batch === "Unbatched" ? null : batch} />

                  {visible.length === 0 ? (
                    <div className="rounded-[6px] border border-dashed p-6 text-center text-xs" style={{ borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}>
                      No sessions in this filter.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {visible.map((s) => (
                        <SessionCard
                          key={s.id}
                          session={s}
                          isDragging={draggingId === s.id}
                          organizeMode={organizeMode}
                          selected={selectedIds.has(s.id)}
                          onToggleSelect={() => toggleSelect(s.id)}
                          onDragStart={() => setDraggingId(s.id)}
                          onDragEnd={() => {
                            setDraggingId(null);
                            setDropTarget(null);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleExpand(batch)}
                  className="group flex aspect-square w-full flex-col p-3 text-left transition rounded-[8px]"
                  style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--le-text)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--le-border)")}
                  title={`Expand "${batch}"`}
                >
                  <div className="mb-3 grid min-h-0 flex-1 grid-cols-2 gap-1">
                    {previewImages.map((src, i) => (
                      <div key={i} className="overflow-hidden" style={{ background: "var(--le-bg-sunken)" }}>
                        {src ? (
                          <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - previewImages.length) }).map((_, i) => (
                      <div key={`placeholder-${i}`} style={{ background: "color-mix(in srgb, var(--le-bg-sunken) 60%, transparent)" }} />
                    ))}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold tracking-tight">{batch}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--le-text-muted)" }}>
                      {counts.all} session{counts.all === 1 ? "" : "s"} · {counts.completed}/{counts.all} done
                      {avgRating ? ` · ${avgRating.toFixed(1)}★` : ""}
                    </div>
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Drop-here-to-create-new-batch zone */}
      <div
        className="rounded-[6px] border-2 border-dashed p-6 text-center text-xs transition"
        style={draggingId
          ? { borderColor: "var(--le-text)", color: "var(--le-text)", background: "var(--le-accent-soft)" }
          : { borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}
        onDragOver={(e) => {
          if (draggingId) e.preventDefault();
        }}
        onDrop={(e) => {
          if (draggingId) {
            e.preventDefault();
            const id = draggingId;
            setDraggingId(null);
            createBatchFromDrop(id);
          }
        }}
      >
        Drop a session here to create a new batch
      </div>
    </div>
  );
}

// Inline "see listing selection" panel — replays the production selectPhotos
// algorithm on every session in a batch so the operator can see which photos
// would land in a real listing video and which would be skipped (and why),
// without having to actually ship the batch through the pipeline.
function ListingSelectionSection({ batchLabel }: { batchLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BatchSelectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchBatchSelection(batchLabel);
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (!open) {
      setOpen(true);
      if (!data && !loading) await run();
    } else {
      setOpen(false);
    }
  }

  return (
    <div className="mb-4 rounded-[8px]" style={{ border: "1px solid var(--le-border)" }}>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:opacity-80"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-semibold uppercase tracking-[0.12em]">See listing selection</span>
          {data && (
            <span style={{ color: "var(--le-text-muted)" }}>
              · {data.selected_count} picked · {data.not_selected_count} skipped · {data.discarded_count} discarded
              {data.unanalyzed.length > 0 ? ` · ${data.unanalyzed.length} unanalyzed` : ""}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>

      {open && (
        <div className="p-3 text-xs" style={{ borderTop: "1px solid var(--le-border)" }}>
          {loading ? (
            <div className="flex items-center gap-2 py-6" style={{ color: "var(--le-text-muted)" }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Running production selection…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 py-3" style={{ color: "var(--le-danger)" }}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
              <button onClick={run} className="ml-auto underline">Retry</button>
            </div>
          ) : !data ? (
            <div className="py-3" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
          ) : (
            <>
              <p className="mb-3" style={{ color: "var(--le-text-muted)" }}>
                Target {data.target} scenes · max {data.max_per_room} per room type. Run against each session's cached vision analysis.
                {data.unanalyzed.length > 0 && (
                  <> {data.unanalyzed.length} session{data.unanalyzed.length === 1 ? "" : "s"} still need analysis and were excluded.</>
                )}
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <SelectionColumn
                  title="Selected"
                  count={data.selected_count}
                  items={data.items.filter((i) => i.status === "selected")}
                  tone="positive"
                  onOpenSession={(id) => navigate(`/dashboard/dev/prompt-lab/${id}`)}
                />
                <SelectionColumn
                  title="Not selected"
                  count={data.not_selected_count}
                  items={data.items.filter((i) => i.status === "not_selected")}
                  tone="neutral"
                  onOpenSession={(id) => navigate(`/dashboard/dev/prompt-lab/${id}`)}
                />
                <SelectionColumn
                  title="Discarded"
                  count={data.discarded_count}
                  items={data.items.filter((i) => i.status === "discarded")}
                  tone="negative"
                  onOpenSession={(id) => navigate(`/dashboard/dev/prompt-lab/${id}`)}
                />
              </div>
              {data.unanalyzed.length > 0 && (
                <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--le-border)", color: "var(--le-text-muted)" }}>
                  <div className="mb-2 font-semibold uppercase tracking-[0.12em]">
                    Unanalyzed ({data.unanalyzed.length})
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {data.unanalyzed.map((u) => (
                      <button
                        key={u.session_id}
                        onClick={() => navigate(`/dashboard/dev/prompt-lab/${u.session_id}`)}
                        className="h-10 w-10 overflow-hidden rounded-[4px] transition hover:opacity-80"
                        style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-sunken)" }}
                        title={u.label ?? ""}
                      >
                        {u.image_url && (
                          <img src={u.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="outline" onClick={run}>
                  <Loader2 className={`mr-2 h-3 w-3 ${loading ? "animate-spin" : "hidden"}`} />
                  Re-run
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionColumn({
  title,
  count,
  items,
  tone,
  onOpenSession,
}: {
  title: string;
  count: number;
  items: BatchSelectionItem[];
  tone: "positive" | "neutral" | "negative";
  onOpenSession: (sessionId: string) => void;
}) {
  const toneStyle =
    tone === "positive"
      ? { borderColor: "rgba(16,185,129,0.4)", color: "var(--le-success)" }
      : tone === "negative"
        ? { borderColor: "rgba(var(--le-danger-rgb,239,68,68),0.4)", color: "var(--le-danger)" }
        : { borderColor: "var(--le-border)", color: "var(--le-text-muted)" };

  return (
    <div>
      <div className="mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={toneStyle}>
        {title} ({count})
      </div>
      {items.length === 0 ? (
        <div className="py-3" style={{ color: "var(--le-text-muted)", opacity: 0.6 }}>—</div>
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <button
              key={i.session_id}
              onClick={() => onOpenSession(i.session_id)}
              className="flex w-full items-start gap-3 p-2 text-left transition rounded-[6px]"
              style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--le-text)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--le-border)")}
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[4px]" style={{ background: "var(--le-bg-sunken)" }}>
                {i.image_url && (
                  <img src={i.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {i.rank != null && (
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: "var(--le-text-muted)" }}>#{i.rank}</span>
                  )}
                  <span className="truncate text-[11px] font-semibold">
                    {i.room_type ? i.room_type.replace(/_/g, " ") : "?"}
                  </span>
                  {i.aesthetic_score != null && (
                    <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--le-text-muted)" }}>
                      {i.aesthetic_score.toFixed(1)}/10
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] leading-snug" style={{ color: "var(--le-text-muted)" }}>{i.reason}</div>
                {i.label && (
                  <div className="mt-1 truncate text-[10px]" style={{ color: "var(--le-text-faint, var(--le-text-muted))", opacity: 0.6 }}>{i.label}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline "this SKU is a bad/good fit for this motion" hint. Reads the
// hand-curated + data-backed affinity table; renders nothing when there's no
// opinion for the motion, so untested motions stay silent instead of showing
// a noisy "neutral" badge.
function SkuAffinityHint({
  cameraMovement,
  sku,
  onPickSuggested,
}: {
  cameraMovement: string | null | undefined;
  sku: string | null | undefined;
  onPickSuggested: (sku: string) => void;
}) {
  const hint = surfaceAffinityForPick({ cameraMovement, sku });
  if (!hint) return null;
  if (hint.verdict === "neutral") return null;

  const isAvoid = hint.verdict === "avoid";
  const tone = isAvoid
    ? "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300"
    : "border-emerald-500/40 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300";

  return (
    <div className={`flex flex-wrap items-start gap-2 rounded border px-2 py-1.5 text-[11px] ${tone}`}>
      <span className="font-semibold uppercase tracking-wider">
        {isAvoid ? "⚠ bad fit" : "✓ best fit"}
      </span>
      <span className="flex-1 leading-snug">{hint.message}</span>
      {isAvoid && hint.suggested_sku && (
        <button
          type="button"
          onClick={() => onPickSuggested(hint.suggested_sku!)}
          className="shrink-0 rounded-[4px] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition hover:opacity-80"
          style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
          title={hint.evidence}
        >
          Use {hint.suggested_sku}
        </button>
      )}
    </div>
  );
}

function BatchTitle({ label, onRename }: { label: string; onRename: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label === "Unbatched" ? "" : label);

  useEffect(() => {
    setDraft(label === "Unbatched" ? "" : label);
  }, [label]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = "var(--le-border)";
          setEditing(false);
          if (draft.trim() !== (label === "Unbatched" ? "" : label)) onRename(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(label === "Unbatched" ? "" : label);
            setEditing(false);
          }
        }}
        placeholder={label === "Unbatched" ? "Name this batch…" : ""}
        className="bg-transparent text-lg font-semibold tracking-tight outline-none min-w-0"
        style={{ borderBottom: "1px solid var(--le-border)" }}
        onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--le-text)")}
      />
    );
  }
  return (
    <h3
      onClick={() => setEditing(true)}
      className="text-lg font-semibold tracking-tight cursor-text hover:opacity-70"
      title="Click to rename (renames all sessions in this batch)"
    >
      {label}
    </h3>
  );
}

function SessionCard({
  session,
  isDragging,
  organizeMode,
  selected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
}: {
  session: LabSession;
  isDragging: boolean;
  organizeMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <Link
      to={organizeMode ? "#" : `/dashboard/dev/prompt-lab/${session.id}`}
      onClick={organizeMode ? (e) => { e.preventDefault(); onToggleSelect(); } : undefined}
      draggable={!organizeMode}
      onDragStart={organizeMode ? undefined : (e) => {
        e.dataTransfer.setData("text/session-id", session.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={organizeMode ? undefined : onDragEnd}
      className={`relative rounded-[8px] transition ${isDragging ? "opacity-40" : ""} ${organizeMode ? "cursor-pointer" : ""}`}
      style={{
        border: organizeMode && selected
          ? "2px solid var(--le-accent)"
          : session.completed
            ? "1px solid rgba(16,185,129,0.5)"
            : "1px solid var(--le-border)",
        background: "var(--le-bg-elev)",
        boxShadow: organizeMode && selected ? "0 0 0 3px var(--le-accent-soft)" : undefined,
      }}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-t-[8px]" style={{ background: "var(--le-bg-sunken)" }}>
        {organizeMode && (
          <div className="absolute top-2 left-2 z-10">
            <div
              className={`h-5 w-5 rounded border-2 flex items-center justify-center transition ${
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-white/80 bg-black/30 text-transparent"
              }`}
            >
              {selected && <Check className="h-3 w-3" />}
            </div>
          </div>
        )}
        <img src={session.image_url} alt={session.label ?? "session"} className="h-full w-full object-cover pointer-events-none" />
        {session.pending_render && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="inline-flex items-center gap-2 rounded bg-amber-500/90 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-lg">
              <Loader2 className="h-3 w-3 animate-spin" />
              Rendering
            </div>
          </div>
        )}
        {session.archived && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-zinc-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-sm">
            Archived
          </div>
        )}
        {!session.archived && session.completed && (
          <div className="absolute top-2 right-2 inline-flex items-center gap-1 rounded bg-emerald-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-sm">
            ✓ Completed
          </div>
        )}
        {!session.completed && !session.pending_render && session.ready_for_approval && (
          <div className="absolute bottom-0 inset-x-0 bg-sky-500 px-2 py-1 text-center text-[10px] font-medium uppercase tracking-wider text-white">
            Generation approval needed
          </div>
        )}
        {!session.completed && !session.pending_render && !session.ready_for_approval && session.iteration_needs_attention && (
          <div className="absolute bottom-0 inset-x-0 bg-teal-500 px-2 py-1 text-center text-[10px] font-medium uppercase tracking-wider text-white">
            Iteration approval needed
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="text-xs font-medium truncate">{session.label || session.archetype || "Untitled"}</div>
        <div className="mt-1 flex items-center justify-between text-[10px]" style={{ color: "var(--le-text-muted)" }}>
          <span>{session.iteration_count ?? 0} iter{session.iteration_count === 1 ? "" : "s"}</span>
          {typeof session.best_rating === "number" && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3 w-3" style={{ fill: "var(--le-text)", color: "var(--le-text)" }} />
              {session.best_rating}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Detail view ───

function SessionDetail({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ session: LabSession; iterations: LabIteration[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<LabSession[]>([]);

  const reload = useCallback(async () => {
    try {
      const d = await getSession(sessionId);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Pull every session in the same batch (or the Unbatched pool) so the
  // operator can flip through them with the left/right arrow keys without
  // going back to the list. Fetched once per navigation; uses the cheap
  // sessions-list endpoint the landing page already hits.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      try {
        const { sessions: all } = await listSessions();
        if (cancelled) return;
        const currentKey = (data.session.batch_label ?? "").trim() || null;
        const batchSiblings = all
          .filter((s) => {
            const k = (s.batch_label ?? "").trim() || null;
            return k === currentKey && !s.archived;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setSiblings(batchSiblings);
      } catch {
        // Sibling lookup is best-effort — it only powers keyboard nav. Silent fail.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const siblingIndex = siblings.findIndex((s) => s.id === sessionId);
  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling = siblingIndex >= 0 && siblingIndex < siblings.length - 1 ? siblings[siblingIndex + 1] : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing / modifier combos.
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (editable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "ArrowLeft" && prevSibling) {
        e.preventDefault();
        navigate(`/dashboard/dev/prompt-lab/${prevSibling.id}`);
      } else if (e.key === "ArrowRight" && nextSibling) {
        e.preventDefault();
        navigate(`/dashboard/dev/prompt-lab/${nextSibling.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevSibling, nextSibling, navigate]);

  // Auto-refresh every 10s while any iteration has an in-flight render OR a
  // pending judge (clip finalized but Gemini judge hasn't run yet — the
  // poll-judge cron drains at ~5/min so judgments land within ~1-2 minutes).
  useEffect(() => {
    if (!data) return;
    const anyRendering = data.iterations.some(
      (it) => it.provider_task_id && !it.clip_url && !it.render_error,
    );
    const anyJudgePending = data.iterations.some(
      (it) => it.clip_url && it.judge_rating_overall == null && it.judge_error == null,
    );
    if (!anyRendering && !anyJudgePending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, 10000);
    return () => clearInterval(timer);
  }, [data, reload]);

  async function handleAnalyze() {
    setBusy("analyze");
    setError(null);
    try {
      await analyzeSession(sessionId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this session and all iterations?")) return;
    await deleteSession(sessionId);
    navigate("/dashboard/dev/prompt-lab");
  }

  async function handleRender(iterationId: string, provider?: "kling" | "runway" | null, sku?: SkuChoice | null) {
    setBusy(`render-${iterationId}`);
    setError(null);
    try {
      // Native pseudo-SKUs (kling-v2-native, runway-gen4-native): IterationCard
      // already set provider="kling"/"runway" before calling onRender. Drop the
      // sku param so the server uses the providerOverride path (not an Atlas SKU).
      const sendSku: V1AtlasSku | null = sku && !isNativeProviderSku(sku) ? (sku as V1AtlasSku) : null;
      const result = await renderIteration(iterationId, provider ?? null, sendSku);
      if (result.renderError) setError(`Render failed: ${result.renderError}`);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefine(iterationId: string, payload: {
    rating: number | null;
    tags: string[];
    comment: string;
    chatInstruction: string;
  }) {
    setBusy(`refine-${iterationId}`);
    setError(null);
    try {
      await refineIteration({
        iteration_id: iterationId,
        rating: payload.rating,
        tags: payload.tags.length ? payload.tags : null,
        comment: payload.comment || null,
        chat_instruction: payload.chatInstruction,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRate(iterationId: string, payload: {
    rating: number | null;
    tags: string[];
    comment: string;
  }) {
    setBusy(`rate-${iterationId}`);
    setError(null);
    try {
      const result = await rateIteration({
        iteration_id: iterationId,
        rating: payload.rating,
        tags: payload.tags.length ? payload.tags : null,
        comment: payload.comment || null,
      });
      if (result.auto_promoted) {
        const tier = result.auto_promoted.tier === "backup" ? " (backup recipe)" : "";
        setSuccess(`Promoted to recipe "${result.auto_promoted.archetype}"${tier}`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleRerender(sourceIterationId: string, provider: "kling" | "runway" | "atlas", sku?: SkuChoice | null) {
    setBusy(`rerender-${sourceIterationId}`);
    setError(null);
    setSuccess(null);
    // If user picked a native-provider pseudo-SKU (kling-v2-native or
    // runway-gen4-native), route via provider="kling"/"runway" and drop the
    // sku param (Atlas SKUs are ignored on the native path).
    const effectiveProvider = sku && isNativeKlingSku(sku)
      ? "kling"
      : sku && isNativeRunwaySku(sku)
        ? "runway"
        : provider;
    const effectiveSku: V1AtlasSku | null = sku && !isNativeProviderSku(sku) ? (sku as V1AtlasSku) : null;
    try {
      const result = await rerenderWithProvider(sourceIterationId, effectiveProvider, effectiveSku);
      if (result.queued) {
        setSuccess(result.message ?? `Queued for ${effectiveProvider}`);
      } else {
        const label = sku ? ` (${V1_SKU_LABELS[sku]})` : "";
        setSuccess(`Re-rendering with ${effectiveProvider}${label} — new iteration created`);
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: "var(--le-text-muted)" }} />
      </div>
    );
  }

  const { session, iterations } = data;
  const latest = iterations[iterations.length - 1];
  const totalCost = iterations.reduce((sum, it) => sum + (it.cost_cents ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard/dev/prompt-lab" style={{ color: "var(--le-text-muted)" }} className="hover:opacity-70 transition" title="Back to list">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          {siblings.length > 1 && (
            <div className="flex items-center gap-1 pl-3" style={{ borderLeft: "1px solid var(--le-border)" }}>
              <button
                type="button"
                onClick={() => prevSibling && navigate(`/dashboard/dev/prompt-lab/${prevSibling.id}`)}
                disabled={!prevSibling}
                title={prevSibling ? `Previous (←) · ${prevSibling.label ?? "Untitled"}` : "No previous session"}
                className="p-1 transition disabled:opacity-30"
                style={{ color: "var(--le-text-muted)" }}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="le-mono px-1 text-[10px]" style={{ color: "var(--le-text-muted)" }}>
                {siblingIndex >= 0 ? siblingIndex + 1 : "?"}/{siblings.length}
              </span>
              <button
                type="button"
                onClick={() => nextSibling && navigate(`/dashboard/dev/prompt-lab/${nextSibling.id}`)}
                disabled={!nextSibling}
                title={nextSibling ? `Next (→) · ${nextSibling.label ?? "Untitled"}` : "No next session"}
                className="p-1 transition disabled:opacity-30"
                style={{ color: "var(--le-text-muted)" }}
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          <div>
            <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Studio / Dev · Prompt Lab session</div>
            <EditableLabel
              value={session.label}
              placeholder="Untitled session"
              onSave={async (v) => {
                await updateSession(sessionId, { label: v });
                reload();
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--le-text-muted)" }}>
          <span className="le-mono inline-flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            ${(totalCost / 100).toFixed(3)}
          </span>
          {iterations.length > 0 && (
            <span className="le-mono text-xs" style={{ color: "var(--le-text-muted)" }}>
              avg ${(iterations.reduce((s, i) => s + (i.cost_cents ?? 0), 0) / iterations.length / 100).toFixed(2)}/clip
            </span>
          )}
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1 transition hover:opacity-70"
            style={{ color: "var(--le-danger)" }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-[10px] p-3 text-sm"
          style={{ background: "var(--le-danger-soft)", border: "1px solid var(--le-danger)", color: "var(--le-danger)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 rounded-[10px] p-3 text-sm" style={{ background: "var(--le-success-soft)", color: "var(--le-success)" }}>
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Source image column */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div
            className="overflow-hidden rounded-[14px]"
            style={{ border: "1px solid var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
          >
            <img src={session.image_url} alt="source" className="w-full" />
          </div>
          {iterations.length === 0 && (
            <Button onClick={handleAnalyze} disabled={busy === "analyze"} className="w-full">
              {busy === "analyze" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Analyze + Direct
            </Button>
          )}
        </div>

        {/* Iteration stack */}
        <div className="space-y-6">
          {iterations.length === 0 ? (
            <div className="rounded-[8px] border border-dashed p-12 text-center text-sm" style={{ borderColor: "var(--le-border)", color: "var(--le-text-muted)" }}>
              No iterations yet. Click "Analyze + Direct" to generate the first one.
            </div>
          ) : (
            iterations
              .slice()
              .reverse()
              .map((it) => (
                <IterationCard
                  key={it.id}
                  iteration={it}
                  isLatest={it.id === latest?.id}
                  busy={busy}
                  onRender={(provider, sku) => handleRender(it.id, provider, sku)}
                  onRefine={(p) => handleRefine(it.id, p)}
                  onRate={(p) => handleRate(it.id, p)}
                  onRerender={(provider) => handleRerender(it.id, provider)}
                  onRerenderWithSku={(sku) => handleRerender(
                    it.id,
                    isNativeKlingSku(sku) ? "kling" : isNativeRunwaySku(sku) ? "runway" : "atlas",
                    sku,
                  )}
                  onJudgeOverrideSuccess={reload}
                />
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Editable label (click-to-edit) ───

function EditableLabel({
  value,
  placeholder,
  onSave,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async (e) => {
          e.currentTarget.style.borderBottomColor = "var(--le-border)";
          setEditing(false);
          if (draft.trim() !== (value ?? "").trim()) await onSave(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
        className="mt-1 w-full bg-transparent text-2xl font-semibold tracking-[-0.02em] outline-none"
        style={{ borderBottom: "1px solid var(--le-border)" }}
        onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--le-text)")}
      />
    );
  }
  return (
    <h2
      onClick={() => setEditing(true)}
      className="mt-1 text-2xl font-semibold tracking-[-0.02em] cursor-text hover:opacity-70"
      title="Click to edit"
    >
      {value || <span style={{ color: "var(--le-text-muted)", opacity: 0.6 }}>{placeholder}</span>}
    </h2>
  );
}

// ─── Promote iteration to recipe ───

function PromoteRecipeControl({
  iteration,
  director,
}: {
  iteration: LabIteration;
  director: NonNullable<LabIteration["director_output_json"]>;
}) {
  const analysis = iteration.analysis_json as { room_type?: string } | null;
  const autoArchetype = useMemo(() => {
    const room = analysis?.room_type ?? "scene";
    const movement = director.camera_movement ?? "motion";
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const slug = Math.random().toString(36).slice(2, 6);
    return `${room}_${movement}_${stamp}_${slug}`;
  }, [analysis?.room_type, director.camera_movement]);

  const [open, setOpen] = useState(false);
  const [archetype, setArchetype] = useState(autoArchetype);
  const [tmpl, setTmpl] = useState(director.prompt);
  const [busy, setBusy] = useState(false);
  const [promoted, setPromoted] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (promoted) {
    return (
      <div className="mt-4 inline-flex items-center gap-2 rounded bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        ✓ Promoted to recipe library
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="mt-4" onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 h-3 w-3" /> Promote to recipe
      </Button>
    );
  }

  async function submit() {
    if (!archetype.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await promoteRecipe({ iteration_id: iteration.id, archetype: archetype.trim(), prompt_template: tmpl.trim() });
      setPromoted(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-4 rounded-[10px] p-4 space-y-3"
      style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)", boxShadow: "var(--le-shadow-sm)" }}
    >
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Promote to recipe library</div>
      <div>
        <label className="text-xs" style={{ color: "var(--le-text-muted)" }}>Archetype name <span className="opacity-60">(auto-filled, edit if you want)</span></label>
        <Input
          value={archetype}
          onChange={(e) => setArchetype(e.target.value)}
          className="mt-1 text-xs le-mono"
        />
      </div>
      <div>
        <label className="text-xs" style={{ color: "var(--le-text-muted)" }}>Prompt template (use this verbatim on similar photos)</label>
        <Textarea
          value={tmpl}
          onChange={(e) => setTmpl(e.target.value)}
          className="mt-1 min-h-[60px] text-xs le-mono"
        />
      </div>
      {err && <div className="text-xs" style={{ color: "var(--le-danger)" }}>{err}</div>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={!archetype.trim() || busy}>
          {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Promote
        </Button>
      </div>
    </div>
  );
}

// ─── Retrieval chips (few-shot + recipe indicators) ───

function RetrievalChips({ metadata }: { metadata: LabIteration["retrieval_metadata"] }) {
  if (!metadata) return null;
  const exemplars = metadata.exemplars ?? [];
  const losers = metadata.losers ?? [];
  const recipe = metadata.recipe;
  if (exemplars.length === 0 && losers.length === 0 && !recipe) return null;
  return (
    <>
      {exemplars.length > 0 && (
        <span
          className="rounded bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wider"
          title={exemplars.map((e) => `${e.rating}★ · ${e.camera_movement} · d=${e.distance.toFixed(3)}\n   ${e.prompt}`).join("\n\n")}
        >
          Based on {exemplars.length} similar {exemplars.length === 1 ? "win" : "wins"}
        </span>
      )}
      {losers.length > 0 && (
        <span
          className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-rose-700 dark:text-rose-400"
          title={losers.map((e) => `${e.rating}★ · ${e.camera_movement} · d=${e.distance.toFixed(3)}\n   ${e.prompt}`).join("\n\n")}
        >
          Avoiding {losers.length} {losers.length === 1 ? "loser" : "losers"}
        </span>
      )}
      {recipe && (
        <span
          className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400"
          title={`${recipe.prompt_template}\n\ndistance ${recipe.distance.toFixed(3)}`}
        >
          Recipe · {recipe.archetype}
        </span>
      )}
    </>
  );
}

// ─── Judge chip + override panel ───

function JudgeChip({
  iteration,
  onOverrideSuccess,
}: {
  iteration: LabIteration;
  onOverrideSuccess: () => void;
}) {
  const [showOverride, setShowOverride] = useState(false);

  // Audit C C2: show Override button even when judge errored — these are
  // exactly the iterations you'd want to calibrate. OverridePanel handles
  // null judge_rating_json via ??3 defaults. Only show pure "failed" state
  // when judge_rating_json is also null (see Fix 7 for that precedence).
  if (iteration.judge_error && iteration.judge_rating_json == null) {
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "var(--le-text-muted)" }}>
          <span className="rounded-[4px] px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ background: "var(--le-bg-sunken)" }}>
            Judge failed
          </span>
          <span className="truncate max-w-[200px]" style={{ color: "var(--le-text-muted)", opacity: 0.7 }} title={iteration.judge_error}>
            {iteration.judge_error.slice(0, 60)}
          </span>
          <button
            type="button"
            onClick={() => setShowOverride((v) => !v)}
            className="ml-1 rounded-[4px] px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:opacity-80"
            style={{ border: "1px solid var(--le-border)" }}
          >
            {showOverride ? "Cancel" : "Override"}
          </button>
        </div>
        {showOverride && (
          <OverridePanel
            iteration={iteration}
            panelNote="(judge failed — start from scratch)"
            onCancel={() => setShowOverride(false)}
            onSuccess={() => {
              setShowOverride(false);
              onOverrideSuccess();
            }}
          />
        )}
      </div>
    );
  }

  // Audit C C3: if judge_rating_json is present, show it regardless of
  // judge_error — a retry failure on a previously-judged iteration must not
  // flip the display from "5/5 Motion 5 …" to "Judge failed".
  // Show rating dimmed when judge_error is also set.
  if (iteration.judge_rating_overall == null) return null;

  const j = iteration.judge_rating_json;
  const flags = j?.hallucination_flags ?? [];
  // Dim the chip row if a retry error was stamped on top of a good rating.
  const hasStaleError = !!iteration.judge_error;

  return (
    <div className="mt-3 space-y-2">
      {/* Chip row — dim when a stale retry error is also present */}
      <div className={`flex flex-wrap items-center gap-2 text-[11px] tabular-nums${hasStaleError ? " opacity-60" : ""}`} style={{ color: "var(--le-text-muted)" }}>
        <span className="rounded-[4px] px-2 py-0.5 font-medium" style={{ background: "color-mix(in srgb, var(--le-text) 8%, transparent)", color: "var(--le-text)" }}>
          Judge: {iteration.judge_rating_overall}/5
        </span>
        {hasStaleError && (
          <span
            className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
            title={iteration.judge_error ?? "retry error"}
          >
            retry err
          </span>
        )}
        {j && (
          <>
            <span title="motion faithfulness">Motion {j.motion_faithfulness}</span>
            <span style={{ color: "var(--le-text-muted)", opacity: 0.4 }}>·</span>
            <span title="geometry coherence">Geom {j.geometry_coherence}</span>
            <span style={{ color: "var(--le-text-muted)", opacity: 0.4 }}>·</span>
            <span title="room consistency">Room {j.room_consistency}</span>
            <span style={{ color: "var(--le-text-muted)", opacity: 0.4 }}>·</span>
            <span title="judge confidence">conf {j.confidence}</span>
          </>
        )}
        {flags.length > 0 && (
          <>
            <span style={{ color: "var(--le-text-muted)", opacity: 0.4 }}>·</span>
            <span className="text-amber-600 dark:text-amber-400">
              {flags.map((f) => (
                <span
                  key={f}
                  className="mr-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px]"
                >
                  {f}
                </span>
              ))}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={() => setShowOverride((v) => !v)}
          className="ml-1 rounded-[4px] px-2 py-0.5 text-[10px] uppercase tracking-wider transition hover:opacity-80"
          style={{ border: "1px solid var(--le-border)" }}
        >
          {showOverride ? "Cancel" : "Override"}
        </button>
      </div>

      {/* Override panel */}
      {showOverride && (
        <OverridePanel
          iteration={iteration}
          onCancel={() => setShowOverride(false)}
          onSuccess={() => {
            setShowOverride(false);
            onOverrideSuccess();
          }}
        />
      )}
    </div>
  );
}

function OverridePanel({
  iteration,
  onCancel,
  onSuccess,
  panelNote,
}: {
  iteration: LabIteration;
  onCancel: () => void;
  onSuccess: () => void;
  /** Optional note shown in the panel header (e.g. when judge failed). */
  panelNote?: string;
}) {
  const j = iteration.judge_rating_json;

  const [motionFaithfulness, setMotionFaithfulness] = useState<number>(j?.motion_faithfulness ?? 3);
  const [geometryCoherence, setGeometryCoherence] = useState<number>(j?.geometry_coherence ?? 3);
  const [roomConsistency, setRoomConsistency] = useState<number>(j?.room_consistency ?? 3);
  const [confidence, setConfidence] = useState<number>(j?.confidence ?? 3);
  const [overall, setOverall] = useState<number>(j?.overall ?? 3);
  const [flags, setFlags] = useState<HallucinationFlag[]>(
    (j?.hallucination_flags ?? []) as HallucinationFlag[],
  );
  const [reasoning, setReasoning] = useState(j?.reasoning ?? "");
  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleFlag(f: HallucinationFlag) {
    setFlags((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  }

  async function handleSave() {
    if (!reasoning.trim()) {
      setError("Reasoning is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const corrected: JudgeRubricResult = {
        motion_faithfulness: motionFaithfulness as JudgeRubricResult["motion_faithfulness"],
        geometry_coherence: geometryCoherence as JudgeRubricResult["geometry_coherence"],
        room_consistency: roomConsistency as JudgeRubricResult["room_consistency"],
        hallucination_flags: flags,
        confidence: confidence as JudgeRubricResult["confidence"],
        reasoning: reasoning.trim(),
        overall: overall as JudgeRubricResult["overall"],
      };
      await overrideJudgeRating(iteration.id, corrected, correctionReason.trim() || undefined);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-[10px] p-4 space-y-4 text-xs"
      style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)", boxShadow: "var(--le-shadow-sm)" }}
    >
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
        Override judge rating
        {panelNote && (
          <span className="ml-2 normal-case font-normal" style={{ color: "var(--le-text-muted)" }}>
            {panelNote}
          </span>
        )}
      </div>

      {/* 5-axis sliders */}
      {(
        [
          ["Motion faithfulness", motionFaithfulness, setMotionFaithfulness],
          ["Geometry coherence", geometryCoherence, setGeometryCoherence],
          ["Room consistency", roomConsistency, setRoomConsistency],
          ["Confidence", confidence, setConfidence],
          ["Overall", overall, setOverall],
        ] as Array<[string, number, (v: number) => void]>
      ).map(([label, value, setter]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-40 shrink-0" style={{ color: "var(--le-text-muted)" }}>{label}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={value}
            onChange={(e) => setter(Number(e.target.value))}
            className="flex-1"
          />
          <span className="w-5 tabular-nums text-right" style={{ color: "var(--le-text)" }}>{value}</span>
        </div>
      ))}

      {/* Hallucination flags */}
      <div>
        <div className="mb-1.5" style={{ color: "var(--le-text-muted)" }}>Hallucination flags</div>
        <div className="flex flex-wrap gap-1.5">
          {HALLUCINATION_FLAGS.map((f) => {
            const active = flags.includes(f as HallucinationFlag);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggleFlag(f as HallucinationFlag)}
                className="rounded-[4px] px-2 py-0.5 text-[10px] transition"
                style={active
                  ? { border: "1px solid var(--le-text)", background: "var(--le-text)", color: "var(--le-bg)" }
                  : { border: "1px solid var(--le-border)", color: "var(--le-text-muted)" }}
              >
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* Reasoning (required) */}
      <div>
        <div className="mb-1" style={{ color: "var(--le-text-muted)" }}>
          Reasoning <span style={{ color: "var(--le-danger)" }}>*</span>
        </div>
        <Textarea
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          placeholder="1–3 sentences citing specific frames or defects"
          maxLength={500}
          className="min-h-[60px] text-xs"
        />
      </div>

      {/* Correction reason (optional) */}
      <div>
        <div className="mb-1" style={{ color: "var(--le-text-muted)" }}>Why you're overriding (optional)</div>
        <Textarea
          value={correctionReason}
          onChange={(e) => setCorrectionReason(e.target.value)}
          placeholder="e.g. Judge missed that the geometry warped at second 3"
          className="min-h-[50px] text-xs"
        />
      </div>

      {error && (
        <div className="text-[11px]" style={{ color: "var(--le-danger)" }}>{error}</div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Check className="mr-2 h-3 w-3" />}
          Save override
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── One iteration card ───

function IterationCard({
  iteration,
  isLatest,
  busy,
  onRender,
  onRefine,
  onRate,
  onRerender,
  onRerenderWithSku,
  onJudgeOverrideSuccess,
}: {
  iteration: LabIteration;
  isLatest: boolean;
  busy: string | null;
  onRender: (provider: "kling" | "runway" | null, sku: SkuChoice) => void;
  onRefine: (payload: { rating: number | null; tags: string[]; comment: string; chatInstruction: string }) => void;
  onRate: (payload: { rating: number | null; tags: string[]; comment: string }) => void;
  onRerender: (provider: "kling" | "runway") => void;
  onRerenderWithSku?: (sku: SkuChoice) => void;
  onJudgeOverrideSuccess?: () => void;
}) {
  const [rating, setRating] = useState<number | null>(iteration.rating);
  const [tags, setTags] = useState<string[]>(iteration.tags ?? []);
  const [comment, setComment] = useState(iteration.user_comment ?? "");
  const [chat, setChat] = useState("");
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Auto-save feedback so operator feedback can't be lost — normal typing
  // triggers a 1.5s debounce; unmount, tab-hidden, and textarea blur all
  // force an immediate flush. The flush on unmount uses fetch keepalive so
  // it survives even if the browser is closing the tab.
  const hasMountedRef = useRef(false);
  const ratingRef = useRef(rating);
  const tagsRef = useRef(tags);
  const commentRef = useRef(comment);
  const lastSavedRef = useRef({
    rating: iteration.rating,
    tags: iteration.tags ?? [],
    comment: iteration.user_comment ?? "",
  });
  useEffect(() => { ratingRef.current = rating; }, [rating]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { commentRef.current = comment; }, [comment]);

  const isDirty = useCallback(() => {
    const s = lastSavedRef.current;
    const ratingEq = s.rating === ratingRef.current;
    const tagsEq = JSON.stringify([...s.tags].sort()) === JSON.stringify([...tagsRef.current].sort());
    const commentEq = s.comment === commentRef.current;
    return !(ratingEq && tagsEq && commentEq);
  }, []);

  const flushSave = useCallback(async (useKeepalive: boolean) => {
    if (!isDirty()) return;
    const body = {
      iteration_id: iteration.id,
      rating: ratingRef.current,
      tags: tagsRef.current.length > 0 ? tagsRef.current : null,
      comment: commentRef.current.trim() ? commentRef.current : null,
    };
    try {
      if (useKeepalive) {
        // Fire-and-forget via fetch keepalive — survives page unload / tab close.
        // Skip auth header: browser will send cookies, server requireAdmin
        // accepts session cookies in addition to bearer tokens.
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
        fetch("/api/admin/prompt-lab/rate", {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(() => { /* best-effort during unload */ });
      } else {
        await rateIteration(body);
      }
      lastSavedRef.current = {
        rating: ratingRef.current,
        tags: [...tagsRef.current],
        comment: commentRef.current,
      };
      setAutoSaveState("saved");
      setTimeout(() => setAutoSaveState("idle"), 2000);
    } catch {
      setAutoSaveState("error");
    }
  }, [iteration.id, isDirty]);

  // Debounced save on every change (1.5s after last edit).
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (!isDirty()) return;
    setAutoSaveState("saving");
    const handle = setTimeout(() => { flushSave(false); }, 1500);
    return () => clearTimeout(handle);
  }, [rating, tags, comment, isDirty, flushSave]);

  // Flush on unmount (navigate within app) + tab hide / page unload.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") flushSave(true); };
    const onPageHide = () => flushSave(true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      flushSave(true);
    };
  }, [flushSave]);
  const [renderForReal, setRenderForReal] = useState(false);
  const [providerChoice, setProviderChoice] = useState<"auto" | "kling" | "runway">("auto");
  const [showAdvancedProvider, setShowAdvancedProvider] = useState(false);
  const [sku, setSku] = useState<SkuChoice>(() => {
    const mu = iteration.model_used;
    // Map legacy native-kling iterations (model_used=null, provider="kling")
    // and legacy "kling-v2-native" sentinel to the dropdown's native entry.
    if (mu === "kling-v2-native" || (!mu && iteration.provider === "kling")) return "kling-v2-native";
    // Same for native Runway iterations.
    if (mu === "runway-gen4-native" || (!mu && iteration.provider === "runway")) return "runway-gen4-native";
    if (mu && (SKU_DROPDOWN_OPTIONS as readonly string[]).includes(mu)) return mu as SkuChoice;
    return V1_DEFAULT_SKU;
  });

  const director = iteration.director_output_json;
  const analysis = iteration.analysis_json as Record<string, unknown> | null;

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  const rendering = busy === `render-${iteration.id}`;
  const refining = busy === `refine-${iteration.id}`;
  const rating_saving = busy === `rate-${iteration.id}`;

  return (
    <div
      className="relative rounded-[14px] p-6"
      style={
        isLatest
          ? {
              border: "2px solid var(--le-accent)",
              background: "var(--le-bg-elev)",
              boxShadow: "var(--le-shadow-md)",
            }
          : {
              border: "1px solid var(--le-border)",
              background: "var(--le-bg-elev)",
              opacity: 0.82,
            }
      }
    >
      {isLatest && (
        <div
          className="absolute -top-[1px] -left-[1px] rounded-br px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)" }}
        >
          Latest · active
        </div>
      )}
      <div className={`flex items-center justify-between ${isLatest ? "mt-3" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Iteration {iteration.iteration_number}</span>
          {iteration.order_id && (
            <span
              className="le-mono rounded px-1.5 py-0.5 text-[10px]"
              style={{ background: "var(--le-bg-sunken)", color: "var(--le-text-muted)" }}
            >
              {iteration.order_id}
            </span>
          )}
          {(iteration.model_used || iteration.provider) && (
            <span className="rounded-[4px] px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ background: "var(--le-bg-sunken)" }} title={iteration.model_used ? `provider: ${iteration.provider ?? "—"}` : undefined}>
              {iteration.model_used ?? iteration.provider}
            </span>
          )}
          <RetrievalChips metadata={iteration.retrieval_metadata} />
        </div>
        <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>
          {new Date(iteration.created_at).toLocaleString()}
        </span>
      </div>

      {/* Analysis summary */}
      {analysis && (
        <div className="mt-4 grid gap-3 text-xs md:grid-cols-2">
          <div>
            <span style={{ color: "var(--le-text-muted)" }}>Room: </span>
            <span className="font-medium">{String(analysis.room_type)}</span>
            <span className="ml-3" style={{ color: "var(--le-text-muted)" }}>Depth: </span>
            <span className="font-medium">{String(analysis.depth_rating)}</span>
            <span className="ml-3" style={{ color: "var(--le-text-muted)" }}>Aesthetic: </span>
            <span className="font-medium">{String(analysis.aesthetic_score)}</span>
          </div>
          <div>
            <span style={{ color: "var(--le-text-muted)" }}>Suggested motion: </span>
            <span className="font-medium">{String(analysis.suggested_motion ?? "—")}</span>
          </div>
          {Array.isArray(analysis.key_features) && (
            <div className="md:col-span-2" style={{ color: "var(--le-text-muted)" }}>
              <span>Features: </span>
              <span style={{ color: "var(--le-text)" }}>{(analysis.key_features as string[]).join(" · ")}</span>
            </div>
          )}
          {typeof analysis.composition === "string" && (
            <div className="md:col-span-2 italic" style={{ color: "var(--le-text-muted)" }}>{analysis.composition as string}</div>
          )}
        </div>
      )}

      {/* Director output */}
      {director && (
        <div className="mt-5 border-l-2 border-foreground/20 pl-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-foreground px-2 py-0.5 text-[10px] uppercase tracking-wider text-background">
              {director.camera_movement}
            </span>
            <span style={{ color: "var(--le-text-muted)" }}>{director.duration_seconds}s</span>
          </div>
          <p className="mt-2 font-mono text-sm leading-relaxed">{director.prompt}</p>
        </div>
      )}

      {iteration.user_comment && iteration.user_comment.startsWith("[refiner rationale]") && (
        <div className="mt-3 rounded-[6px] p-3 text-xs italic" style={{ background: "var(--le-bg-sunken)", color: "var(--le-text-muted)" }}>
          {iteration.user_comment.replace("[refiner rationale] ", "Why: ")}
        </div>
      )}

      {/* Queued for render (waiting for provider slot) */}
      {!iteration.clip_url && !iteration.provider_task_id && iteration.render_queued_at && !iteration.render_error && (
        <div className="mt-5 inline-flex items-center gap-2 rounded bg-violet-500/10 px-3 py-1.5 text-xs text-violet-700 dark:text-violet-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Queued for {iteration.provider ?? "render"} — waiting for slot
          <span className="text-violet-700/70 dark:text-violet-400/70">
            · auto-submits when capacity opens (cron checks every minute)
          </span>
        </div>
      )}

      {/* Pending render indicator */}
      {!iteration.clip_url && iteration.provider_task_id && !iteration.render_error && (
        <div className="mt-5 inline-flex items-center gap-2 rounded bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          Rendering on {iteration.provider}
          {iteration.render_submitted_at && (
            <span className="text-amber-700/70 dark:text-amber-400/70">
              · submitted {new Date(iteration.render_submitted_at).toLocaleTimeString()}
            </span>
          )}
          <span className="text-amber-700/70 dark:text-amber-400/70">
            · cron finalizes (safe to leave this page)
          </span>
        </div>
      )}

      {/* Render error */}
      {iteration.render_error && !iteration.clip_url && (
        <div className="mt-5 rounded-[6px] p-3 text-xs" style={{ background: "var(--le-danger-soft)", color: "var(--le-danger)" }}>
          <div className="font-medium">Render failed</div>
          <div className="mt-1" style={{ opacity: 0.8 }}>{iteration.render_error}</div>
        </div>
      )}

      {/* Clip player */}
      {iteration.clip_url && (
        <div className="mt-5 space-y-2">
          <video
            key={iteration.clip_url}
            src={iteration.clip_url}
            controls
            playsInline
            preload="metadata"
            className="w-full max-w-md rounded-[6px]"
            style={{ border: "1px solid var(--le-border)" }}
          />
          <a
            href={iteration.clip_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs underline hover:opacity-80 transition"
            style={{ color: "var(--le-text-muted)" }}
          >
            Open clip in new tab ↗
          </a>
        </div>
      )}

      {/* Judge pending — clip has landed but judge cron hasn't run yet. */}
      {iteration.clip_url
        && iteration.judge_rating_overall == null
        && iteration.judge_error == null
        && (
          <div className="mt-3 flex items-center gap-2 text-[11px]" style={{ color: "var(--le-text-muted)" }}>
            <span className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[10px] uppercase tracking-wider" style={{ background: "var(--le-bg-sunken)" }}>
              <Loader2 className="h-3 w-3 animate-spin" />
              Judging…
            </span>
            <span style={{ color: "var(--le-text-muted)", opacity: 0.6 }}>Gemini auto-judge runs every minute</span>
          </div>
        )}

      {/* Judge chip — appears when judge has run (or errored) */}
      {(iteration.judge_rating_overall != null || iteration.judge_error != null) && (
        <JudgeChip
          iteration={iteration}
          onOverrideSuccess={onJudgeOverrideSuccess ?? (() => {})}
        />
      )}

      {/* Try with different provider (any iteration that has a clip or director output) */}
      {director && (iteration.clip_url || iteration.render_error) && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>Try with:</span>
          {(["kling", "runway"] as const)
            .filter((p) => p !== iteration.provider)
            .map((p) => (
              <Button
                key={p}
                size="sm"
                variant="outline"
                disabled={busy === `rerender-${iteration.id}`}
                onClick={() => onRerender(p)}
              >
                {busy === `rerender-${iteration.id}` ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Play className="mr-2 h-3 w-3" />
                )}
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </Button>
            ))}
        </div>
      )}

      {/* Try another SKU (Atlas) — shown on successful renders AND failed ones
          so users can retry a stuck/failed iteration on a different SKU without
          falling back to the legacy Kling-native / Runway escape hatches. */}
      {(iteration.clip_url || iteration.render_error) && onRerenderWithSku && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span style={{ color: "var(--le-text-muted)" }}>
            {iteration.render_error ? "Retry on another SKU:" : "Try another SKU:"}
          </span>
          {SKU_DROPDOWN_OPTIONS
            .filter((s) => s !== iteration.model_used
              && !(s === "kling-v2-native" && iteration.provider === "kling")
              && !(s === "runway-gen4-native" && iteration.provider === "runway"))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onRerenderWithSku(s)}
                disabled={busy === `rerender-${iteration.id}`}
                className="rounded-[4px] px-2 py-0.5 transition hover:opacity-80 disabled:opacity-50"
                style={{ border: "1px solid var(--le-border)" }}
                title={
                  s === "kling-v2-native" ? "Native Kling v2.0 — uses pre-paid credits"
                    : s === "runway-gen4-native" ? "Runway Gen-4 turbo — strong on exteriors / drone"
                      : `$${(V1_SKU_COST_CENTS[s] / 100).toFixed(2)}/5s`
                }
              >
                {V1_SKU_LABELS[s].replace(" (default)", "")}
              </button>
            ))}
        </div>
      )}

      {/* Promote to recipe (on 5★ iterations) */}
      {typeof iteration.rating === "number" && iteration.rating >= 4 && director && (
        <PromoteRecipeControl iteration={iteration} director={director} />
      )}

      {/* Render controls (latest only, not currently rendering) */}
      {isLatest && !iteration.clip_url && !iteration.provider_task_id && director && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
            <input
              type="checkbox"
              checked={renderForReal}
              onChange={(e) => {
              setRenderForReal(e.target.checked);
              // Audit C C1: defensive reset — if user unchecks "Render for real",
              // also collapse the Advanced panel and reset provider to auto so
              // stale overrides don't persist silently on re-tick.
              if (!e.target.checked) {
                setProviderChoice("auto");
                setShowAdvancedProvider(false);
              }
            }}
            />
            Render for real (~$0.36–$1.11 per clip depending on SKU)
          </label>
          <div className="flex items-center gap-2 text-xs">
            <label style={{ color: "var(--le-text-muted)" }}>SKU:</label>
            <select
              value={sku}
              onChange={(e) => setSku(e.target.value as SkuChoice)}
              className="rounded-[6px] px-2 py-1 text-xs"
              style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
              disabled={!renderForReal || rendering}
            >
              {SKU_DROPDOWN_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {V1_SKU_LABELS[s]} — {s === "kling-v2-native" ? "credits" : `≈ $${(V1_SKU_COST_CENTS[s] / 100).toFixed(2)}`}
                </option>
              ))}
            </select>
            <span className="rounded-[4px] font-mono px-2 py-0.5 text-[10px]" style={{ background: "var(--le-bg-sunken)", color: "var(--le-text-muted)" }}>
              {isNativeKlingSku(sku) ? "credits" : `≈ $${(V1_SKU_COST_CENTS[sku] / 100).toFixed(2)}/5s`}
            </span>
          </div>
          <SkuAffinityHint
            cameraMovement={(director as { camera_movement?: string } | null)?.camera_movement ?? null}
            sku={sku}
            onPickSuggested={(s) => setSku(s as SkuChoice)}
          />
          {showAdvancedProvider ? (
            <div className="flex items-center gap-1">
              <select
                value={providerChoice}
                onChange={(e) => setProviderChoice(e.target.value as "auto" | "kling" | "runway")}
                className="rounded-[6px] px-2 py-1 text-xs"
                style={{ border: "1px solid var(--le-border)", background: "var(--le-bg-elev)" }}
                disabled={!renderForReal || rendering}
                title="Provider override. Default is Atlas (routes via your selected SKU). Kling native burns pre-paid credits instead of Atlas billing. Runway uses Gen-4 instead of Kling."
              >
                <option value="auto">Atlas (default)</option>
                <option value="kling">Kling native</option>
                <option value="runway">Runway Gen-4</option>
              </select>
              {/* Audit C C1: close button resets provider to auto + collapses panel */}
              <button
                type="button"
                onClick={() => {
                  setProviderChoice("auto");
                  setShowAdvancedProvider(false);
                }}
                disabled={!renderForReal || rendering}
                className="text-[10px] transition hover:opacity-80 disabled:opacity-50"
                style={{ color: "var(--le-text-muted)" }}
                title="Reset to Atlas (default) and collapse"
              >
                ◂
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdvancedProvider(true)}
              disabled={!renderForReal || rendering}
              className="text-[10px] transition hover:opacity-80 disabled:opacity-50"
              style={{ color: "var(--le-text-muted)" }}
              title="Show provider override (Kling native / Runway)"
            >
              Advanced ▸
            </button>
          )}
          <Button
            size="sm"
            variant={renderForReal ? "default" : "outline"}
            disabled={!renderForReal || rendering}
            onClick={() => {
              // If the user picked a native-provider pseudo-SKU, route via
              // that provider (Atlas SKU ignored). Else honor any explicit
              // provider override + Atlas SKU.
              if (isNativeKlingSku(sku)) {
                onRender("kling", sku);
              } else if (isNativeRunwaySku(sku)) {
                onRender("runway", sku);
              } else {
                onRender(providerChoice === "auto" ? null : providerChoice, sku);
              }
            }}
          >
            {rendering ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
            {rendering ? "Rendering…" : "Render clip"}
          </Button>
        </div>
      )}

      {/* Feedback — rating available on any iteration; refine latest only */}
      {director && (
        <div className="mt-6 space-y-4 pt-5" style={{ borderTop: "1px solid var(--le-border)" }}>
          <div className="flex items-center justify-between">
            <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Rate this iteration</span>
            <span className="le-mono text-[10px]" style={{ color: "var(--le-text-muted)" }} aria-live="polite">
              {autoSaveState === "saving" ? "saving…"
                : autoSaveState === "saved" ? "✓ saved"
                : autoSaveState === "error" ? "⚠ auto-save failed — use Save rating button"
                : ""}
            </span>
          </div>
          <div>
            <span className="sr-only">Rate this iteration</span>
            <div className="mt-2 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(rating === n ? null : n)}
                  className="p-1"
                  aria-label={`${n} stars`}
                >
                  <Star
                    className="h-5 w-5"
                    style={rating != null && n <= rating
                      ? { fill: "var(--le-text)", color: "var(--le-text)" }
                      : { color: "var(--le-text-muted)", opacity: 0.4 }}
                    strokeWidth={1.5}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Tags</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {RATING_TAGS.map((t) => {
                const active = tags.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className="rounded-full px-2.5 py-1 text-[10px] transition"
                    style={active
                      ? { border: "1px solid var(--le-text)", background: "var(--le-text)", color: "var(--le-bg)" }
                      : { border: "1px solid var(--le-border)", color: "var(--le-text-muted)" }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Notes (optional)</span>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={() => flushSave(false)}
              placeholder="Anything you want to remember about this iteration"
              className="mt-2 min-h-[60px]"
            />
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRate({ rating, tags, comment })}
              disabled={rating_saving || (rating === null && tags.length === 0 && !comment.trim())}
            >
              {rating_saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Star className="mr-2 h-3 w-3" />}
              Save rating
            </Button>
          </div>

          <div>
            <span className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
              What should change?{!isLatest && <span style={{ color: "var(--le-text-faint)" }}> (will branch from this iteration)</span>}
            </span>
            <Textarea
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              placeholder="e.g. 'the dolly is too fast, make it slower' or 'use reveal past the island corner instead of push_in'"
              className="mt-2 min-h-[80px]"
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={() =>
                  onRefine({ rating, tags, comment, chatInstruction: chat })
                }
                disabled={!chat.trim() || refining}
              >
                {refining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Refine → new iteration
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PromptLab;
