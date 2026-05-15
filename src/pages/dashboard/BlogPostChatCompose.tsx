import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowUp, Code2, ExternalLink, FileText, Eye, Globe, Image as ImageIcon,
  LayoutTemplate, Loader2, MessageSquare, Paperclip, Plus, Sparkles, Wand2, X,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiChat, createPost, getTaxonomy, listTemplates,
  type AIChatMessage, type AIChatResponse, type AIResearchSource,
} from "@/lib/blog/api-client";
import type { AIAttachment, BlogImage, CreatePostInput } from "@/lib/blog/types";
import { thumbUrl } from "@/lib/blog/image-url";
import { ImagePickerModal } from "@/components/blog/ImagePickerModal";
import { HtmlPreview } from "@/components/blog/HtmlPreview";

const STARTERS = [
  "Punta Gorda May market update — inventory up 4%, median $385K",
  "5 reasons to list this fall in Charlotte County",
  "Neighborhood spotlight: Burnt Store Isles",
  "How rising rates affect Punta Gorda buyers right now",
];

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 3_500_000;

interface PendingActionCard {
  id: string;
  kind: "publish" | "save_draft";
  // Snapshot of form state at the moment AI proposed the action — lets the
  // user click Confirm later without worrying about drift.
  snapshot: FormState;
}

interface FormState {
  title: string;
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string[];
  author_label: string;
  category_label: string;
  image: BlogImage | null;
}

const emptyForm: FormState = {
  title: "", body_html: "", meta_title: "", meta_description: "", meta_tags: [],
  author_label: "", category_label: "", image: null,
};

