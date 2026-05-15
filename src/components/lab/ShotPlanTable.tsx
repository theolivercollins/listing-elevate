import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import type { LabListingScene, LabListingIteration, LabListingPhoto } from "@/lib/labListingsApi";
import { resolveSceneStatus, type SceneStatusKind } from "@/lib/labSceneStatus";

interface ShotPlanTableProps {
  scenes: LabListingScene[];
  iterations: LabListingIteration[];
  photos: LabListingPhoto[];
  selectedSceneId: string | null;
  onSelect: (sceneId: string) => void;
}

export function ShotPlanTable({ scenes: allScenes, iterations, photos, selectedSceneId, onSelect }: ShotPlanTableProps) {
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const [showArchived, setShowArchived] = useState(false);

  const PRIORITY: Record<SceneStatusKind, number> = {
    needs_rating: 0,
    failed: 1,
    iterating: 2,
    needs_first_render: 3,
    rendering: 4,
    done: 5,
    archived: 6,
  };

  const { scenes, archivedCount } = useMemo(() => {
    const arch = allScenes.filter((s) => s.archived).length;
    const visible = showArchived ? allScenes : allScenes.filter((s) => !s.archived);
    const sorted = [...visible].sort((a, b) => {
      const sa = resolveSceneStatus({ scene: a, iterations: iterations.filter((i) => i.scene_id === a.id) });
      const sb = resolveSceneStatus({ scene: b, iterations: iterations.filter((i) => i.scene_id === b.id) });
      const diff = PRIORITY[sa.kind] - PRIORITY[sb.kind];
      if (diff !== 0) return diff;
      return a.scene_number - b.scene_number;
    });
    return { scenes: sorted, archivedCount: arch };
  }, [allScenes, iterations, showArchived]);

  return (
    <div className="border border-border">
      <div className="grid grid-cols-[60px_40px_1fr_120px_80px_80px_80px_110px] items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span />
        <span>#</span>
        <span>Scene</span>
        <span>Movement</span>
        <span className="text-right">Iters</span>
        <span className="text-right">Best</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Status</span>
      </div>
      {scenes.map((s) => {
        const photo = photoById.get(s.photo_id);
        const sceneIters = iterations.filter((i) => i.scene_id === s.id);
        const visibleIters = sceneIters.filter((i) => !i.archived);
        const bestRating = sceneIters.reduce<number | null>((best, i) => {
          if (i.rating === null) return best;
          return best === null || i.rating > best ? i.rating : best;
        }, null);
        const cost = sceneIters.reduce((sum, i) => sum + (i.cost_cents ?? 0), 0);
        const status = resolveSceneStatus({
          scene: s,
          iterations: sceneIters,
        });
        const statusLabel: Record<SceneStatusKind, string> = {
          needs_rating: "rate",
          needs_first_render: "render",
          rendering: "rendering",
          iterating: "iterate",
          failed: "failed",
          done: "done",
          archived: "archived",
        };
        const statusColor: Record<SceneStatusKind, string> = {
          needs_rating: "border-teal-500/40 bg-teal-500/10 text-teal-700",
          needs_first_render: "border-sky-500/40 bg-sky-500/10 text-sky-700",
          rendering: "border-amber-400/40 bg-amber-400/10 text-amber-700",
          iterating: "border-violet-500/40 bg-violet-500/10 text-violet-700",
          failed: "border-red-500/40 bg-red-500/10 text-red-700",
          done: "border-slate-400/40 bg-slate-400/10 text-slate-600",
          archived: "border-border bg-muted text-muted-foreground",
        };
        const selected = selectedSceneId === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`grid w-full grid-cols-[60px_40px_1fr_120px_80px_80px_80px_110px] items-center gap-3 border-b border-border px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
              selected ? "bg-foreground/5" : "hover:bg-muted/40"
            } ${s.archived ? "opacity-60" : ""}`}
          >
            <div className="relative h-9 w-14 overflow-hidden border border-border bg-muted">
              {photo && <img src={photo.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
            </div>
            <span className="font-sans text-muted-foreground">{String(s.scene_number).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{s.room_type}</div>
              <div className="truncate text-[10px] text-muted-foreground">{s.director_prompt.slice(0, 80)}</div>
            </div>
            <span className="truncate text-muted-foreground">{s.camera_movement}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {visibleIters.length}{sceneIters.length !== visibleIters.length && <span className="text-[10px]">/{sceneIters.length}</span>}
            </span>
            <span className="text-right tabular-nums">
              {bestRating !== null ? (
                <span className="inline-flex items-center gap-0.5">
                  {bestRating}<Star className="h-2.5 w-2.5 fill-foreground" />
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {cost > 0 ? `$${(cost / 100).toFixed(2)}` : "—"}
            </span>
            <span className="text-right">
              <span className={`inline-block border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${statusColor[status.kind]}`}>
                {statusLabel[status.kind]}
              </span>
            </span>
          </button>
        );
      })}
      {archivedCount > 0 && (
        <div className="flex items-center justify-center border-t border-border bg-muted/30 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showArchived ? `Hide archived scenes (${archivedCount})` : `Show archived scenes (${archivedCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
