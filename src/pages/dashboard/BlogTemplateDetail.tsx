import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PostEditor, type EditorMode } from "@/components/blog/PostEditor";
import { analyzeTemplate, createTemplate, getTemplate, getTaxonomy, updateTemplate } from "@/lib/blog/api-client";
import type { AnalyzeTemplateResult } from "@/lib/blog/types";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import { DashboardCard } from "@/v2/components/dashboard/DashboardCard";
import { StatusPill } from "@/v2/components/dashboard/StatusPill";
import { toast } from "sonner";
import { Loader2, Sparkles, Upload } from "lucide-react";

export default function BlogTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-template", id],
    queryFn: () => getTemplate(id!),
    enabled: !isNew,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body_html, setBodyHtml] = useState("");
  const [mode, setMode] = useState<EditorMode>("source");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeTemplateResult | null>(null);
  const [defaultAuthorLabel, setDefaultAuthorLabel] = useState("");
  const [defaultCategoryLabel, setDefaultCategoryLabel] = useState("");
  const [defaultMetaTitle, setDefaultMetaTitle] = useState("");
  const [defaultMetaDescription, setDefaultMetaDescription] = useState("");
  const [defaultMetaTags, setDefaultMetaTags] = useState("");

  const { data: taxonomyData } = useQuery({ queryKey: ["blog-taxonomy"], queryFn: () => getTaxonomy() });
  const taxonomy = taxonomyData ?? { authors: [], categories: [] };

  useEffect(() => {
    if (data?.template) {
      setName(data.template.name);
      setDescription(data.template.description ?? "");
      setBodyHtml(data.template.body_html);
      setDefaultAuthorLabel(data.template.default_author_label ?? "");
      setDefaultCategoryLabel(data.template.default_category_label ?? "");
      setDefaultMetaTitle(data.template.default_meta_title ?? "");
      setDefaultMetaDescription(data.template.default_meta_description ?? "");
      setDefaultMetaTags((data.template.default_meta_tags ?? []).join(", "));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const defaults = {
        default_author_label: defaultAuthorLabel || null,
        default_category_label: defaultCategoryLabel || null,
        default_meta_title: defaultMetaTitle || null,
        default_meta_description: defaultMetaDescription || null,
        default_meta_tags: defaultMetaTags
          ? defaultMetaTags.split(",").map(t => t.trim()).filter(Boolean)
          : [],
      };
      if (isNew) return createTemplate({ name, description: description || undefined, body_html, ...defaults });
      await updateTemplate(id!, { name, description: description || null, body_html, ...defaults });
      return { id: id! };
    },
    onSuccess: (r) => {
      toast.success(isNew ? "Created" : "Saved");
      qc.invalidateQueries({ queryKey: ["blog-templates"] });
      navigate(`/dashboard/blog/templates`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? e}`),
  });

  const analyze = useMutation({
    mutationFn: () => analyzeTemplate(body_html),
    onSuccess: (r) => setAnalyzeResult(r),
    onError: (e: any) => toast.error(`Analyze failed: ${e?.message ?? e}`),
  });

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { toast.error("File > 1MB"); return; }
    file.text().then((text) => { setBodyHtml(text); toast.success(`Loaded ${file.name}`); });
  }

  if (!isNew && isLoading) return <div>Loading…</div>;

  return (
    <div>
      <h1 className="mb-4 le-display text-[28px] font-medium tracking-tight">
        {isNew ? "New template" : `Edit: ${name}`}
      </h1>
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly Market Update" />
        </div>
        <div>
          <Label>Description (optional)</Label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="When to use this template" />
        </div>

        <DashboardCard padding="sm" style={{ background: "var(--le-bg-sunken)" }}>
          <div className="space-y-3">
            <div>
              <Label className="text-base">Default fields (optional)</Label>
              <p className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                When this template is selected on a new post, these values pre-fill the sidebar.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Default author</Label>
                <select
                  value={defaultAuthorLabel}
                  onChange={e => setDefaultAuthorLabel(e.target.value)}
                  className="block w-full rounded-[8px] border px-2 py-1.5 text-sm"
                  style={{
                    borderColor: "var(--le-border)",
                    background: "var(--le-bg-elev)",
                  }}
                >
                  <option value="">— None —</option>
                  {taxonomy.authors.filter(a => a.label && !a.label.toLowerCase().startsWith("select")).map(a => (
                    <option key={a.id} value={a.label}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Default category</Label>
                <select
                  value={defaultCategoryLabel}
                  onChange={e => setDefaultCategoryLabel(e.target.value)}
                  className="block w-full rounded-[8px] border px-2 py-1.5 text-sm"
                  style={{
                    borderColor: "var(--le-border)",
                    background: "var(--le-bg-elev)",
                  }}
                >
                  <option value="">— None —</option>
                  {taxonomy.categories.filter(c => c.label && !c.label.toLowerCase().startsWith("choose") && !c.label.startsWith("---")).map(c => (
                    <option key={c.id} value={c.label}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label>Default meta title</Label>
              <Input value={defaultMetaTitle} onChange={e => setDefaultMetaTitle(e.target.value)} />
            </div>
            <div>
              <Label>Default meta description</Label>
              <Textarea value={defaultMetaDescription} onChange={e => setDefaultMetaDescription(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Default meta tags (comma-separated)</Label>
              <Input value={defaultMetaTags} onChange={e => setDefaultMetaTags(e.target.value)} />
            </div>
          </div>
        </DashboardCard>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Body HTML</Label>
            <div className="flex gap-2">
              <DashboardButton size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload .html
              </DashboardButton>
              <DashboardButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!body_html || body_html.trim().length < 20) {
                    toast.error("Paste or upload HTML first (min 20 chars).");
                    return;
                  }
                  analyze.mutate();
                }}
                disabled={analyze.isPending}
              >
                {analyze.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Sparkles className="h-3.5 w-3.5" />}
                Analyze with AI
              </DashboardButton>
            </div>
            <input ref={fileRef} type="file" accept=".html,text/html" className="hidden" onChange={onUpload} />
          </div>
          <PostEditor
            value={body_html}
            onChange={setBodyHtml}
            onInsertImageClick={() => toast.info("Image insert: use Post editor; templates should stay text-only for now")}
            mode={mode}
            onModeChange={setMode}
            minHeight={400}
          />
        </div>
        <div className="flex gap-2">
          <DashboardButton variant="primary" onClick={() => save.mutate()} disabled={!name || !body_html || save.isPending}>Save</DashboardButton>
          <DashboardButton variant="ghost" onClick={() => navigate("/dashboard/blog/templates")}>Cancel</DashboardButton>
        </div>
      </div>

      <Dialog open={!!analyzeResult} onOpenChange={(v) => !v && setAnalyzeResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Template analysis
            </DialogTitle>
          </DialogHeader>
          {analyzeResult && (
            <div className="space-y-4">
              <div>
                <Label>Suggested name</Label>
                <div className="flex gap-2">
                  <Input value={analyzeResult.suggested_name} readOnly className="flex-1" />
                  <DashboardButton size="sm" variant="ghost" onClick={() => setName(analyzeResult.suggested_name)}>Apply</DashboardButton>
                </div>
              </div>
              <div>
                <Label>Suggested description</Label>
                <div className="flex gap-2">
                  <Textarea value={analyzeResult.suggested_description} readOnly className="flex-1" rows={2} />
                  <DashboardButton size="sm" variant="ghost" onClick={() => setDescription(analyzeResult.suggested_description)}>Apply</DashboardButton>
                </div>
              </div>
              {analyzeResult.detected_sections.length > 0 && (
                <div>
                  <Label>Detected sections</Label>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {analyzeResult.detected_sections.map((s, i) => (
                      <StatusPill key={i} tone="muted">{s}</StatusPill>
                    ))}
                  </div>
                </div>
              )}
              {analyzeResult.notes && (
                <div>
                  <Label>Notes</Label>
                  <DashboardCard padding="sm">
                    <pre className="whitespace-pre-wrap text-xs" style={{ color: "var(--le-text-muted)" }}>{analyzeResult.notes}</pre>
                  </DashboardCard>
                </div>
              )}
              <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                Cost: ${(analyzeResult.cost_cents / 100).toFixed(2)} · Model: {analyzeResult.model}
              </div>
              <div className="flex justify-end gap-2">
                <DashboardButton variant="ghost" onClick={() => setAnalyzeResult(null)}>Close</DashboardButton>
                <DashboardButton variant="primary" onClick={() => {
                  setName(analyzeResult.suggested_name);
                  setDescription(analyzeResult.suggested_description);
                  setAnalyzeResult(null);
                  toast.success("Applied suggestions");
                }}>
                  Apply all
                </DashboardButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
