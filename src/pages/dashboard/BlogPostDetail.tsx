import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PostEditor } from "@/components/blog/PostEditor";
import { AIDraftModal } from "@/components/blog/AIDraftModal";
import { ImagePickerModal } from "@/components/blog/ImagePickerModal";
import { PublishHistoryPanel } from "@/components/blog/PublishHistoryPanel";
import {
  createPost, getPost, updatePost, publishPost, rejectPost, editOnSierra,
  listTemplates, getTemplate, getTaxonomy, generateAIDraft,
} from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage, CreatePostInput, UpdatePostInput } from "@/lib/blog/types";
import type { AIDraftInput, AIDraftResult } from "@/lib/blog/types";
import type { EditorMode } from "@/components/blog/PostEditor";
import { Eye, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Mode = "compose" | "edit-manual" | "review-auto" | "edit-live" | "readonly";

interface FormState {
  title: string;
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string;          // comma-separated for the input
  author_label: string;
  category_label: string;
  image: BlogImage | null;
  publish_at: string;         // ISO datetime or empty
}

const empty: FormState = {
  title: "", body_html: "", meta_title: "", meta_description: "", meta_tags: "",
  author_label: "", category_label: "", image: null, publish_at: "",
};

export default function BlogPostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCompose = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [aiOpen, setAIOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // AI generation state — lifted out of modal
  const [aiInput, setAIInput] = useState<AIDraftInput | null>(null);
  const [aiResult, setAIResult] = useState<AIDraftResult | null>(null);
  const [aiElapsedSec, setAIElapsedSec] = useState(0);
  const [aiPreviewOpen, setAIPreviewOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-post", id],
    queryFn: () => getPost(id!),
    enabled: !isCompose,
    refetchInterval: (query) => {
      const state = (query.state.data as any)?.post?.state;
      return state && ["publish_due","publishing","editing"].includes(state) ? 5000 : false;
    },
  });

  const post = data?.post;
  const mode: Mode = useMemo(() => {
    if (isCompose) return "compose";
    if (!post) return "readonly";
    if (post.state === "live") return "edit-live";
    if (post.state === "awaiting_approval") {
      return post.authored === "auto" ? "review-auto" : "edit-manual";
    }
    return "readonly";
  }, [isCompose, post]);

  const [form, setForm] = useState<FormState>(empty);
  useEffect(() => {
    if (post) {
      setForm({
        title: post.title,
        body_html: post.body_html,
        meta_title: post.meta_title ?? "",
        meta_description: post.meta_description ?? "",
        meta_tags: (post.meta_tags ?? []).join(", "),
        author_label: post.author_label ?? "",
        category_label: post.category_label ?? "",
        image: (post as any).image ?? null,
        publish_at: post.publish_at ?? "",
      });
    }
  }, [post]);

  const [pickerOpen, setPickerOpen] = useState(false);

  // Load templates for compose dropdown
  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"],
    queryFn: () => listTemplates(),
    enabled: isCompose,
  });
  const templates = tplData?.templates ?? [];

  const { data: taxonomyData } = useQuery({
    queryKey: ["blog-taxonomy"],
    queryFn: () => getTaxonomy(),
  });
  const taxonomy = taxonomyData ?? { authors: [], categories: [] };

  // Prefill from ?template=ID
  useEffect(() => {
    const tplId = searchParams.get("template");
    if (!tplId || !isCompose) return;
    getTemplate(tplId).then(({ template }) => {
      setForm(f => ({ ...f, body_html: template.body_html, title: f.title || template.name }));
      setEditorMode("source");
    });
  }, [searchParams, isCompose]);

  // AI generation mutation
  const aiGen = useMutation({
    mutationFn: (input: AIDraftInput) => generateAIDraft(input),
    onSuccess: (r) => {
      setAIResult(r);
      setAIInput(null);
      toast.success("✨ AI draft ready");
    },
    onError: (e: any) => {
      setAIInput(null);
      toast.error(`Generation failed: ${e?.message ?? e}`);
    },
  });

  // Elapsed-seconds ticker while a job is active
  useEffect(() => {
    if (!aiInput) { setAIElapsedSec(0); return; }
    const start = Date.now();
    const id = setInterval(() => setAIElapsedSec(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [aiInput]);

  function startAIGen(input: AIDraftInput) {
    setAIInput(input);
    setAIResult(null);
    setAIElapsedSec(0);
    aiGen.mutate(input);
  }

  function cancelAIGen() {
    aiGen.reset();
    setAIInput(null);
    setAIElapsedSec(0);
    toast.info("Cancelled");
    // Note: doesn't abort the network request server-side; we just stop surfacing the result.
  }

  function applyAIResult() {
    if (!aiResult) return;
    setForm(f => ({
      ...f,
      body_html: aiResult.body_html,
      meta_title: aiResult.meta_title || f.meta_title,
      meta_description: aiResult.meta_description || f.meta_description,
      meta_tags: aiResult.meta_tags.length ? aiResult.meta_tags.join(", ") : f.meta_tags,
    }));
    setEditorMode("source");
    setAIResult(null);
    setAIPreviewOpen(false);
    toast.success("Applied AI draft");
  }

  function discardAIResult() {
    setAIResult(null);
    setAIPreviewOpen(false);
  }

  function patchFromForm(): UpdatePostInput {
    return {
      title: form.title,
      body_html: form.body_html,
      meta_title: form.meta_title || null,
      meta_description: form.meta_description || null,
      meta_tags: form.meta_tags ? form.meta_tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      author_label: form.author_label || null,
      category_label: form.category_label || null,
      image_id: form.image?.id ?? null,
      publish_at: form.publish_at || null,
    };
  }

  const createDraft = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "awaiting_approval",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Saved as draft"); navigate(`/dashboard/blog/posts/${r.id}`); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createPublish = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "publish_due",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Publishing — should be live within 60s"); navigate(`/dashboard/blog/posts/${r.id}`); },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  const saveEdit = useMutation({
    mutationFn: () => updatePost(id!, patchFromForm()),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const publishIt = useMutation({
    mutationFn: async () => { await updatePost(id!, patchFromForm()); return publishPost(id!); },
    onSuccess: () => { toast.success("Publishing — should be live within 60s"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  const updateSierra = useMutation({
    mutationFn: async () => {
      if (!post) return null;
      const diffs: string[] = [];
      if (form.title !== post.title) diffs.push("title");
      if (form.body_html !== post.body_html) diffs.push("body_html");
      if (form.meta_title !== (post.meta_title ?? "")) diffs.push("meta_title");
      if (form.meta_description !== (post.meta_description ?? "")) diffs.push("meta_description");
      if (form.meta_tags !== (post.meta_tags ?? []).join(", ")) diffs.push("meta_tags");
      if (form.author_label !== (post.author_label ?? "")) diffs.push("author");
      if (form.category_label !== (post.category_label ?? "")) diffs.push("category");
      if (diffs.length === 0) return null;
      await updatePost(id!, patchFromForm());
      return editOnSierra(id!, diffs);
    },
    onSuccess: (r) => {
      if (!r) { toast.info("No changes to push"); return; }
      toast.success("Update queued — Sierra in ~60s");
      qc.invalidateQueries({ queryKey: ["blog-post", id] });
    },
    onError: (e: any) => toast.error(`Sierra update failed: ${e.message}`),
  });

  const reject = useMutation({
    mutationFn: () => rejectPost(id!),
    onSuccess: () => { toast.success("Rejected"); navigate("/dashboard/blog/posts"); },
    onError: (e: any) => toast.error(`Reject failed: ${e.message}`),
  });

  if (!isCompose && isLoading) return <div>Loading…</div>;

  const readOnly = mode === "readonly";

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">{isCompose ? "New post" : form.title || "Post"}</h1>

      {/* AI generation status banner */}
      {(aiInput || aiResult) && (
        <div className="mb-4 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
          {aiInput ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="flex-1">
                <span className="font-medium">AI draft in queue</span>
                <span className="ml-2 text-muted-foreground">— Claude is generating · {aiElapsedSec}s elapsed · usually 5–15s</span>
              </span>
              <Button size="sm" variant="ghost" onClick={cancelAIGen}>Cancel</Button>
            </>
          ) : aiResult ? (
            <>
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="flex-1"><span className="font-medium">✨ AI draft ready</span></span>
              <Button size="sm" variant="default" onClick={() => setAIPreviewOpen(true)}>Preview &amp; Apply</Button>
              <Button size="sm" variant="ghost" onClick={discardAIResult}>Discard</Button>
            </>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          {isCompose && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const tpl = templates.find(t => t.id === e.target.value);
                  if (tpl) {
                    setForm(f => ({
                      ...f,
                      body_html: tpl.body_html,
                      title: f.title || tpl.name,
                      author_label: tpl.default_author_label ?? f.author_label,
                      category_label: tpl.default_category_label ?? f.category_label,
                      meta_title: tpl.default_meta_title ?? f.meta_title,
                      meta_description: tpl.default_meta_description ?? f.meta_description,
                      meta_tags: tpl.default_meta_tags && tpl.default_meta_tags.length ? tpl.default_meta_tags.join(", ") : f.meta_tags,
                    }));
                    setEditorMode("source");
                  }
                  e.target.value = "";
                }}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Start from template…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={() => setAIOpen(true)}>
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Generate with AI
              </Button>
            </div>
          )}
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} disabled={readOnly} />
          </div>
          <div>
            <Label>Body</Label>
            <PostEditor
              value={form.body_html}
              onChange={(html) => setForm({ ...form, body_html: html })}
              onInsertImageClick={() => setPickerOpen(true)}
              mode={editorMode}
              onModeChange={setEditorMode}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Featured image</Label>
            {form.image ? (
              <div className="space-y-2">
                <img src={thumbUrl(form.image.blob_url, { width: 600, quality: 75 })} loading="lazy" decoding="async" className="w-full rounded-md" alt={form.image.vision_caption ?? ""} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Change</Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, image: null })}>Remove</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setPickerOpen(true)}>Pick image</Button>
            )}
          </div>
          <div>
            <Label>Author</Label>
            <select
              value={form.author_label ?? ""}
              onChange={e => setForm({ ...form, author_label: e.target.value })}
              disabled={readOnly}
              className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Select author —</option>
              {taxonomy.authors.filter(a => a.label && !a.label.toLowerCase().startsWith("select")).map(a => (
                <option key={a.id} value={a.label}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Category</Label>
            <select
              value={form.category_label ?? ""}
              onChange={e => setForm({ ...form, category_label: e.target.value })}
              disabled={readOnly}
              className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">— Select category —</option>
              {taxonomy.categories.filter(c => c.label && !c.label.toLowerCase().startsWith("choose") && !c.label.startsWith("---")).map(c => (
                <option key={c.id} value={c.label}>{c.label}</option>
              ))}
            </select>
          </div>
          <div><Label>Meta title</Label><Input value={form.meta_title} onChange={e => setForm({ ...form, meta_title: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Meta description</Label><Textarea value={form.meta_description} onChange={e => setForm({ ...form, meta_description: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Meta keywords (comma sep)</Label><Input value={form.meta_tags} onChange={e => setForm({ ...form, meta_tags: e.target.value })} disabled={readOnly} /></div>
          <div><Label>Schedule for (optional)</Label><Input type="datetime-local" value={form.publish_at?.slice(0, 16) ?? ""} onChange={e => setForm({ ...form, publish_at: e.target.value ? new Date(e.target.value).toISOString() : "" })} disabled={readOnly} /></div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {mode === "compose" && (
          <>
            <Button onClick={() => createDraft.mutate()} disabled={createDraft.isPending}>Save as draft</Button>
            <Button onClick={() => createPublish.mutate()} disabled={createPublish.isPending}>Publish now</Button>
          </>
        )}
        {mode === "edit-manual" && (
          <>
            <Button variant="outline" onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>Save</Button>
            <Button onClick={() => publishIt.mutate()} disabled={publishIt.isPending}>Publish now</Button>
          </>
        )}
        {mode === "review-auto" && (
          <>
            <Button variant="outline" onClick={() => saveEdit.mutate()}>Save changes</Button>
            <Button onClick={() => publishIt.mutate()}>Approve &amp; publish</Button>
            <Button variant="destructive" onClick={() => reject.mutate()}>Reject</Button>
          </>
        )}
        {mode === "edit-live" && (
          <>
            <Button onClick={() => updateSierra.mutate()} disabled={updateSierra.isPending}>Save &amp; update Sierra</Button>
            {post?.external_post_url && <a href={post.external_post_url} target="_blank" rel="noreferrer"><Button variant="outline">View on Sierra</Button></a>}
          </>
        )}
        <Button variant="outline" onClick={() => setPreviewOpen(true)} disabled={!form.body_html.trim()}>
          <Eye className="mr-1 h-4 w-4" /> Preview
        </Button>
      </div>

      {!isCompose && id && <PublishHistoryPanel postId={id} />}

      <ImagePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(img) => setForm({ ...form, image: img })} />

      <AIDraftModal
        open={aiOpen}
        onClose={() => setAIOpen(false)}
        onSubmit={(input) => { startAIGen(input); setAIOpen(false); }}
        currentHtml={form.body_html}
      />

      {/* Post body preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Preview · {form.title || "Untitled"}</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-md border">
            <HtmlPreview html={form.body_html || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: "70vh", border: "none", display: "block" }} />
          </div>
        </DialogContent>
      </Dialog>

      {/* AI draft preview & apply dialog */}
      <Dialog open={aiPreviewOpen} onOpenChange={(v) => !v && setAIPreviewOpen(false)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> AI draft preview
            </DialogTitle>
          </DialogHeader>
          {aiResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Current</div>
                  <HtmlPreview html={form.body_html || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: 360, border: "1px solid #e5e7eb", borderRadius: 4 }} />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">AI-generated</div>
                  <HtmlPreview html={aiResult.body_html} style={{ width: "100%", height: 360, border: "1px solid #e5e7eb", borderRadius: 4 }} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={discardAIResult}>Discard</Button>
                <Button onClick={applyAIResult}>Use this</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
