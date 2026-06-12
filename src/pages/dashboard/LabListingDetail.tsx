import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, RefreshCw, Play, Archive, Images, ArrowLeft, Clapperboard } from "lucide-react";
import { DirectorModal } from "@/components/lab/DirectorModal";
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
import { PageHeading, StatusChip, Card, fmtMoney } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

// Map lab listing statuses → design system status tokens
const LAB_STATUS_MAP: Record<string, string> = {
  draft: "queued",
  analyzing: "analyzing",
  directing: "scripting",
  ready_to_render: "complete",
  rendering: "generating",
  complete: "complete",
  failed: "failed",
};

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
  const [directorOpen, setDirectorOpen] = useState(false);

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
        // Mirrors server-side DQ.3: paired scenes auto-route to kling-v3-pro.
        const modelKey = isPaired ? "kling-v3-pro" : (listing?.model_name ?? "kling-v2-6-pro");
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

  if (loading && !listing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 32, color: "var(--muted)", fontSize: 13 }}>
        <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
        Loading…
      </div>
    );
  }
  if (!listing) {
    return (
      <p style={{ padding: 32, fontSize: 13, color: "var(--muted)" }}>Listing not found.</p>
    );
  }

  const dsStatus = LAB_STATUS_MAP[listing.status] ?? "queued";
  const byModelStr = Object.entries(stats.byModel)
    .map(([m, c]) => `${m}: ${fmtMoney(c)}`)
    .join(" · ");

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeading
        eyebrow="Lab · Listing"
        title={listing.name}
        sub={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <StatusChip status={dsStatus} />
            <span style={{ color: "var(--muted-2)" }}>{listing.model_name}</span>
            {listing.notes && (
              <span style={{ color: "var(--muted)", fontStyle: "italic" }}>{listing.notes}</span>
            )}
          </span>
        }
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="le-btn-ghost"
              onClick={reload}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw style={{ width: 13, height: 13 }} />
              Refresh
            </button>
            <button
              type="button"
              className="le-btn-ghost"
              onClick={rerunDirector}
              disabled={actionLoading === "direct"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: actionLoading === "direct" ? 0.5 : 1,
              }}
            >
              {actionLoading === "direct" && (
                <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
              )}
              Re-direct
            </button>
            <button
              type="button"
              className="le-btn-ghost"
              onClick={() => setDirectorOpen(true)}
              title="Open Director — assemble rendered clips into a final video"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Clapperboard style={{ width: 13, height: 13 }} />
              Direct
            </button>
            <button
              type="button"
              className="le-btn-dark"
              onClick={renderAllUnrendered}
              disabled={actionLoading === "render-all"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                opacity: actionLoading === "render-all" ? 0.5 : 1,
              }}
            >
              {actionLoading === "render-all" ? (
                <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
              ) : (
                <Play style={{ width: 13, height: 13 }} />
              )}
              Render all
            </button>
            <button
              type="button"
              onClick={archive}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                background: "transparent",
                border: "1px solid var(--line)",
                color: "var(--muted)",
                cursor: "pointer",
              }}
              title="Archive listing"
            >
              <Archive style={{ width: 13, height: 13 }} />
            </button>
          </div>
        }
      />

      {/* Back link */}
      <div>
        <Link
          to="/dashboard/development/lab"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11.5,
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          <ArrowLeft style={{ width: 11, height: 11 }} />
          Back to listings
        </Link>
      </div>

      {/* Stats strip */}
      <Card padding={0}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
          }}
        >
          <StatCell
            label="Scenes"
            value={`${stats.rendered} / ${scenes.length}`}
            sub="rendered"
          />
          <StatCell
            label="Iterations"
            value={String(iterations.filter((i) => !i.archived).length)}
            sub={iterations.length !== iterations.filter((i) => !i.archived).length ? `${iterations.length} total` : undefined}
          />
          <StatCell
            label="Cost"
            value={fmtMoney(stats.totalCents)}
            sub={byModelStr || undefined}
          />
          <StatCell
            label="Photos"
            value={String(photos.length)}
            sub={
              <button
                type="button"
                onClick={() => setPhotosOpen((o) => !o)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "none",
                  border: "none",
                  padding: 0,
                  fontSize: 11,
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontFamily: "var(--le-font-sans)",
                }}
              >
                <Images style={{ width: 11, height: 11 }} />
                {photosOpen ? "hide" : "show"}
              </button>
            }
          />
          <StatCell
            label="Created"
            value={new Date(listing.created_at).toLocaleDateString()}
            sub={new Date(listing.created_at).toLocaleTimeString()}
            last
          />
        </div>

        {photosOpen && (
          <div
            style={{
              borderTop: "1px solid var(--line-2)",
              padding: "12px 20px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 4,
              }}
            >
              {photos.map((p) => (
                <div
                  key={p.id}
                  style={{
                    position: "relative",
                    aspectRatio: "16/9",
                    overflow: "hidden",
                    borderRadius: 6,
                    background: "var(--bg)",
                    border: "1px solid var(--line-2)",
                  }}
                >
                  <img
                    src={p.image_url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    loading="lazy"
                  />
                  <span
                    style={{
                      position: "absolute",
                      bottom: 2,
                      left: 3,
                      fontSize: 8,
                      fontWeight: 600,
                      background: "rgba(0,0,0,0.6)",
                      color: "#fff",
                      padding: "1px 4px",
                      borderRadius: 3,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {p.photo_index}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(196,74,74,0.07)",
            border: "1px solid rgba(196,74,74,0.18)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          {error}
        </div>
      )}

      {scenes.length === 0 ? (
        <Card padding={40}>
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {listing.status === "analyzing" || listing.status === "directing"
              ? "Director is planning scenes…"
              : "No scenes yet. Click Re-direct to run the director."}
          </div>
        </Card>
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

          {/* 2-column layout: scene grid left, side panel right */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 320px",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Left: shot plan */}
            <Card padding={20}>
              <ShotPlanTable
                scenes={scenes}
                iterations={iterations}
                photos={photos}
                selectedSceneId={selectedSceneId}
                onSelect={setSelectedSceneId}
              />
            </Card>

            {/* Right: selected scene detail + photos strip */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {selectedScene && (
                <Card padding={20}>
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
                </Card>
              )}

              {/* Photos metadata side panel */}
              {photos.length > 0 && (
                <Card padding={20}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--muted)",
                      marginBottom: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Photos · {photos.length}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                    {photos.slice(0, 16).map((p) => (
                      <div
                        key={p.id}
                        style={{
                          position: "relative",
                          aspectRatio: "16/9",
                          overflow: "hidden",
                          borderRadius: 6,
                          background: "var(--bg)",
                        }}
                      >
                        <img
                          src={p.image_url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                  {photos.length > 16 && (
                    <p style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                      +{photos.length - 16} more
                    </p>
                  )}
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {/* Director modal — assembles rendered listing clips into a final video */}
      <DirectorModal
        source={{ kind: "listing", listingId: id }}
        open={directorOpen}
        onClose={() => setDirectorOpen(false)}
      />
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  last = false,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: last ? "none" : "1px solid var(--line-2)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.015em",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 3, fontSize: 11, color: "var(--muted)" }}>{sub}</div>
      )}
    </div>
  );
}
