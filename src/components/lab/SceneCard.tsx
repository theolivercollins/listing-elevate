import { useMemo, useState } from "react";
import { Loader2, Star, Play, Sparkles, RotateCcw, X, Copy, Trash2, ChevronDown, ChevronRight, Archive, ArchiveRestore, Layers, SplitSquareHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PairVisualization } from "./PairVisualization";
import { ChatPanel } from "./ChatPanel";
import { RatingReasonsModal } from "./RatingReasonsModal";
import { GenerateAllModal } from "./GenerateAllModal";
import { CompareModal } from "./CompareModal";
import {
  renderListing,
  renderSceneWithModels,
  rateIteration,
  refineScenePrompt,
  chatSceneStream,
  clearSceneChat,
  pinSceneInstruction,
  setSceneRefinementNotes,
  setSceneUseEndFrame,
  setSceneArchived,
  deleteIteration,
  regenerateFromIteration,
  type LabListingScene,
  type LabListingIteration,
  type LabListingPhoto,
} from "@/lib/labListingsApi";
import { getLabModel } from "@/lib/labModels";

interface SceneCardProps {
  listingId: string;
  scene: LabListingScene;
  iterations: LabListingIteration[];
  photos: LabListingPhoto[];
  defaultModel: string;
  onReload: () => void;
  onRateOptimistic?: (iterId: string, patch: {
    rating?: number | null;
    reasons?: string[] | null;
    comment?: string | null;
    archived?: boolean;
  }) => Promise<void>;
  onArchiveSceneOptimistic?: (sceneId: string, archived: boolean) => Promise<void>;
}

function Stars({ value, onChange, disabled }: { value: number | null; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className="p-0.5 disabled:opacity-50"
        >
          <Star className={`h-4 w-4 ${value !== null && n <= value ? "fill-foreground text-foreground" : "text-muted-foreground/40 hover:text-foreground"}`} />
        </button>
      ))}
    </div>
  );
}

