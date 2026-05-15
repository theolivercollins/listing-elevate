import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { PageHeading, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";

type Mode = "compose" | "edit-manual" | "review-auto" | "edit-live" | "readonly";

interface FormState {
  title: string;
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string;
  author_label: string;
  category_label: string;
  image: BlogImage | null;
  publish_at: string;
}

const empty: FormState = {
  title: "", body_html: "", meta_title: "", meta_description: "", meta_tags: "",
  author_label: "", category_label: "", image: null, publish_at: "",
};

// ─── blog status pill ─────────────────────────────────────────────
function BlogStatusPill({ state }: { state: string }) {
  const MAP: Record<string, { label: string; color: string; bg: string }> = {
    live:             { label: "Live",        color: "var(--good)",   bg: "rgba(47,138,85,0.10)" },
    awaiting_approval:{ label: "Draft",       color: "var(--muted)",  bg: "rgba(11,11,16,0.05)" },
    publish_due:      { label: "Publish due", color: "var(--accent)", bg: "rgba(42,111,219,0.10)" },
    publishing:       { label: "Publishing",  color: "var(--accent)", bg: "rgba(42,111,219,0.10)" },
    failed:           { label: "Failed",      color: "var(--bad)",    bg: "rgba(196,74,74,0.10)" },
    quarantined:      { label: "Quarantined", color: "var(--bad)",    bg: "rgba(196,74,74,0.10)" },
    paused:           { label: "Paused",      color: "var(--warn)",   bg: "rgba(182,128,44,0.10)" },
  };
  const s = MAP[state] ?? { label: state, color: "var(--muted)", bg: "rgba(11,11,16,0.05)" };
  return (
    <span className="le-status-pill" style={{ background: s.bg, color: s.color }}>
      <span className="le-status-dot" />
      {s.label}
    </span>
  );
}

// ─── input / label styles ─────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "9px 14px",
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  outline: "none",
  boxSizing: "border-box",
};

const TEXTAREA_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  resize: "vertical",
  minHeight: 80,
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  appearance: "none",
  WebkitAppearance: "none",
  cursor: "pointer",
};

const FIELD_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 500,
  color: "var(--muted)",
  marginBottom: 6,
};

// ─── field wrapper ────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <label style={FIELD_LABEL}>{label}</label>
      {children}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────
