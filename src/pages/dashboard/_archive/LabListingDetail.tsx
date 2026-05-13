import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, RefreshCw, Play, Archive, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NextActionBanner } from "@/components/lab/NextActionBanner";
import { SceneCard } from "@/components/lab/SceneCard";
import { ShotPlanTable } from "@/components/lab/ShotPlanTable";
import { resolveNextAction } from "@/lib/labNextAction";
import {
  getListing,
  directListing,
  renderListing,
  patchListing,
  setSceneArchived,
  type LabListing,
  type LabListingPhoto,
  type LabListingScene,
  type LabListingIteration,
} from "@/lib/labListingsApi";
import { rateIteration as rateIterationApi } from "@/lib/labListingsApi";
import { getLabModel } from "@/lib/labModels";

export default function LabListingDetail() {
  const { id = "" } = useParams();
  const [listing, setListing] = useState<LabListing | null>(null);
  const [photos, setPhotos] = useState<LabListingPhoto[]>([]);
  const [scenes, setScenes] = useState<LabListingScene[]>([]);
  const [iterations, setIterations] = useState<LabListingIteration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getListing(id);
      setListing(data.listing);
      setPhotos(data.photos);
      setScenes(data.scenes);
      setIterations(data.iterations);
      if (!selectedSceneId && data.scenes.length > 0) {
        setSelectedSceneId(data.scenes[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    const interval = setInterval(() => {
      if (listing && ["analyzing", "directing", "rendering"].includes(listing.status)) {
        reload();
      }
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, listing?.status]);

  async function renderAllUnrendered() {
    if (!id) return;
    setActionLoading("render-all");
    try {
      const renderedSceneIds = new Set(iterations.map((i) => i.scene_id));
      const unrenderedScenes = scenes.filter((s) => !s.archived && !renderedSceneIds.has(s.id));
      if (unrenderedScenes.length === 0) return;
      const totalCents = unrenderedScenes.reduce((sum, s) => {
        const isPaired = Boolean(s.use_end_frame && s.end_image_url);
        const modelKey = isPaired ? "kling-v2-1-pair" : (listing?.model_name ?? "kling-v2-6-pro");
        return sum + (getLabModel(modelKey)?.priceCents ?? 0);
      }, 0);
      const confirmed = window.confirm(
        `Render ${unrenderedScenes.length} scene${unrenderedScenes.length === 1 ? "" : "s"} at $${(totalCents / 100).toFixed(2)} total (real SKU pricing)?`,
      );
      if (!confirmed) return;
      await renderListing(id, { scene_ids: unrenderedScenes.map((s) => s.id) });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function rerunDirector() {
    if (!id) return;
    setActionLoading("direct");
    try {
      await directListing(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function archive() {
    if (!id) return;
    const confirmed = window.confirm("Archive this listing? It'll be hidden from the list but kept.");
    if (!confirmed) return;
    await patchListing(id, { archived: true });
    window.location.href = "/dashboard/development/lab";
  }

  async function rateOptimistic(iterId: string, patch: {
    rating?: number | null;
    reasons?: string[] | null;
    comment?: string | null;
    archived?: boolean;
  }): Promise<void> {
    const prev = iterations;
    setIterations((cur) =>
      cur.map((i) =>
        i.id === iterId
          ? {
              ...i,
              rating: patch.rating !== undefined ? patch.rating : i.rating,
              rating_reasons: patch.reasons ?? i.rating_reasons,
              user_comment: patch.comment !== undefined ? patch.comment : i.user_comment,
              archived: patch.archived !== undefined ? patch.archived : i.archived,
            }
          : i,
      ),
    );
    try {
      const res = await rateIterationApi(id, iterId, patch);
      setIterations((cur) => cur.map((i) => (i.id === iterId ? res.iteration : i)));
    } catch (err) {
      setIterations(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function archiveSceneOptimistic(sceneId: string, archived: boolean): Promise<void> {
    const prev = scenes;
    setScenes((cur) => cur.map((s) => (s.id === sceneId ? { ...s, archived } : s)));
    try {
      await setSceneArchived(id, sceneId, archived);
    } catch (err) {
      setScenes(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const stats = useMemo(() => {
    const rendered = scenes.filter((s) =>
      iterations.some((i) => i.scene_id === s.id && (i.status === "rendered" || i.status === "rated"))
    ).length;
    const totalCents = iterations.reduce((sum, i) => sum + (i.cost_cents ?? 0), 0);
    const byModel = iterations.reduce<Record<string, number>>((acc, i) => {
      acc[i.model_used] = (acc[i.model_used] ?? 0) + (i.cost_cents ?? 0);
      return acc;
    }, {});
    return { rendered, totalCents, byModel };
  }, [scenes, iterations]);

  const nextAction = useMemo(() => resolveNextAction({ scenes, iterations }), [scenes, iterations]);

  function handleRateNext(sceneId: string) {
    setSelectedSceneId(sceneId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-scene-id="${sceneId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  async function handleRenderBatch(sceneIds: string[]) {
    setActionLoading("next-action");
    try {
      await renderListing(id, { scene_ids: sceneIds });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading(null);
    }
  }

  function handleRetryFailed(sceneId: string) {
    setSelectedSceneId(sceneId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-scene-id="${sceneId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function handleIterate(sceneId: string) {
    setSelectedSceneId(sceneId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-scene-id="${sceneId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? null;
  const selectedIterations = selectedScene
    ? iterations.filter((i) => i.scene_id === selectedScene.id).sort((a, b) => a.iteration_number - b.iteration_number)
    : [];

  if (loading && !listing) return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!listing) return <p className="p-8 text-sm text-muted-foreground">Listing not found.</p>;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/dashboard/development/lab" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> back to listings
        </Link>
      </div>

      <div className="border border-border bg-background">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-semibold tracking-[-0.02em]">{listing.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="border border-border px-2 py-0.5 uppercase tracking-wider">{listing.status}</span>
              <span className="border border-border px-2 py-0.5 uppercase tracking-wider">{listing.model_name}</span>
              {listing.notes && <span className="truncate italic">{listing.notes}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="mr-1 h-3 w-3" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={rerunDirector} disabled={actionLoading === "direct"}>
              {actionLoading === "direct" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Re-direct
            </Button>
            <Button size="sm" onClick={renderAllUnrendered} disabled={actionLoading === "render-all"}>
              {actionLoading === "render-all" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              Render all
            </Button>
            <Button variant="ghost" size="sm" onClick={archive}><Archive className="h-3 w-3" /></Button>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-border text-xs sm:grid-cols-4 lg:grid-cols-5">
          <Stat label="Scenes" value={`${stats.rendered} / ${scenes.length}`} sub="rendered" />
          <Stat label="Iterations" value={String(iterations.filter((i) => !i.archived).length)} sub={iterations.length !== iterations.filter((i) => !i.archived).length ? `${iterations.length} total` : undefined} />
          <Stat label="Cost" value={`$${(stats.totalCents / 100).toFixed(2)}`} sub={Object.entries(stats.byModel).map(([m, c]) => `${m}: $${(c / 100).toFixed(2)}`).join(" • ") || undefined} />
          <Stat label="Photos" value={String(photos.length)} sub={
            <button type="button" onClick={() => setPhotosOpen((o) => !o)} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              <Images className="h-3 w-3" /> {photosOpen ? "hide" : "show"}
            </button>
          } />
          <Stat label="Created" value={new Date(listing.created_at).toLocaleDateString()} sub={new Date(listing.created_at).toLocaleTimeString()} />
        </div>
        {photosOpen && (
          <div className="border-t border-border px-5 py-3">
            <div className="grid grid-cols-6 gap-1 md:grid-cols-10 lg:grid-cols-12">
              {photos.map((p) => (
                <div key={p.id} className="relative aspect-video overflow-hidden border border-border bg-muted">
                  <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <span className="absolute bottom-0.5 left-0.5 bg-black/60 px-1 py-0.5 text-[8px] uppercase tracking-wider text-white">
                    {p.photo_index}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      {scenes.length === 0 ? (
        <div className="border border-border bg-background p-8 text-center text-sm text-muted-foreground">
          {listing.status === "analyzing" || listing.status === "directing"
            ? "Director is planning scenes…"
            : "No scenes yet. Click Re-direct to run the director."}
        </div>
      ) : (
        <>
          <NextActionBanner
            action={nextAction}
            busy={actionLoading === "next-action"}
            onRate={handleRateNext}
            onRenderBatch={handleRenderBatch}
            onRetry={handleRetryFailed}
            onIterate={handleIterate}
          />
          <ShotPlanTable
            scenes={scenes}
            iterations={iterations}
            photos={photos}
            selectedSceneId={selectedSceneId}
            onSelect={setSelectedSceneId}
          />

          {selectedScene && (
            <SceneCard
              listingId={id}
              scene={selectedScene}
              iterations={selectedIterations}
              photos={photos}
              defaultModel={listing.model_name}
              onReload={reload}
              onRateOptimistic={rateOptimistic}
              onArchiveSceneOptimistic={archiveSceneOptimistic}
            />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="border-r border-border px-5 py-3 last:border-r-0">
      <div className="label text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