function IterationExpanded({ listingId, scene, iter, onReload, onRateOptimistic }: {
  listingId: string;
  scene: LabListingScene;
  iter: LabListingIteration;
  onReload: () => void;
  onRateOptimistic?: (iterId: string, patch: {
    rating?: number | null;
    reasons?: string[] | null;
    comment?: string | null;
    archived?: boolean;
  }) => Promise<void>;
}) {
  const [comment, setComment] = useState(iter.user_comment ?? "");
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ratingModalValue, setRatingModalValue] = useState<number | null>(null);

  async function handleRate(n: number) {
    if (onRateOptimistic) {
      await onRateOptimistic(iter.id, { rating: n });
    } else {
      await rateIteration(listingId, iter.id, { rating: n });
      onReload();
    }
    setRatingModalValue(n);
  }

  async function saveRatingReasons(reasons: string[], modalComment: string) {
    if (onRateOptimistic) {
      await onRateOptimistic(iter.id, { reasons, comment: modalComment || null });
    } else {
      await rateIteration(listingId, iter.id, { reasons, comment: modalComment || null });
      onReload();
    }
    if (modalComment) setComment(modalComment);
  }

  async function saveComment() {
    if (comment === (iter.user_comment ?? "")) return;
    if (onRateOptimistic) {
      await onRateOptimistic(iter.id, { comment: comment || null });
    } else {
      await rateIteration(listingId, iter.id, { comment: comment || null });
      onReload();
    }
  }

  async function regenerate(modelOverride?: string) {
    setBusy(true);
    try {
      await regenerateFromIteration(listingId, iter.id, modelOverride);
      onReload();
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    try { await navigator.clipboard.writeText(iter.director_prompt); } catch { /* noop */ }
  }

  async function toggleArchived() {
    if (onRateOptimistic) {
      await onRateOptimistic(iter.id, { archived: !iter.archived });
    } else {
      await rateIteration(listingId, iter.id, { archived: !iter.archived });
      onReload();
    }
  }

  async function remove() {
    if (!confirm(`Permanently delete iteration #${iter.iteration_number}? (Use Archive to hide without losing the rating signal.)`)) return;
    await deleteIteration(listingId, iter.id);
    onReload();
  }

  return (
    <>
      {ratingModalValue !== null && (
        <RatingReasonsModal
          rating={ratingModalValue}
          initialReasons={iter.rating_reasons ?? []}
          initialComment={iter.user_comment ?? ""}
          onSave={saveRatingReasons}
          onClose={() => setRatingModalValue(null)}
        />
      )}

      {iter.clip_url && (
        <video controls src={iter.clip_url} className="mt-2 aspect-video w-full bg-black" preload="metadata" />
      )}
      {iter.render_error && (
        <p className="mt-2 text-[11px] text-destructive">Error: {iter.render_error}</p>
      )}

      <div className="mt-2 flex items-center justify-between">
        <Stars value={iter.rating} onChange={handleRate} disabled={!iter.clip_url} />
        {iter.rating_reasons && iter.rating_reasons.length > 0 && (
          <button type="button" onClick={() => setRatingModalValue(iter.rating!)} className="text-[10px] text-muted-foreground underline-offset-2 hover:underline">
            edit reasons
          </button>
        )}
      </div>

      {iter.rating_reasons && iter.rating_reasons.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {iter.rating_reasons.map((r) => (
            <span
              key={r}
              className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                (iter.rating ?? 0) >= 4
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                  : "border-red-400/40 bg-red-400/10 text-red-700"
              }`}
            >
              {r.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {iter.clip_url && (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => regenerate()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
              Regenerate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPromptOpen((o) => !o)}>
              {promptOpen ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
              Prompt
            </Button>
            <Button size="sm" variant="ghost" onClick={copyPrompt}>
              <Copy className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={toggleArchived}>
              {iter.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          {promptOpen && (
            <pre className="mt-2 whitespace-pre-wrap rounded border border-border bg-muted p-2 font-sans text-[11px] text-foreground">{iter.director_prompt}</pre>
          )}

          <div className="mt-3">
            <span className="label text-muted-foreground">Comment</span>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={saveComment}
              placeholder="What did you think? (saved on blur)"
              className="mt-1 min-h-[44px] text-xs"
            />
          </div>
        </>
      )}
    </>
  );
}

function IterationCollapsed({ iter, expanded, onToggle }: {
  iter: LabListingIteration;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-muted/40"
    >
      {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="font-sans text-muted-foreground">#{iter.iteration_number}</span>
      <span className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{iter.model_used}</span>
      <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
        iter.status === "rendered" || iter.status === "rated" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" :
        iter.status === "failed" ? "border-red-400/40 bg-red-400/10 text-red-700" :
        "border-amber-400/40 bg-amber-400/10 text-amber-700"
      }`}>
        {iter.status}
      </span>
      <span className="flex-1" />
      {iter.rating !== null ? (
        <span className="inline-flex items-center gap-0.5 text-[11px]">
          {iter.rating}<Star className="h-2.5 w-2.5 fill-foreground" />
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">unrated</span>
      )}
      {iter.archived && (
        <span className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">archived</span>
      )}
    </button>
  );
}

function IterationSection({ listingId, scene, iter, defaultExpanded, onReload, onRateOptimistic }: {
  listingId: string;
  scene: LabListingScene;
  iter: LabListingIteration;
  defaultExpanded: boolean;
  onReload: () => void;
  onRateOptimistic?: (iterId: string, patch: {
    rating?: number | null;
    reasons?: string[] | null;
    comment?: string | null;
    archived?: boolean;
  }) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className={`border ${iter.archived ? "border-dashed border-border/60 bg-muted/30" : "border-border"}`}>
      <IterationCollapsed iter={iter} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
      {expanded && (
        <div className="p-3 pt-0">
          <IterationExpanded listingId={listingId} scene={scene} iter={iter} onReload={onReload} onRateOptimistic={onRateOptimistic} />
        </div>
      )}
    </div>
  );
}

function RefinementNotesPanel({ listingId, scene, onReload }: {
  listingId: string;
  scene: LabListingScene;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene.refinement_notes ?? "");
  const notes = scene.refinement_notes ?? "";

  async function save() {
    await setSceneRefinementNotes(listingId, scene.id, draft.trim() || null);
    setEditing(false);
    onReload();
  }

  async function clear() {
    await setSceneRefinementNotes(listingId, scene.id, null);
    setDraft("");
    setEditing(false);
    onReload();
  }

  if (!notes && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        + Add instructions for future renders
      </button>
    );
  }

  return (
    <div className="border border-amber-400/40 bg-amber-400/5 p-3">
      <div className="flex items-center justify-between">
        <span className="label text-amber-800">Future-render instructions</span>
        {!editing && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(notes); setEditing(true); }}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={clear}><X className="h-3 w-3" /></Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(notes); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-foreground">{notes}</pre>
      )}
    </div>
  );
}

