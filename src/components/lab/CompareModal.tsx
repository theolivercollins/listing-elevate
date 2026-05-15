import { useState } from "react";
import { X, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rateIteration, type LabListingIteration } from "@/lib/labListingsApi";
import { getLabModel } from "@/lib/labModels";

interface CompareModalProps {
  listingId: string;
  sceneLabel: string;
  iterations: LabListingIteration[];
  onClose: () => void;
  onReload: () => void;
}

function Stars({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} className="p-0.5">
          <Star className={`h-4 w-4 ${value !== null && n <= value ? "fill-foreground text-foreground" : "text-muted-foreground/40 hover:text-foreground"}`} />
        </button>
      ))}
    </div>
  );
}

export function CompareModal({ listingId, sceneLabel, iterations, onClose, onReload }: CompareModalProps) {
  const [localRatings, setLocalRatings] = useState<Record<string, number | null>>(
    Object.fromEntries(iterations.map((i) => [i.id, i.rating])),
  );

  async function handleRate(iterId: string, n: number) {
    setLocalRatings((r) => ({ ...r, [iterId]: n }));
    await rateIteration(listingId, iterId, { rating: n });
    onReload();
  }

  const playable = iterations.filter((i) => i.clip_url);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex max-h-[95vh] w-full max-w-[min(1800px,95vw)] flex-col border border-border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <span className="label text-muted-foreground">Compare · {playable.length} of {iterations.length} iterations playable</span>
            <p className="mt-0.5 text-sm">{sceneLabel}</p>
            <p className="text-[10px] text-muted-foreground">Letter key = A/B/C order across models. Click stars to rate — Save closes and returns to the scene view.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div
          className="grid flex-1 auto-rows-fr gap-3 overflow-y-auto p-4"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))` }}
        >
          {playable.map((iter, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const model = getLabModel(iter.model_used);
            const rating = localRatings[iter.id] ?? null;
            return (
              <div key={iter.id} className="flex flex-col border border-border bg-muted/20">
                <div className="flex items-start justify-between gap-2 border-b border-border bg-background px-3 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-foreground bg-foreground text-sm font-semibold text-background">{letter}</span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{model?.label ?? iter.model_used}</div>
                      <div className="font-sans text-[10px] text-muted-foreground">#{iter.iteration_number} · {model?.priceLabel ?? ""}</div>
                      {model?.note && (
                        <div className="mt-1 line-clamp-2 text-[10px] italic text-muted-foreground">{model.note}</div>
                      )}
                    </div>
                  </div>
                  <Stars value={rating} onChange={(n) => handleRate(iter.id, n)} />
                </div>
                {iter.clip_url && (
                  <video controls src={iter.clip_url} className="aspect-video w-full bg-black" preload="metadata" />
                )}
                {iter.rating_reasons && iter.rating_reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 p-2">
                    {iter.rating_reasons.map((r) => (
                      <span key={r} className="border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        {r.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