function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function BlogPostChatCompose() {
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(emptyForm);
  // Messages keep an optional `pending` flag for the optimistic placeholder
  // bubble that appears the instant the user hits send. Once the real reply
  // comes back, the trailing pending message gets replaced in place.
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean })[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingActionCard[]>([]);
  const [input, setInput] = useState("");
  const [totalCostCents, setTotalCostCents] = useState(0);

  const [templateId, setTemplateId] = useState("");
  const [includeRecentPosts, setIncludeRecentPosts] = useState(true);
  const [useResearch, setUseResearch] = useState(false);
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [previewMode, setPreviewMode] = useState<"rendered" | "source">("rendered");
  const [sources, setSources] = useState<AIResearchSource[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"], queryFn: () => listTemplates(),
  });
  const templates = tplData?.templates ?? [];
  const { data: taxonomyData } = useQuery({
    queryKey: ["blog-taxonomy"], queryFn: () => getTaxonomy(),
  });
  const taxonomy = taxonomyData ?? { authors: [], categories: [] };

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length, pendingActions.length]);

  // -- chat --------------------------------------------------------------------

  const ALLY_PLACEHOLDERS = [
    "On it — give me a sec.",
    "Got it. Drafting now…",
    "One sec, putting that together.",
    "Working on it now.",
  ];
  const ALLY_RESEARCH_PLACEHOLDERS = [
    "Pulling sources from Google first…",
    "Researching now — one sec.",
    "Hitting the web for current numbers.",
  ];
  function nextPlaceholder() {
    const pool = useResearch ? ALLY_RESEARCH_PLACEHOLDERS : ALLY_PLACEHOLDERS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const chat = useMutation({
    mutationFn: async (args: { historyForApi: AIChatMessage[] }) => {
      const r = await aiChat(args.historyForApi, form.body_html, {
        templateId: templateId || null,
        includeRecentPosts,
        research: useResearch,
        attachments: attachments.length ? attachments : undefined,
      });
      return { r };
    },
    onSuccess: ({ r }) => {
      // Replace the trailing pending placeholder with Ally's real reply.
      setMessages((prev) => {
        const copy = prev.slice();
        const lastIdx = copy.length - 1;
        if (lastIdx >= 0 && copy[lastIdx].pending) {
          copy[lastIdx] = { role: "assistant", content: r.reply };
        } else {
          copy.push({ role: "assistant", content: r.reply });
        }
        return copy;
      });

      // AI manages the whole post — patch every field it sent back.
      setForm((f) => {
        const next: FormState = {
          ...f,
          title: r.title ?? f.title,
          body_html: r.body_html || f.body_html,
          meta_title: r.meta_title ?? f.meta_title,
          meta_description: r.meta_description ?? f.meta_description,
          meta_tags: r.meta_tags ?? f.meta_tags,
          author_label: r.author ?? f.author_label,
          category_label: r.category ?? f.category_label,
        };
        if (r.action) {
          setPendingActions((prev) => [
            ...prev,
            { id: `${Date.now()}-${prev.length}`, kind: r.action!, snapshot: next },
          ]);
        }
        return next;
      });

      if (r.body_html && !showPreview) setShowPreview(true);
      setTotalCostCents((c) => c + r.cost_cents);
      setAttachments([]);
      if (r.research_sources && r.research_sources.length > 0) {
        // Merge unique by url so repeat turns don't duplicate.
        setSources((prev) => {
          const seen = new Set(prev.map((s) => s.url));
          return [...prev, ...r.research_sources.filter((s) => !seen.has(s.url))];
        });
      }
    },
    onError: (e: any) => {
      const msg = e?.message ?? String(e);
      toast.error(`Chat failed: ${msg}`);
      setMessages((prev) => {
        const copy = prev.slice();
        const lastIdx = copy.length - 1;
        if (lastIdx >= 0 && copy[lastIdx].pending) {
          copy[lastIdx] = { role: "assistant", content: `Hit an error: ${msg}` };
        }
        return copy;
      });
    },
  });

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    // Optimistic: show the user message + Ally's placeholder INSTANTLY so the
    // input feels responsive. Real reply replaces the placeholder on success.
    const userMsg: AIChatMessage = { role: "user", content: t };
    const placeholder = { role: "assistant" as const, content: nextPlaceholder(), pending: true };
    const historyForApi: AIChatMessage[] = [
      ...messages.filter((m) => !m.pending).map(({ role, content }) => ({ role, content })),
      userMsg,
    ];
    setMessages((prev) => [...prev.filter((m) => !m.pending), userMsg, placeholder]);
    chat.mutate({ historyForApi });
  }

  // -- post mutations ----------------------------------------------------------

  function buildCreateInput(state: FormState, initialState: "awaiting_approval" | "publish_due"): CreatePostInput {
    return {
      title: state.title || "Untitled",
      body_html: state.body_html || "<p></p>",
      meta_title: state.meta_title || null,
      meta_description: state.meta_description || null,
      meta_tags: state.meta_tags,
      author_label: state.author_label || null,
      category_label: state.category_label || null,
      image_id: state.image?.id ?? null,
      publish_at: null,
      initial_state: initialState,
      authored: "manual",
    };
  }

  const createDraft = useMutation({
    mutationFn: (state: FormState) => createPost(buildCreateInput(state, "awaiting_approval")),
    onSuccess: (r) => {
      toast.success("Saved as draft");
      navigate(`/dashboard/blog/posts/${r.id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createPublish = useMutation({
    mutationFn: (state: FormState) => createPost(buildCreateInput(state, "publish_due")),
    onSuccess: (r) => {
      toast.success("Publishing — live within 60s");
      navigate(`/dashboard/blog/posts/${r.id}`);
    },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  function confirmAction(card: PendingActionCard) {
    if (card.kind === "publish") createPublish.mutate(card.snapshot);
    else createDraft.mutate(card.snapshot);
    setPendingActions((prev) => prev.filter((a) => a.id !== card.id));
  }
  function cancelAction(card: PendingActionCard) {
    setPendingActions((prev) => prev.filter((a) => a.id !== card.id));
  }

  // -- attachment upload -------------------------------------------------------

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const slots = MAX_ATTACHMENTS - attachments.length;
    for (const file of files.slice(0, slots)) {
      if (file.size > MAX_FILE_BYTES) { toast.error(`${file.name} > 3MB`); continue; }
      const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
      const isImage = file.type.startsWith("image/");
      const isText = file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt");
      if (!isPdf && !isImage && !isText) { toast.error(`${file.name}: unsupported`); continue; }
      if (isText) {
        const text = await file.text();
        if (text.length > 100_000) { toast.error(`${file.name}: > 100KB`); continue; }
        setAttachments((p) => [...p, { kind: "text", filename: file.name, data: text }]);
      } else {
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
        }
        const b64 = btoa(binary);
        setAttachments((p) => [...p, {
          kind: isPdf ? "pdf" : "image",
          filename: file.name,
          data: b64,
          media_type: isPdf ? "application/pdf" : (file.type || "image/jpeg"),
        }]);
      }
    }
  }

  // -- popout preview ----------------------------------------------------------

  function openPreviewInNewTab() {
    const css = `
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; font-size: 16px; line-height: 1.65; color: #1f2937; padding: 32px; max-width: 760px; margin: 0 auto; background: #fff; }
      h1 { font-size: 32px; font-weight: 700; margin: 24px 0 12px; }
      h2 { font-size: 24px; font-weight: 700; margin: 28px 0 12px; }
      h3 { font-size: 19px; font-weight: 600; margin: 22px 0 8px; }
      p { margin: 14px 0; }
      table { border-collapse: collapse; margin: 18px 0; width: 100%; font-size: 14px; }
      th, td { border: 1px solid #e5e7eb; padding: 9px 12px; text-align: left; vertical-align: top; }
      th { background: #f9fafb; font-weight: 600; }
      ul, ol { padding-left: 26px; margin: 14px 0; }
      li { margin: 4px 0; }
      a { color: #2563eb; text-decoration: underline; }
      img { max-width: 100%; height: auto; border-radius: 6px; }
      blockquote { border-left: 3px solid #e5e7eb; padding-left: 16px; margin: 18px 0; color: #6b7280; font-style: italic; }
      hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    `.replace(/\s+/g, " ");
    const title = form.title || "Post preview";
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><h1>${title}</h1>${form.body_html || "<p><em>Empty.</em></p>"}</body></html>`;
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("Popup blocked — allow popups for this site");
    // Revoke the blob URL once the tab has loaded; ~1m gives any slow load time.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // -- derived -----------------------------------------------------------------

  const hasThread = messages.length > 0 || chat.isPending;
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !chat.isPending;
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const filledFieldsCount = useMemo(
    () => [
      form.title, form.body_html, form.meta_title, form.meta_description,
      form.author_label, form.category_label, form.image?.id ?? "",
    ].filter(Boolean).length + (form.meta_tags.length ? 1 : 0),
    [form],
  );

  // -- render ------------------------------------------------------------------

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-5 py-3">
        <button
          type="button"
          onClick={() => navigate("/dashboard/blog/posts")}
          className="-ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Posts
        </button>
        <div className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-medium">New post · Chat with Ally</span>
          <span className="hidden text-xs text-muted-foreground md:inline">
            {selectedTemplate ? <>· template <span className="font-medium">{selectedTemplate.name}</span></>
              : includeRecentPosts ? <>· style-matched to recent posts</>
              : <>· free-form</>}
            {useResearch && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                · <Globe className="ml-0.5 h-3 w-3" /> research on
              </span>
            )}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {totalCostCents > 0 && (
            <span className="text-xs text-muted-foreground">${(totalCostCents / 100).toFixed(3)}</span>
          )}
          <button
            type="button"
            onClick={() => setShowFields((v) => !v)}
            className="hidden rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted md:inline-block"
          >
            {showFields ? "Hide fields" : "Show fields"}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => createDraft.mutate(form)}
            disabled={createDraft.isPending || !form.body_html.trim()}
          >
            {createDraft.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => createPublish.mutate(form)}
            disabled={createPublish.isPending || !form.body_html.trim()}
          >
            {createPublish.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Publish now
          </Button>
        </div>
      </div>

      {/* Body — chat on left, preview-dominant fields on right (Claude-artifact ratio) */}
      <div className={`grid min-h-0 flex-1 ${showFields ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-1"} grid-cols-1`}>
        {/* CHAT COLUMN */}
        <div className="relative flex min-h-0 flex-col bg-background">
          <AnimatePresence mode="wait">
            {!hasThread && pendingActions.length === 0 ? (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex flex-1 flex-col items-center justify-center px-6"
              >
                <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
                  Ready when you are.
                </h2>
                <Composer
                  big
                  input={input} onInputChange={setInput}
                  onSend={() => send(input)} canSend={canSend} isPending={chat.isPending}
                  attachments={attachments}
                  onRemoveAttachment={(i) => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                  onFilePick={() => fileInputRef.current?.click()}
                  templates={templates} templateId={templateId} onTemplateChange={setTemplateId}
                  includeRecentPosts={includeRecentPosts} onIncludeRecentPostsChange={setIncludeRecentPosts}
                />
                <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s} type="button" onClick={() => send(s)}
                      className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="thread"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
                className="flex flex-1 flex-col min-h-0"
              >
                <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
                  {messages.map((m, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                      className={
                        m.role === "user"
                          ? "ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm"
                          : `max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm ${m.pending ? "italic text-muted-foreground" : ""}`
                      }
                    >
                      <div className="flex items-center gap-2">
                        {m.role === "assistant" && m.pending && (
                          <span className="inline-flex h-3 items-end gap-0.5" aria-hidden>
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]"></span>
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]"></span>
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"></span>
                          </span>
                        )}
                        <span>{m.content}</span>
                      </div>
                    </motion.div>
                  ))}

                  {pendingActions.map((card) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
                      className="max-w-[88%] rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"
                    >
                      <div className="mb-2 font-medium">
                        {card.kind === "publish" ? "Publish this post to Sierra?" : "Save this as a draft?"}
                      </div>
                      <div className="mb-3 space-y-0.5 text-xs text-muted-foreground">
                        <div><span className="font-medium text-foreground">{card.snapshot.title || "Untitled"}</span></div>
                        {card.snapshot.author_label && <div>by {card.snapshot.author_label}</div>}
                        {card.snapshot.category_label && <div>in {card.snapshot.category_label}</div>}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => confirmAction(card)}
                          disabled={createDraft.isPending || createPublish.isPending}
                        >
                          {card.kind === "publish" ? "Publish now" : "Save draft"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => cancelAction(card)}>
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  ))}

                </div>

                <div className="border-t bg-background/95 px-5 pb-4 pt-3 backdrop-blur">
                  <Composer
                    input={input} onInputChange={setInput}
                    onSend={() => send(input)} canSend={canSend} isPending={chat.isPending}
                    attachments={attachments}
                    onRemoveAttachment={(i) => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                    onFilePick={() => fileInputRef.current?.click()}
                    templates={templates} templateId={templateId} onTemplateChange={setTemplateId}
                    includeRecentPosts={includeRecentPosts} onIncludeRecentPostsChange={setIncludeRecentPosts}
                    useResearch={useResearch} onUseResearchChange={setUseResearch}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,application/pdf,image/*,text/csv,text/plain"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {/* FIELDS SIDEBAR */}
        {showFields && (
          <motion.div
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
            className="flex min-h-0 flex-col border-l bg-muted/10"
          >
            <div className="flex items-center justify-between border-b bg-background px-4 py-2">
              <div className="text-xs font-medium">
                Post details
                <span className="ml-2 text-muted-foreground">{filledFieldsCount}/8 filled</span>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Hide preview" : "Show preview"}
              </Button>
            </div>

            {/* Split the sidebar: fields on top, preview pinned below at ~50%
                when toggled on — preview was previously a tiny 360px box at
                the end of the scrollable list, which made it nearly useless. */}
            <div className={`flex-1 min-h-0 ${showPreview ? "grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)]" : "block"}`}>
            <div className="space-y-4 overflow-y-auto p-4 min-h-0">
              <Field label="Title" filled={!!form.title}>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="AI will suggest this; you can override."
                />
              </Field>

              <Field label="Featured image" filled={!!form.image}>
                {form.image ? (
                  <div className="space-y-2">
                    <img
                      src={thumbUrl(form.image.blob_url, { width: 600, quality: 75 })}
                      loading="lazy" decoding="async"
                      className="w-full rounded-md border"
                      alt={form.image.vision_caption ?? ""}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Change</Button>
                      <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, image: null })}>Remove</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                    <ImageIcon className="mr-1 h-3.5 w-3.5" /> Pick image
                  </Button>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Author" filled={!!form.author_label}>
                  <select
                    value={form.author_label}
                    onChange={(e) => setForm({ ...form, author_label: e.target.value })}
                    className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {taxonomy.authors.filter((a) => a.label && !a.label.toLowerCase().startsWith("select")).map((a) => (
                      <option key={a.id} value={a.label}>{a.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Category" filled={!!form.category_label}>
                  <select
                    value={form.category_label}
                    onChange={(e) => setForm({ ...form, category_label: e.target.value })}
                    className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {taxonomy.categories.filter((c) => c.label && !c.label.toLowerCase().startsWith("choose") && !c.label.startsWith("---")).map((c) => (
                      <option key={c.id} value={c.label}>{c.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Meta title (SEO)" filled={!!form.meta_title}>
                <Input
                  value={form.meta_title}
                  onChange={(e) => setForm({ ...form, meta_title: e.target.value })}
                  placeholder="≤60 chars"
                />
              </Field>
              <Field label="Meta description (SEO)" filled={!!form.meta_description}>
                <Textarea
                  value={form.meta_description}
                  onChange={(e) => setForm({ ...form, meta_description: e.target.value })}
                  placeholder="≤155 chars"
                  rows={2}
                />
              </Field>
              <Field label="Meta keywords" filled={form.meta_tags.length > 0}>
                <Input
                  value={form.meta_tags.join(", ")}
                  onChange={(e) => setForm({ ...form, meta_tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                  placeholder="comma, separated, keywords"
                />
              </Field>

              {sources.length > 0 && (
                <div>
                  <Label className="mb-1 flex items-center gap-1 text-xs">
                    <Globe className="h-3 w-3" /> Research sources
                    <span className="font-normal text-muted-foreground">· {sources.length}</span>
                  </Label>
                  <ol className="space-y-1 rounded-md border bg-background p-2 text-xs">
                    {sources.map((s, i) => (
                      <li key={s.url} className="flex items-start gap-1.5">
                        <span className="text-muted-foreground">[{i + 1}]</span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-2 text-primary underline-offset-2 hover:underline"
                          title={s.url}
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

            </div>

            {showPreview && (
              <div className="flex min-h-0 flex-col border-t bg-white">
                <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewMode("rendered")}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${previewMode === "rendered" ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50"}`}
                      title="Rendered preview"
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("source")}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${previewMode === "source" ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50"}`}
                      title="HTML source"
                    >
                      <Code2 className="h-3 w-3" /> Source
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>{form.body_html ? `${form.body_html.length.toLocaleString()} chars` : "empty"}</span>
                    <button
                      type="button"
                      onClick={openPreviewInNewTab}
                      disabled={!form.body_html}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-background/50 disabled:opacity-40"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-3 w-3" /> Open
                    </button>
                  </div>
                </div>
                {previewMode === "rendered" ? (
                  <HtmlPreview
                    html={form.body_html || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>Ally hasn't drafted anything yet — send a message.</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                ) : (
                  <pre className="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200">
                    <code>{form.body_html || "<!-- Empty -->"}</code>
                  </pre>
                )}
              </div>
            )}
            </div>
          </motion.div>
        )}
      </div>

      <ImagePickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(img) => setForm({ ...form, image: img })}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Field — sidebar label + body + subtle filled indicator.
// ----------------------------------------------------------------------------
function Field({
  label, filled, children,
}: { label: string; filled?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {filled && (
          <motion.span
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}
            className="text-[10px] text-emerald-600"
          >
            ✓ filled
          </motion.span>
        )}
      </div>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Composer — same shape as the modal's, kept local for now since this page is
// the only consumer. Extract later if a third site needs it.
// ----------------------------------------------------------------------------
interface ComposerProps {
  big?: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  canSend: boolean;
  isPending: boolean;
  attachments: AIAttachment[];
  onRemoveAttachment: (i: number) => void;
  onFilePick: () => void;
  templates: { id: string; name: string }[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  includeRecentPosts: boolean;
  onIncludeRecentPostsChange: (v: boolean) => void;
  useResearch: boolean;
  onUseResearchChange: (v: boolean) => void;
}

function Composer({
  big = false,
  input, onInputChange, onSend, canSend, isPending,
  attachments, onRemoveAttachment, onFilePick,
  templates, templateId, onTemplateChange,
  includeRecentPosts, onIncludeRecentPostsChange,
  useResearch, onUseResearchChange,
}: ComposerProps) {
  return (
    <div className={`mx-auto w-full ${big ? "max-w-2xl" : ""}`}>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
              {a.kind === "pdf" ? <FileText className="h-3 w-3" /> : a.kind === "image" ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              <span className="max-w-[160px] truncate">{a.filename}</span>
              <span className="text-muted-foreground">{formatBytes(a.kind === "text" ? a.data.length : (a.data.length * 3) / 4)}</span>
              <button onClick={() => onRemoveAttachment(i)} className="ml-0.5 rounded p-0.5 hover:bg-background" aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border bg-background px-3 py-2 shadow-sm transition focus-within:border-primary/40 focus-within:shadow-md">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 rounded-full p-0">
              <Plus className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <button
              type="button" onClick={onFilePick}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
            >
              <Paperclip className="h-4 w-4" />
              <div className="flex-1">
                <div>Attach file</div>
                <div className="text-xs text-muted-foreground">PDF, image, CSV, .txt · up to 5 · 3 MB each</div>
              </div>
            </button>
            <div className="my-1 border-t" />
            <div className="px-2 py-1.5">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <LayoutTemplate className="h-3.5 w-3.5" /> Template
              </div>
              <select
                value={templateId}
                onChange={(e) => onTemplateChange(e.target.value)}
                className="block w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— None —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-muted-foreground">AI fills the template's sections.</div>
            </div>
            <div className="my-1 border-t" />
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <input
                type="checkbox"
                checked={includeRecentPosts}
                onChange={(e) => onIncludeRecentPostsChange(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" /> Match recent posts
                </div>
                <div className="text-xs text-muted-foreground">
                  Style + depth of your last 5 published posts.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <input
                type="checkbox"
                checked={useResearch}
                onChange={(e) => onUseResearchChange(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> Research with Gemini
                </div>
                <div className="text-xs text-muted-foreground">
                  Each turn, Gemini searches the web first and feeds current numbers + sources to Ally.
                </div>
              </div>
            </label>
          </PopoverContent>
        </Popover>

        <Textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={big ? "Ask anything — describe the post, paste numbers, attach a market report…" : "Ask for tweaks, paste numbers, say 'publish it'…"}
          rows={big ? 2 : 1}
          className="min-h-0 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{ maxHeight: 200 }}
          disabled={isPending}
        />

        <Button
          type="button" onClick={onSend} disabled={!canSend}
          className="h-9 w-9 shrink-0 rounded-full p-0"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line · Say "publish it" or "save as draft" to ship.
      </div>
    </div>
  );
}