export function SceneCard({ listingId, scene, iterations, photos, defaultModel, onReload, onRateOptimistic, onArchiveSceneOptimistic }: SceneCardProps) {
  const startPhoto = photos.find((p) => p.id === scene.photo_id);
  const endPhoto = scene.end_photo_id ? photos.find((p) => p.id === scene.end_photo_id) : null;
  const [rendering, setRendering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState(scene.director_prompt);
  const [showArchivedIters, setShowArchivedIters] = useState(false);
  const [genAllOpen, setGenAllOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // Newest first so the latest iteration is the default-expanded hero.
  const { orderedIters, archivedCount } = useMemo(() => {
    const sorted = [...iterations].sort((a, b) => b.iteration_number - a.iteration_number);
    const archived = sorted.filter((i) => i.archived).length;
    return {
      orderedIters: showArchivedIters ? sorted : sorted.filter((i) => !i.archived),
      archivedCount: archived,
    };
  }, [iterations, showArchivedIters]);

  async function submitRender(modelOverride?: string) {
    setRendering(true);
    try {
      await renderListing(listingId, { scene_ids: [scene.id], model_override: modelOverride });
      onReload();
    } finally {
      setRendering(false);
    }
  }

  async function handleRefine() {
    if (promptDraft === scene.director_prompt) { setEditing(false); return; }
    await refineScenePrompt(listingId, scene.id, promptDraft);
    setEditing(false);
    onReload();
  }

  async function toggleEndFrame() {
    await setSceneUseEndFrame(listingId, scene.id, !scene.use_end_frame);
    onReload();
  }

  async function archiveScene() {
    if (!confirm(scene.archived ? "Unarchive this scene?" : "Archive this scene? It'll be hidden from the shot plan (toggle to show).")) return;
    if (onArchiveSceneOptimistic) {
      await onArchiveSceneOptimistic(scene.id, !scene.archived);
    } else {
      await setSceneArchived(listingId, scene.id, !scene.archived);
      onReload();
    }
  }

  async function pinSceneMessage(_idx: number, content: string) {
    await pinSceneInstruction(listingId, scene.id, content);
    onReload();
  }

  return (
    <div data-scene-id={scene.id} className={`border bg-background p-5 ${scene.archived ? "border-dashed border-border/60 bg-muted/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="label text-muted-foreground">Scene {scene.scene_number}</span>
          <div className="mt-1 flex flex-wrap gap-2">
            <span className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{scene.room_type}</span>
            <span className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{scene.camera_movement}</span>
            {endPhoto && (
              <span className="border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700">paired</span>
            )}
            {scene.archived && (
              <span className="border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">archived</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={archiveScene} title={scene.archived ? "Unarchive scene" : "Archive scene"}>
          {scene.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
        </Button>
      </div>

      <div className="mt-4">
        <PairVisualization
          startImageUrl={startPhoto?.image_url ?? ""}
          endImageUrl={scene.use_end_frame ? scene.end_image_url : null}
          isPaired={Boolean(endPhoto) && scene.use_end_frame}
        />
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={toggleEndFrame}
            className={`border px-2 py-1 uppercase tracking-wider ${
              scene.use_end_frame
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            End frame: {scene.use_end_frame ? "on" : "off"}
          </button>
          <span className="text-muted-foreground">
            {scene.use_end_frame
              ? "Clip will interpolate start → end."
              : "Clip renders from the start frame only (better for push-ins, closeups, top-downs)."}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <span className="label text-muted-foreground">Director prompt</span>
        {editing ? (
          <div className="mt-2 space-y-2">
            <Textarea value={promptDraft} onChange={(e) => setPromptDraft(e.target.value)} className="text-sm" />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleRefine}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setPromptDraft(scene.director_prompt); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="flex-1 font-sans text-sm">{scene.director_prompt}</p>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Sparkles className="mr-1 h-3 w-3" /> Refine
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4">
        <RefinementNotesPanel listingId={listingId} scene={scene} onReload={onReload} />
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="label text-muted-foreground">Iterations ({orderedIters.length}{archivedCount > 0 ? ` / ${iterations.length}` : ""})</span>
            {archivedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowArchivedIters((s) => !s)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {showArchivedIters ? `Hide archived (${archivedCount})` : `Show archived (${archivedCount})`}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {(() => {
              const isPaired = Boolean(scene.use_end_frame && scene.end_image_url);
              const effectiveModelKey = isPaired ? "kling-v2-1-pair" : defaultModel;
              const effectiveModel = getLabModel(effectiveModelKey);
              return (
                <Button
                  size="sm"
                  onClick={() => submitRender()}
                  disabled={rendering}
                  title={`Render with ${effectiveModel?.label ?? effectiveModelKey} · ${effectiveModel?.priceLabel ?? ""}`}
                >
                  {rendering ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                  Render {effectiveModel?.shortLabel ?? effectiveModelKey}
                  {effectiveModel?.priceLabel && (
                    <span className="ml-1.5 font-sans text-[10px] tabular-nums opacity-70">{effectiveModel.priceLabel}</span>
                  )}
                </Button>
              );
            })()}
            {iterations.filter((i) => i.clip_url).length >= 2 && (
              <Button size="sm" variant="outline" onClick={() => setCompareOpen(true)}>
                <SplitSquareHorizontal className="mr-1 h-3 w-3" />
                Compare
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={rendering}>
                  More <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setGenAllOpen(true)}>
                  <Layers className="mr-2 h-3 w-3" /> Compare models…{" "}
                  <span className="ml-2 text-[10px] text-muted-foreground">(multi-cost)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {genAllOpen && (
          <GenerateAllModal
            sceneLabel={`Scene ${scene.scene_number} · ${scene.room_type} · ${scene.camera_movement}`}
            useEndFrame={scene.use_end_frame}
            usedModels={Array.from(new Set(iterations.filter((i) => i.clip_url && !i.archived).map((i) => i.model_used)))}
            onGenerate={async (models) => {
              await renderSceneWithModels(listingId, scene.id, models);
              onReload();
            }}
            onClose={() => setGenAllOpen(false)}
          />
        )}
        {compareOpen && (
          <CompareModal
            listingId={listingId}
            sceneLabel={`Scene ${scene.scene_number} · ${scene.room_type}`}
            iterations={orderedIters.filter((i) => i.clip_url)}
            onClose={() => setCompareOpen(false)}
            onReload={onReload}
          />
        )}

        {orderedIters.length === 0 && (
          <p className="text-xs text-muted-foreground">No iterations yet. Click Render to generate the first clip.</p>
        )}

        {orderedIters.map((iter, i) => (
          <IterationSection
            key={iter.id}
            listingId={listingId}
            scene={scene}
            iter={iter}
            defaultExpanded={i === 0}
            onReload={onReload}
            onRateOptimistic={onRateOptimistic}
          />
        ))}
      </div>

      <div className="mt-6">
        <ChatPanel
          messages={scene.chat_messages}
          onSend={(m, cb) => chatSceneStream(listingId, scene.id, m, cb)}
          onClear={async () => { await clearSceneChat(listingId, scene.id); onReload(); }}
          onPinMessage={pinSceneMessage}
          onServerChange={onReload}
          emptyHint="Chat with Claude about this scene. Ask about specific iterations (#1, #2...), request prompt changes, save directives for future renders, or compare what's working across iterations. Claude sees all ratings, reasons, and comments."
          placeholder="Ask or instruct... (Enter to send, Shift+Enter for newline)"
          headerLabel="Scene chat"
        />
      </div>
    </div>
  );
}
