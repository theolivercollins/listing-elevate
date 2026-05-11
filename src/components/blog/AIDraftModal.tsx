import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { generateAIDraft, listTemplates } from "@/lib/blog/api-client";
import type { AIDraftResult } from "@/lib/blog/types";
import { HtmlPreview } from "./HtmlPreview";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onAccept: (html: string) => void;
  currentHtml: string;
}

export function AIDraftModal({ open, onClose, onAccept, currentHtml }: Props) {
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [length, setLength] = useState<"short" | "standard" | "long">("standard");
  const [tone, setTone] = useState<"professional" | "casual" | "data_driven">("professional");
  const [result, setResult] = useState<AIDraftResult | null>(null);

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"], queryFn: () => listTemplates(), enabled: open,
  });
  const templates = tplData?.templates ?? [];

  const gen = useMutation({
    mutationFn: () => generateAIDraft({
      prompt, template_id: templateId || null, length, tone,
    }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast.error(`Generation failed: ${e?.message ?? e}`),
  });

  function reset() { setResult(null); setPrompt(""); setTemplateId(""); }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Generate post with AI</DialogTitle></DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div>
              <Label>Template (optional)</Label>
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value)}
                className="block w-full rounded-md border bg-background p-2 text-sm"
              >
                <option value="">— None —</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">Provides structural HTML the AI fills in.</p>
            </div>
            <div>
              <Label>What should this post be about? *</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder='e.g. "Punta Gorda May 2026 market update — median price up, inventory tightening, mortgage rates at 6.5%."'
                rows={5}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Length</Label>
                <div className="flex gap-1 pt-1">
                  {(["short", "standard", "long"] as const).map(l => (
                    <Button key={l} size="sm" variant={length === l ? "default" : "outline"} onClick={() => setLength(l)} type="button">{l}</Button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Tone</Label>
                <div className="flex gap-1 pt-1">
                  {(["professional", "casual", "data_driven"] as const).map(t => (
                    <Button key={t} size="sm" variant={tone === t ? "default" : "outline"} onClick={() => setTone(t)} type="button">{t.replace("_", " ")}</Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => gen.mutate()} disabled={prompt.length < 3 || gen.isPending}>
                {gen.isPending ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Generating…</> : "Generate"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Original</div>
                <HtmlPreview html={currentHtml || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: 320, border: "1px solid #e5e7eb", borderRadius: 4 }} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Generated</div>
                <HtmlPreview html={result.html} style={{ width: "100%", height: 320, border: "1px solid #e5e7eb", borderRadius: 4 }} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Cost: ${(result.cost_cents / 100).toFixed(2)} · Model: {result.model} · {result.usage.input_tokens} in / {result.usage.output_tokens} out tokens
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResult(null)}>Regenerate</Button>
              <Button variant="ghost" onClick={onClose}>Discard</Button>
              <Button onClick={() => { onAccept(result.html); reset(); onClose(); }}>Use this</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
