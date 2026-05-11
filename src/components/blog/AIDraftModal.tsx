import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { generateAIDraft, listTemplates } from "@/lib/blog/api-client";
import type { AIDraftResult } from "@/lib/blog/types";
import type { AIAttachment } from "@/lib/blog/types";
import { HtmlPreview } from "./HtmlPreview";
import { Loader2, Paperclip, Sparkles } from "lucide-react";
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
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const [pasteData, setPasteData] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"], queryFn: () => listTemplates(), enabled: open,
  });
  const templates = tplData?.templates ?? [];

  const gen = useMutation({
    mutationFn: () => generateAIDraft({
      prompt,
      template_id: templateId || null,
      length,
      tone,
      attachments: attachments.length ? attachments : undefined,
      paste_data: pasteData.trim() || undefined,
    }),
    onSuccess: (r) => setResult(r),
    onError: (e: any) => toast.error(`Generation failed: ${e?.message ?? e}`),
  });

  function reset() {
    setResult(null);
    setPrompt("");
    setTemplateId("");
    setAttachments([]);
    setPasteData("");
  }

  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // reset so same file can re-select
    const slots = 5 - attachments.length;
    for (const file of files.slice(0, slots)) {
      if (file.size > 3_500_000) { toast.error(`${file.name} > 3MB`); continue; }
      const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
      const isImage = file.type.startsWith("image/");
      const isText = file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt");
      if (!isPdf && !isImage && !isText) { toast.error(`${file.name}: unsupported type`); continue; }

      if (isText) {
        const text = await file.text();
        if (text.length > 100_000) { toast.error(`${file.name}: text > 100KB`); continue; }
        setAttachments(prev => [...prev, { kind: "text", filename: file.name, data: text }]);
      } else {
        // base64 encode (read as ArrayBuffer → btoa over Uint8Array chunks)
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
        }
        const b64 = btoa(binary);
        setAttachments(prev => [...prev, {
          kind: isPdf ? "pdf" : "image",
          filename: file.name,
          data: b64,
          media_type: isPdf ? "application/pdf" : (file.type || "image/jpeg"),
        }]);
      }
    }
  }

  function formatBytes(n: number) {
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

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

            {/* Reference data section */}
            <div className="space-y-2">
              <Label>Reference data (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Attach a market report PDF, chart image, or CSV. Or paste raw stats below.
                Claude is instructed to use ONLY these numbers — it will say &quot;data not available&quot; if a stat is missing rather than fabricating.
              </p>

              {/* File list */}
              {attachments.length > 0 && (
                <div className="space-y-1">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-xs">
                      <span className="font-mono">{a.kind === "pdf" ? "📎" : a.kind === "image" ? "🖼" : "📋"}</span>
                      <span className="truncate flex-1">{a.filename}</span>
                      <span className="text-muted-foreground">{formatBytes(a.kind === "text" ? a.data.length : (a.data.length * 3) / 4)}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeAttachment(i)}>×</Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={attachments.length >= 5}>
                  <Paperclip className="mr-1 h-3.5 w-3.5" /> Add file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,application/pdf,image/*,text/csv,text/plain"
                  multiple
                  className="hidden"
                  onChange={onFileChange}
                />
                <span className="self-center text-xs text-muted-foreground">PDF / image / CSV / .txt · up to 5 files · max 3MB each</span>
              </div>

              <Textarea
                value={pasteData}
                onChange={(e) => setPasteData(e.target.value)}
                placeholder={'Or paste raw data:\n\nMedian price: $385K (+3.2% YoY)\nDays on market: 28\nInventory: 1,847 active listings'}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Files are sent to Anthropic&apos;s API for content generation. Don&apos;t include private/PII data.
              </p>
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
