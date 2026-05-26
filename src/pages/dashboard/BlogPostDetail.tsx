import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeading } from "@/components/dashboard/primitives";
import { PostEditor } from "@/components/blog/PostEditor";
import { AIDraftModal } from "@/components/blog/AIDraftModal";
import { AIChatModal } from "@/components/blog/AIChatModal";
import { AllyFloatingChat } from "@/components/blog/AllyFloatingChat";
import BlogPostChatCompose from "./BlogPostChatCompose";
import { ImagePickerModal } from "@/components/blog/ImagePickerModal";
import { PublishHistoryPanel } from "@/components/blog/PublishHistoryPanel";
import {
  createPost, getPost, updatePost, publishPost, rejectPost, editOnSierra,
  listTemplates, getTemplate, getTaxonomy, generateAIDraft, setHold,
  aiEmailFromPost, createEmail,
} from "@/lib/blog/api-client";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeletePostDialog } from "@/components/blog/DeletePostDialog";
import { thumbUrl } from "@/lib/blog/image-url";
import type { BlogImage, CreatePostInput, UpdatePostInput } from "@/lib/blog/types";
import type { AIDraftInput, AIDraftResult } from "@/lib/blog/types";
import type { EditorMode } from "@/components/blog/PostEditor";
import { Eye, Loader2, Mail, MessageSquare, Pause, Play, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Mode = "compose" | "edit-manual" | "review-auto" | "edit-live" | "on-hold" | "readonly";

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
  const [searchParams] = useSearchParams();

  // /posts/new?chat=1 now renders a dedicated AI-first compose page that
  // takes over the whole route — chat on the left, form sidebar on the right,
  // Save draft / Publish now pinned in the header. The old "Chat with AI"
  // modal (AIChatModal) is still wired below for the edit flow.
  if (isCompose && searchParams.get("chat") === "1") {
    return <BlogPostChatCompose />;
  }

  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [aiOpen, setAIOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
    if (post.state === "on_hold") return "on-hold";
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

  // Prefill from ?template=ID; full sidebar fill including defaults.
  useEffect(() => {
    const tplId = searchParams.get("template");
    if (!tplId || !isCompose) return;
    getTemplate(tplId).then(({ template }) => {
      setForm(f => ({
        ...f,
        body_html: template.body_html,
        title: f.title || template.name,
        author_label: template.default_author_label ?? f.author_label,
        category_label: template.default_category_label ?? f.category_label,
        meta_title: template.default_meta_title ?? f.meta_title,
        meta_description: template.default_meta_description ?? f.meta_description,
        meta_tags: template.default_meta_tags && template.default_meta_tags.length
          ? template.default_meta_tags.join(", ")
          : f.meta_tags,
      }));
      setEditorMode("source");
    });
  }, [searchParams, isCompose]);

  // Auto-open the quick-AI-draft modal when /posts/new?ai=1.
  // (?chat=1 routes to BlogPostChatCompose above, not the modal.)
  useEffect(() => {
    if (!isCompose) return;
    if (searchParams.get("ai") === "1") setAIOpen(true);
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
    onSuccess: (r) => { toast.success("Saved as draft"); navigate(`/dashboard/studio/blog/posts/${r.id}`); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createPublish = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "publish_due",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Publishing — should be live within 60s"); navigate(`/dashboard/studio/blog/posts/${r.id}`); },
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
    onSuccess: () => { toast.success("Rejected"); navigate("/dashboard/studio/blog/posts"); },
    onError: (e: any) => toast.error(`Reject failed: ${e.message}`),
  });

  const hold = useMutation({
    mutationFn: (next: boolean) => setHold(id!, next),
    onSuccess: (r) => {
      toast.success(r.state === "on_hold" ? "Put on hold" : "Resumed");
      qc.invalidateQueries({ queryKey: ["blog-post", id] });
    },
    onError: (e: any) => toast.error(`Status change failed: ${e.message}`),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  // "Send as email" — converts the post body to an email draft via Ally then
  // navigates to the new email detail page.
  const sendAsEmail = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Post not yet saved");
      const result = await aiEmailFromPost(id);
      const { id: emailId } = await createEmail({
        subject: result.subject,
        preheader: result.preheader,
        body_html: result.body_html,
        from_name: result.from_name,
        from_email: result.from_email,
        audience: result.audience,
        source_post_id: id,
        authored: "auto",
        initial_state: "draft",
      });
      return emailId;
    },
    onSuccess: (emailId) => {
      toast.success("Email draft created");
      navigate(`/dashboard/studio/email/messages/${emailId}`);
    },
    onError: (e: any) => toast.error(`Email conversion failed: ${e?.message ?? e}`),
  });

  if (!isCompose && isLoading) return (
    <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
      <div style={{ width: 24, height: 24, borderRadius: 99, border: "2px solid var(--line)", borderTopColor: "var(--ink)", animation: "spin 0.8s linear infinite" }} />
    </div>
  );

  const readOnly = mode === "readonly";

  return (
    <div className="le-fade-up">
      <PageHeading
        title={isCompose ? "New post" : form.title || "Post"}
        eyebrow={isCompose ? "Blog" : "Blog · post"}
      />

      {/* AI generation status banner */}
      {(aiInput || aiResult) && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: "1px solid rgba(42,111,219,0.25)", background: "rgba(42,111,219,0.05)", padding: "12px 16px", fontSize: 13.5 }}>
          {aiInput ? (
            <>
              <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite", color: "var(--accent)", flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, color: "var(--ink)" }}>AI draft in queue</span>
                <span style={{ marginLeft: 8, color: "var(--muted)" }}>— Claude is generating · {aiElapsedSec}s elapsed · usually 5–15s</span>
              </span>
              <button type="button" className="le-btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={cancelAIGen}>Cancel</button>
            </>
          ) : aiResult ? (
            <>
              <Sparkles style={{ width: 16, height: 16, color: "var(--accent)", flexShrink: 0 }} />
              <span style={{ flex: 1 }}><span style={{ fontWeight: 600, color: "var(--ink)" }}>✨ AI draft ready</span></span>
              <button type="button" className="le-btn-dark" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => setAIPreviewOpen(true)}>Preview &amp; Apply</button>
              <button type="button" className="le-btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={discardAIResult}>Discard</button>
            </>
          ) : null}
        </div>
      )}

      {/* Publish progress banner */}
      {post && ["publish_due", "publishing", "editing"].includes(post.state as string) && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: "1px solid rgba(42,111,219,0.25)", background: "rgba(42,111,219,0.05)", padding: "12px 16px", fontSize: 13.5 }}>
          <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite", color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>
              {post.state === "editing" ? "Updating Sierra" : "Publishing to Sierra"}
            </span>
            <span style={{ marginLeft: 8, color: "var(--muted)" }}>— usually live within 60s · this page refreshes automatically</span>
          </span>
        </div>
      )}
      {post && post.state === "live" && post.external_post_url && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: "1px solid rgba(47,138,85,0.3)", background: "rgba(47,138,85,0.06)", padding: "12px 16px", fontSize: 13.5 }}>
          <span style={{ fontWeight: 600, color: "var(--good)" }}>✓ Live on Sierra</span>
          <a href={post.external_post_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>
            View on Sierra ↗
          </a>
        </div>
      )}
      {post && post.state === "on_hold" && (
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12, borderRadius: 14, border: "1px solid var(--line)", background: "rgba(11,11,16,0.035)", padding: "12px 16px", fontSize: 13.5 }}>
          <Pause style={{ width: 16, height: 16, color: "var(--muted)", flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, color: "var(--ink-2)" }}>On hold</span>
            <span style={{ marginLeft: 8, color: "var(--muted)" }}>— hidden from the "Live" filter. Sierra-side copy is untouched.</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          {isCompose && (
            <div style={{ marginBottom: 16, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
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
                style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", padding: "7px 12px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
              >
                <option value="">Start from template…</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="le-btn-dark" style={{ fontSize: 12.5, padding: "7px 14px" }} onClick={() => setChatOpen(true)}>
                <MessageSquare style={{ width: 13, height: 13, marginRight: 6 }} /> Chat with AI
              </button>
              <button type="button" className="le-btn-ghost" style={{ fontSize: 12.5, padding: "7px 14px" }} onClick={() => setAIOpen(true)}>
                <Sparkles style={{ width: 13, height: 13, marginRight: 6 }} /> Quick draft
              </button>
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
            <Label style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>Author</Label>
            <select
              value={form.author_label ?? ""}
              onChange={e => setForm({ ...form, author_label: e.target.value })}
              disabled={readOnly}
              style={{ display: "block", width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", padding: "7px 10px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
            >
              <option value="">— Select author —</option>
              {taxonomy.authors.filter(a => a.label && !a.label.toLowerCase().startsWith("select")).map(a => (
                <option key={a.id} value={a.label}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>Category</Label>
            <select
              value={form.category_label ?? ""}
              onChange={e => setForm({ ...form, category_label: e.target.value })}
              disabled={readOnly}
              style={{ display: "block", width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", padding: "7px 10px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
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

      <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {mode === "compose" && (
          <>
            <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => createDraft.mutate()} disabled={createDraft.isPending}>
              {createDraft.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} />}
              {createDraft.isPending ? "Saving…" : "Save as draft"}
            </button>
            <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => createPublish.mutate()} disabled={createPublish.isPending}>
              {createPublish.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} />}
              {createPublish.isPending ? "Publishing…" : "Publish now"}
            </button>
          </>
        )}
        {mode === "edit-manual" && (
          <>
            <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>
              {saveEdit.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} />}
              {saveEdit.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => publishIt.mutate()} disabled={publishIt.isPending}>
              {publishIt.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} />}
              {publishIt.isPending ? "Publishing…" : "Publish now"}
            </button>
          </>
        )}
        {mode === "review-auto" && (
          <>
            <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => saveEdit.mutate()}>Save changes</button>
            <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => publishIt.mutate()}>Approve &amp; publish</button>
            <button type="button" style={{ fontSize: 13, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(196,74,74,0.3)", background: "rgba(196,74,74,0.07)", color: "var(--bad)", cursor: "pointer", fontFamily: "var(--le-font-sans)", fontWeight: 500 }} onClick={() => reject.mutate()}>Reject</button>
          </>
        )}
        {mode === "edit-live" && (
          <>
            <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => updateSierra.mutate()} disabled={updateSierra.isPending}>Save &amp; update Sierra</button>
            {post?.external_post_url && <a href={post.external_post_url} target="_blank" rel="noreferrer" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }}>View on Sierra</a>}
            <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => hold.mutate(true)} disabled={hold.isPending}>
              {hold.isPending ? <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} /> : <Pause style={{ width: 14, height: 14, marginRight: 6 }} />}
              Put on hold
            </button>
          </>
        )}
        {mode === "on-hold" && (
          <>
            <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "8px 16px" }} onClick={() => hold.mutate(false)} disabled={hold.isPending}>
              {hold.isPending ? <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 14, height: 14, marginRight: 6 }} />}
              Resume (back to Live)
            </button>
            {post?.external_post_url && <a href={post.external_post_url} target="_blank" rel="noreferrer" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px" }}>View on Sierra</a>}
          </>
        )}
        <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "8px 16px", opacity: !form.body_html.trim() ? 0.4 : 1 }} onClick={() => setPreviewOpen(true)} disabled={!form.body_html.trim()}>
          <Eye style={{ width: 14, height: 14, marginRight: 6 }} /> Preview
        </button>
        {!isCompose && (
          <button
            type="button"
            onClick={() => sendAsEmail.mutate()}
            disabled={sendAsEmail.isPending || !form.body_html.trim()}
            title="Convert this post to an email draft using Ally"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 999, border: "1px solid var(--line)", background: "transparent", color: "var(--ink)", fontSize: 13, fontWeight: 500, cursor: sendAsEmail.isPending ? "wait" : "pointer", fontFamily: "var(--le-font-sans)", opacity: sendAsEmail.isPending || !form.body_html.trim() ? 0.5 : 1 }}
          >
            {sendAsEmail.isPending
              ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
              : <Mail style={{ width: 14, height: 14 }} />}
            Send as email
          </button>
        )}
        {!isCompose && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(196,74,74,0.25)", background: "transparent", color: "var(--bad)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "var(--le-font-sans)" }}
          >
            <Trash2 style={{ width: 14, height: 14 }} /> Delete
          </button>
        )}
      </div>

      <DeletePostDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        postId={id ?? null}
        postTitle={form.title || post?.title || ""}
        hasSierraCopy={!!post?.external_post_id}
        onSuccess={() => navigate("/dashboard/studio/blog/posts")}
      />

      {!isCompose && id && <PublishHistoryPanel postId={id} />}

      <ImagePickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(img) => setForm({ ...form, image: img })} selectedId={form.image?.id ?? null} />

      <AIDraftModal
        open={aiOpen}
        onClose={() => setAIOpen(false)}
        onSubmit={(input) => { startAIGen(input); setAIOpen(false); }}
        currentHtml={form.body_html}
      />

      <AIChatModal
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        initialHtml={form.body_html}
        onApply={(html) => {
          setForm((f) => ({ ...f, body_html: html }));
          setEditorMode("rich");
        }}
      />

      {/* Improve-with-Ally floating chat — only mount on existing posts; the
          dedicated chat-compose page handles new-post flow. */}
      {!isCompose && id && (
        <AllyFloatingChat
          postId={id}
          contextLabel={
            mode === "edit-live" ? "Editing the live post"
              : mode === "on-hold" ? "Editing a held post"
              : mode === "review-auto" ? "Reviewing AI draft"
              : "Editing this post"
          }
          currentBodyHtml={form.body_html}
          current={{
            title: form.title,
            meta_title: form.meta_title,
            meta_description: form.meta_description,
            meta_tags: form.meta_tags
              ? form.meta_tags.split(",").map((t) => t.trim()).filter(Boolean)
              : [],
            author_label: form.author_label,
            category_label: form.category_label,
          }}
          onApply={(patch) => {
            setForm((f) => ({
              ...f,
              ...(patch.title !== undefined ? { title: patch.title } : {}),
              ...(patch.body_html !== undefined ? { body_html: patch.body_html } : {}),
              ...(patch.meta_title !== undefined ? { meta_title: patch.meta_title } : {}),
              ...(patch.meta_description !== undefined ? { meta_description: patch.meta_description } : {}),
              ...(patch.meta_tags !== undefined ? { meta_tags: patch.meta_tags.join(", ") } : {}),
              ...(patch.author_label !== undefined ? { author_label: patch.author_label } : {}),
              ...(patch.category_label !== undefined ? { category_label: patch.category_label } : {}),
            }));
            if (patch.body_html !== undefined) setEditorMode("rich");
          }}
        />
      )}

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
