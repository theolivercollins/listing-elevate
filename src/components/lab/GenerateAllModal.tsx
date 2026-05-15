import { useState } from "react";
import { X, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LAB_MODELS } from "@/lib/labModels";

interface GenerateAllModalProps {
  sceneLabel: string;
  useEndFrame: boolean;
  usedModels?: string[];
  onGenerate: (modelKeys: string[]) => Promise<void>;
  onClose: () => void;
}

export function GenerateAllModal({ sceneLabel, useEndFrame, usedModels = [], onGenerate, onClose }: GenerateAllModalProps) {
  const usedSet = new Set(usedModels);
  const visibleModels = LAB_MODELS.filter((m) => !m.hidden);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(visibleModels.filter((m) => m.key !== "kling-v2-master" && m.key !== "kling-v2-native" && !usedSet.has(m.key)).map((m) => m.key))
  );
  const [submitting, setSubmitting] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chosen = visibleModels.filter((m) => selected.has(m.key));
  const totalCents = chosen.reduce((sum, m) => sum + m.priceCents, 0);

  async function submit() {
    const confirmed = window.confirm(
      `Fire ${chosen.length} render${chosen.length === 1 ? "" : "s"} at $${(totalCents / 100).toFixed(2)} total? This is a multi-model comparison — use only when you want to A/B test.`,
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await onGenerate([...selected]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg border border-border bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <span className="label text-muted-foreground">Compare models</span>
            <p className="mt-1 text-sm">{sceneLabel}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              One iteration per selected model. Already-tested models are pre-unchecked — tick to re-render.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-1">
          {visibleModels.map((m) => {
            const picked = selected.has(m.key);
            const used = usedSet.has(m.key);
            const pairIncompatible = useEndFrame && !m.supportsEndFrame;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                className={`flex w-full items-center justify-between gap-3 border px-3 py-2 text-left text-xs transition-colors ${
                  picked
                    ? "border-foreground bg-foreground/5"
                    : used
                    ? "border-border/60 bg-muted/30 text-muted-foreground opacity-60 hover:opacity-90"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{m.label}</span>
                    {used && !picked && (
                      <span className="border border-border px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">already tested</span>
                    )}
                  </div>
                  {m.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{m.note}</div>}
                  {pairIncompatible && (
                    <div className="mt-0.5 text-[10px] text-amber-700">Scene has end-frame on; this model will render start-only.</div>
                  )}
                </div>
                <span className="font-sans tabular-nums text-muted-foreground">{m.priceLabel}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            {chosen.length} model{chosen.length === 1 ? "" : "s"} · total <span className="font-sans tabular-nums text-foreground">${(totalCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={submitting || chosen.length === 0}>
              {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              Render {chosen.length}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