export default function BlogPostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isCompose = !id || id === "new";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [aiOpen, setAIOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [aiInput, setAIInput] = useState<AIDraftInput | null>(null);
  const [aiResult, setAIResult] = useState<AIDraftResult | null>(null);
  const [aiElapsedSec, setAIElapsedSec] = useState(0);
  const [aiPreviewOpen, setAIPreviewOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["blog-post", id],
    queryFn: () => getPost(id!),
    enabled: !isCompose,
    refetchInterval: (query) => {
      const state = (query.state.data as { post?: { state?: string } } | undefined)?.post?.state;
      return state && ["publish_due", "publishing", "editing"].includes(state) ? 5000 : false;
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
        image: (post as { image?: BlogImage | null }).image ?? null,
        publish_at: post.publish_at ?? "",
      });
    }
  }, [post]);

  const [pickerOpen, setPickerOpen] = useState(false);

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

  useEffect(() => {
    if (!isCompose) return;
    if (searchParams.get("ai") === "1") setAIOpen(true);
  }, [searchParams, isCompose]);

  const aiGen = useMutation({
    mutationFn: (input: AIDraftInput) => generateAIDraft(input),
    onSuccess: (r) => {
      setAIResult(r);
      setAIInput(null);
      toast.success("AI draft ready");
    },
    onError: (e: unknown) => {
      setAIInput(null);
      toast.error(`Generation failed: ${e instanceof Error ? e.message : String(e)}`);
    },
  });

  useEffect(() => {
    if (!aiInput) { setAIElapsedSec(0); return; }
    const start = Date.now();
    const tid = setInterval(() => setAIElapsedSec(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(tid);
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
    onError: (e: unknown) => toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const createPublish = useMutation({
    mutationFn: () => createPost({
      ...(patchFromForm() as Omit<CreatePostInput, "initial_state">),
      initial_state: "publish_due",
      authored: "manual",
    } as CreatePostInput),
    onSuccess: (r) => { toast.success("Publishing — should be live within 60s"); navigate(`/dashboard/blog/posts/${r.id}`); },
    onError: (e: unknown) => toast.error(`Publish failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const saveEdit = useMutation({
    mutationFn: () => updatePost(id!, patchFromForm()),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: unknown) => toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const publishIt = useMutation({
    mutationFn: async () => { await updatePost(id!, patchFromForm()); return publishPost(id!); },
    onSuccess: () => { toast.success("Publishing — should be live within 60s"); qc.invalidateQueries({ queryKey: ["blog-post", id] }); },
    onError: (e: unknown) => toast.error(`Publish failed: ${e instanceof Error ? e.message : String(e)}`),
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
    onError: (e: unknown) => toast.error(`Sierra update failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const reject = useMutation({
    mutationFn: () => rejectPost(id!),
    onSuccess: () => { toast.success("Rejected"); navigate("/dashboard/blog/posts"); },
    onError: (e: unknown) => toast.error(`Reject failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  if (!isCompose && isLoading) {
    return (
      <div style={{ padding: "64px 0", display: "flex", justifyContent: "center" }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const readOnly = mode === "readonly";
  const pageTitle = isCompose ? "New post" : (form.title || "Post");

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <PageHeading
        eyebrow="Content · Blog · Posts"
        title={pageTitle}
        sub={post ? undefined : "Compose and schedule a new blog post."}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {post && <BlogStatusPill state={post.state} />}
            <button
              className="le-btn-ghost"
              onClick={() => setPreviewOpen(true)}
              disabled={!form.body_html.trim()}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <Icon name="image" size={13} />
              Preview
            </button>
          </div>
        }
      />

      {/* AI generation status banner */}
      {(aiInput || aiResult) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgba(42,111,219,0.2)",
            background: "rgba(42,111,219,0.04)",
            fontSize: 13,
          }}
        >
          {aiInput ? (
            <>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, color: "var(--ink)" }}>AI draft in queue</span>
                <span style={{ marginLeft: 8, color: "var(--muted)" }}>Claude is generating · {aiElapsedSec}s elapsed · usually 5–15s</span>
              </span>
              <button className="le-btn-ghost" onClick={cancelAIGen} style={{ fontSize: 12 }}>Cancel</button>
            </>
          ) : aiResult ? (
            <>
              <Icon name="sparkles" size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <span style={{ flex: 1, fontWeight: 500, color: "var(--ink)" }}>AI draft ready</span>
              <button className="le-btn-dark" onClick={() => setAIPreviewOpen(true)} style={{ fontSize: 12 }}>Preview &amp; Apply</button>
              <button className="le-btn-ghost" onClick={discardAIResult} style={{ fontSize: 12 }}>Discard</button>
            </>
          ) : null}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 20, alignItems: "start" }}>

        {/* Left: editor */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {isCompose && (
            <Card padding={16}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
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
                  style={{ ...SELECT_STYLE, width: "auto", minWidth: 180 }}
                >
                  <option value="">Start from template…</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <button
                  className="le-btn-ghost"
                  onClick={() => setAIOpen(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                >
                  <Icon name="sparkles" size={13} />
                  Generate with AI
                </button>
              </div>
            </Card>
          )}

          <Card padding={20}>
            <Field label="Title">
              <input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                disabled={readOnly}
                style={INPUT_STYLE}
              />
            </Field>
          </Card>

          <Card padding={0} style={{ overflow: "hidden" }}>
            <PostEditor
              value={form.body_html}
              onChange={(html) => setForm({ ...form, body_html: html })}
              onInsertImageClick={() => setPickerOpen(true)}
              mode={editorMode}
              onModeChange={setEditorMode}
            />
          </Card>
        </div>

        {/* Right: sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Action buttons */}
          <Card padding={16}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {mode === "compose" && (
                <>
                  <button className="le-btn-dark" onClick={() => createPublish.mutate()} disabled={createPublish.isPending} style={{ width: "100%", justifyContent: "center" }}>
                    Publish now
                  </button>
                  <button className="le-btn-ghost" onClick={() => createDraft.mutate()} disabled={createDraft.isPending} style={{ width: "100%", justifyContent: "center" }}>
                    Save as draft
                  </button>
                </>
              )}
              {mode === "edit-manual" && (
                <>
                  <button className="le-btn-dark" onClick={() => publishIt.mutate()} disabled={publishIt.isPending} style={{ width: "100%", justifyContent: "center" }}>
                    Publish now
                  </button>
                  <button className="le-btn-ghost" onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending} style={{ width: "100%", justifyContent: "center" }}>
                    Save
                  </button>
                </>
              )}
              {mode === "review-auto" && (
                <>
                  <button className="le-btn-dark" onClick={() => publishIt.mutate()} style={{ width: "100%", justifyContent: "center" }}>
                    Approve &amp; publish
                  </button>
                  <button className="le-btn-ghost" onClick={() => saveEdit.mutate()} style={{ width: "100%", justifyContent: "center" }}>
                    Save changes
                  </button>
                  <button
                    onClick={() => reject.mutate()}
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid rgba(196,74,74,0.3)",
                      background: "rgba(196,74,74,0.06)",
                      color: "var(--bad)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    Reject
                  </button>
                </>
              )}
              {mode === "edit-live" && (
                <>
                  <button className="le-btn-dark" onClick={() => updateSierra.mutate()} disabled={updateSierra.isPending} style={{ width: "100%", justifyContent: "center" }}>
                    Save &amp; update Sierra
                  </button>
                  {post?.external_post_url && (
                    <a href={post.external_post_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <button className="le-btn-ghost" style={{ width: "100%", justifyContent: "center" }}>
                        View on Sierra
                      </button>
                    </a>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Featured image */}
          <Card padding={16}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={FIELD_LABEL}>Featured image</span>
              {form.image ? (
                <>
                  <img
                    src={thumbUrl(form.image.blob_url, { width: 600, quality: 75 })}
                    loading="lazy"
                    decoding="async"
                    style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block" }}
                    alt={form.image.vision_caption ?? ""}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="le-btn-ghost" onClick={() => setPickerOpen(true)} style={{ fontSize: 12 }}>Change</button>
                    <button className="le-btn-ghost" onClick={() => setForm({ ...form, image: null })} style={{ fontSize: 12 }}>Remove</button>
                  </div>
                </>
              ) : (
                <button className="le-btn-ghost" onClick={() => setPickerOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <Icon name="image" size={13} />
                  Pick image
                </button>
              )}
            </div>
          </Card>

          {/* Meta fields */}
          <Card padding={16}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              <Field label="Author">
                <select
                  value={form.author_label ?? ""}
                  onChange={e => setForm({ ...form, author_label: e.target.value })}
                  disabled={readOnly}
                  style={SELECT_STYLE}
                >
                  <option value="">— Select author —</option>
                  {taxonomy.authors.filter(a => a.label && !a.label.toLowerCase().startsWith("select")).map(a => (
                    <option key={a.id} value={a.label}>{a.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Category">
                <select
                  value={form.category_label ?? ""}
                  onChange={e => setForm({ ...form, category_label: e.target.value })}
                  disabled={readOnly}
                  style={SELECT_STYLE}
                >
                  <option value="">— Select category —</option>
                  {taxonomy.categories.filter(c => c.label && !c.label.toLowerCase().startsWith("choose") && !c.label.startsWith("---")).map(c => (
                    <option key={c.id} value={c.label}>{c.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Meta title">
                <input value={form.meta_title} onChange={e => setForm({ ...form, meta_title: e.target.value })} disabled={readOnly} style={INPUT_STYLE} />
              </Field>

              <Field label="Meta description">
                <textarea value={form.meta_description} onChange={e => setForm({ ...form, meta_description: e.target.value })} disabled={readOnly} style={TEXTAREA_STYLE} />
              </Field>

              <Field label="Meta keywords (comma-separated)">
                <input value={form.meta_tags} onChange={e => setForm({ ...form, meta_tags: e.target.value })} disabled={readOnly} style={INPUT_STYLE} />
              </Field>

              <Field label="Schedule for (optional)">
                <input
                  type="datetime-local"
                  value={form.publish_at?.slice(0, 16) ?? ""}
                  onChange={e => setForm({ ...form, publish_at: e.target.value ? new Date(e.target.value).toISOString() : "" })}
                  disabled={readOnly}
                  style={INPUT_STYLE}
                />
              </Field>
            </div>
          </Card>
        </div>
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
          <div style={{ overflow: "hidden", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
            <HtmlPreview html={form.body_html || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: "70vh", border: "none", display: "block" }} />
          </div>
        </DialogContent>
      </Dialog>

      {/* AI draft preview & apply dialog */}
      <Dialog open={aiPreviewOpen} onOpenChange={(v) => !v && setAIPreviewOpen(false)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="sparkles" size={14} />
              AI draft preview
            </DialogTitle>
          </DialogHeader>
          {aiResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>Current</div>
                  <HtmlPreview html={form.body_html || "<p style='color:#9ca3af'>(empty)</p>"} style={{ width: "100%", height: 360, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>AI-generated</div>
                  <HtmlPreview html={aiResult.body_html} style={{ width: "100%", height: 360, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="le-btn-ghost" onClick={discardAIResult}>Discard</button>
                <button className="le-btn-dark" onClick={applyAIResult}>Use this</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
