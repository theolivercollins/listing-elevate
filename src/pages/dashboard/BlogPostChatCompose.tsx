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
import {
  AllyThinking, AllySkeleton, AllyShimmerOverlay, AutoGrowTextarea,
} from "@/components/blog/ally-status";
import { dailyStarters } from "@/components/blog/ally-starters";

const STARTERS = dailyStarters(4);

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
  // Transient flags: pending (in-flight assistant placeholder), queued (user
  // message waiting its turn), suggestResearch (server-side hint).
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean; queued?: boolean; suggestResearch?: boolean })[]>([]);
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

  // Pending bubble starts with empty content; useAllyStatus drives the
  // live-status text so the message rotates through phases as time passes.
  const nextPlaceholder = () => "";

  const chat = useMutation({
    mutationFn: async (args: { historyForApi: AIChatMessage[] }) => {
      const r = await aiChat(args.historyForApi, form.body_html, {
        templateId: templateId || null,
        includeRecentPosts,
        researchMode: useResearch ? "always" : "auto",
        attachments: attachments.length ? attachments : undefined,
      });
      return { r };
    },
    onSuccess: ({ r }) => {
      // Replace the trailing pending placeholder with Ally's real reply.
      setMessages((prev) => {
        const copy = prev.slice();
        const lastIdx = copy.length - 1;
        const msg = {
          role: "assistant" as const,
          content: r.reply,
          suggestResearch: r.suggest_research === true && !useResearch,
        };
        if (lastIdx >= 0 && copy[lastIdx].pending) copy[lastIdx] = msg;
        else copy.push(msg);
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

  function enableResearchAndRetry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && !m.pending);
    if (!lastUser) {
      setUseResearch(true);
      return;
    }
    setUseResearch(true);
    const lastUserIdx = messages.lastIndexOf(lastUser);
    setMessages(messages.slice(0, lastUserIdx));
    setTimeout(() => send(lastUser.content), 0);
  }

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");

    // Already running? Queue it — appears in thread with "queued" badge and
    // auto-fires when the current turn finishes.
    if (chat.isPending) {
      setMessages((prev) => [...prev, { role: "user", content: t, queued: true }]);
      return;
    }

    const userMsg: AIChatMessage = { role: "user", content: t };
    const placeholder = { role: "assistant" as const, content: nextPlaceholder(), pending: true };
    const historyForApi: AIChatMessage[] = [
      ...messages.filter((m) => !m.pending && !m.queued).map(({ role, content }) => ({ role, content })),
      userMsg,
    ];
    setMessages((prev) => [...prev.filter((m) => !m.pending), userMsg, placeholder]);
    chat.mutate({ historyForApi });
  }

  // Promote the first queued message + fire when the current turn ends.
  useEffect(() => {
    if (chat.isPending) return;
    const firstQueuedIdx = messages.findIndex((m) => m.queued);
    if (firstQueuedIdx === -1) return;

    const historyForApi: AIChatMessage[] = messages
      .slice(0, firstQueuedIdx + 1)
      .filter((m) => !m.pending && !m.queued)
      .map(({ role, content }) => ({ role, content }))
      .concat({ role: "user", content: messages[firstQueuedIdx].content });

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.queued);
      if (idx === -1) return prev;
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], queued: false };
      copy.splice(idx + 1, 0, { role: "assistant", content: nextPlaceholder(), pending: true });
      return copy;
    });
    setTimeout(() => chat.mutate({ historyForApi }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isPending]);

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
      navigate(`/dashboard/studio/blog/posts/${r.id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createPublish = useMutation({
    mutationFn: (state: FormState) => createPost(buildCreateInput(state, "publish_due")),
    onSuccess: (r) => {
      toast.success("Publishing — live within 60s");
      navigate(`/dashboard/studio/blog/posts/${r.id}`);
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

  // Status owned by <AllyThinking /> inside the pending bubble.

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
  // Stay sendable while a turn is in flight — sends queue instead.
  const canSend = input.trim().length > 0 || attachments.length > 0;
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
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12,
          borderBottom: "1px solid var(--line)", background: "var(--surface)",
          padding: "10px 20px", flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/dashboard/studio/blog/posts")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "6px 10px", borderRadius: 999,
            border: "1px solid var(--line)", background: "transparent",
            color: "var(--muted)", fontSize: 12, fontWeight: 500, cursor: "pointer",
            fontFamily: "var(--le-font-sans)",
          }}
        >
          <ChevronLeft style={{ width: 13, height: 13 }} /> Posts
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare style={{ width: 15, height: 15, color: "var(--accent)" }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>
            New post · Chat with Ally
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)", display: "none" }} className="md:inline">
            {selectedTemplate ? <>· template <span style={{ fontWeight: 600 }}>{selectedTemplate.name}</span></>
              : includeRecentPosts ? <>· style-matched to recent posts</>
              : <>· free-form</>}
            {useResearch ? (
              <span style={{ marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)" }}>
                · <Globe style={{ marginLeft: 2, width: 11, height: 11 }} /> research always-on
              </span>
            ) : (
              <span style={{ marginLeft: 4, display: "inline-flex", alignItems: "center", gap: 3, color: "var(--muted)" }}>
                · <Globe style={{ marginLeft: 2, width: 11, height: 11 }} /> research: auto
              </span>
            )}
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {totalCostCents > 0 && (
            <span style={{ fontSize: 11, color: "var(--muted-2)", fontVariantNumeric: "tabular-nums" }}>
              ${(totalCostCents / 100).toFixed(3)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowFields((v) => !v)}
            className="le-btn-ghost"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {showFields ? "Hide fields" : "Show fields"}
          </button>
          <button
            type="button"
            onClick={() => createDraft.mutate(form)}
            disabled={createDraft.isPending || !form.body_html.trim()}
            className="le-btn-ghost"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {createDraft.isPending && <Loader2 style={{ width: 13, height: 13, marginRight: 4, animation: "spin 1s linear infinite" }} />}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => createPublish.mutate(form)}
            disabled={createPublish.isPending || !form.body_html.trim()}
            className="le-btn-dark"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {createPublish.isPending && <Loader2 style={{ width: 13, height: 13, marginRight: 4, animation: "spin 1s linear infinite" }} />}
            Publish now
          </button>
        </div>
      </div>

      {/* Body — chat on left, preview-dominant fields on right (Claude-artifact ratio) */}
      <div className={`grid min-h-0 flex-1 ${showFields ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-1"} grid-cols-1`}>
        {/* CHAT COLUMN */}
        <div className="relative flex min-h-0 flex-col" style={{ background: "var(--bg, #f3f3f5)" }}>
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
                <h2 style={{
                  marginBottom: 32, textAlign: "center",
                  fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 600,
                  letterSpacing: "-0.025em", color: "var(--ink)", lineHeight: 1.1,
                }}>
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
                  useResearch={useResearch} onUseResearchChange={setUseResearch}
                />
                <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, maxWidth: 560 }}>
                  {STARTERS.map((s) => (
                    <button
                      key={s} type="button" onClick={() => send(s)}
                      className="le-btn-ghost"
                      style={{ fontSize: 12, padding: "7px 14px" }}
                    >
                      <Sparkles style={{ marginRight: 6, width: 11, height: 11, display: "inline" }} />
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
                <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-5" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {messages.map((m, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <motion.div
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                        style={
                          m.role === "user"
                            ? {
                                marginLeft: "auto", maxWidth: "88%", whiteSpace: "pre-wrap",
                                borderRadius: "18px 18px 6px 18px",
                                background: "var(--ink)", padding: "10px 14px",
                                fontSize: 13.5, color: "var(--surface)",
                                boxShadow: "0 1px 3px rgba(11,11,16,0.12)",
                                opacity: m.queued ? 0.7 : 1,
                                outline: m.queued ? "1px solid rgba(255,255,255,0.2)" : "none",
                              }
                            : {
                                maxWidth: "88%", whiteSpace: "pre-wrap",
                                borderRadius: "18px 18px 18px 6px",
                                background: "var(--surface)", padding: "10px 14px",
                                fontSize: 13.5, color: m.pending ? "var(--muted)" : "var(--ink)",
                                fontStyle: m.pending ? "italic" : "normal",
                                border: "1px solid var(--line)",
                                boxShadow: "0 1px 2px rgba(11,11,16,0.04)",
                              }
                        }
                      >
                        <div className="flex items-center gap-2">
                          {m.role === "assistant" && m.pending ? (
                            <AllyThinking active research={useResearch} size="md" />
                          ) : (
                            <span>{m.content}</span>
                          )}
                          {m.queued && (
                            <span style={{
                              marginLeft: 6, borderRadius: 999, background: "rgba(255,255,255,0.18)",
                              padding: "2px 7px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
                            }}>
                              queued
                            </span>
                          )}
                        </div>
                      </motion.div>
                      {m.role === "assistant" && m.suggestResearch && !useResearch && (
                        <motion.button
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.15, delay: 0.05 }}
                          onClick={enableResearchAndRetry}
                          disabled={chat.isPending}
                          className="le-btn-ghost"
                          style={{ fontSize: 12, padding: "6px 12px", color: "var(--accent)" }}
                        >
                          <Globe style={{ width: 12, height: 12 }} /> Search the web &amp; retry
                        </motion.button>
                      )}
                    </div>
                  ))}

                  {pendingActions.map((card) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
                      style={{
                        maxWidth: "88%", borderRadius: "var(--le-r-xl)", border: "1px solid rgba(42,111,219,0.25)",
                        background: "rgba(42,111,219,0.05)", padding: 14,
                      }}
                    >
                      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13.5, color: "var(--ink)" }}>
                        {card.kind === "publish" ? "Publish this post to Sierra?" : "Save this as a draft?"}
                      </div>
                      <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                        <div><span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{card.snapshot.title || "Untitled"}</span></div>
                        {card.snapshot.author_label && <div>by {card.snapshot.author_label}</div>}
                        {card.snapshot.category_label && <div>in {card.snapshot.category_label}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="le-btn-dark"
                          style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => confirmAction(card)}
                          disabled={createDraft.isPending || createPublish.isPending}
                        >
                          {card.kind === "publish" ? "Publish now" : "Save draft"}
                        </button>
                        <button type="button" className="le-btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => cancelAction(card)}>
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  ))}

                </div>

                <div style={{ borderTop: "1px solid var(--line)", background: "rgba(255,255,255,0.95)", padding: "12px 20px 16px", backdropFilter: "blur(8px)" }}>
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
            style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--line)", background: "var(--surface)" }}
            className="min-h-0"
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", background: "var(--surface)", padding: "10px 16px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                Post details
                <span style={{ marginLeft: 8, color: "var(--muted)", fontWeight: 500 }}>{filledFieldsCount}/8 filled</span>
              </div>
              <button type="button" className="le-btn-ghost" style={{ fontSize: 11.5, padding: "5px 10px" }} onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
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
                    style={{ display: "block", width: "100%", borderRadius: "var(--le-r-md)", border: "1px solid var(--line)", background: "var(--surface)", padding: "7px 10px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
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
                    style={{ display: "block", width: "100%", borderRadius: "var(--le-r-md)", border: "1px solid var(--line)", background: "var(--surface)", padding: "7px 10px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
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
                  <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>
                    <Globe style={{ width: 12, height: 12 }} /> Research sources
                    <span style={{ fontWeight: 400 }}>· {sources.length}</span>
                  </div>
                  <ol style={{ display: "flex", flexDirection: "column", gap: 4, borderRadius: "var(--le-r-md)", border: "1px solid var(--line)", background: "var(--surface)", padding: "8px 10px", fontSize: 12 }}>
                    {sources.map((s, i) => (
                      <li key={s.url} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                        <span style={{ color: "var(--muted-2)" }}>[{i + 1}]</span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent)", textDecoration: "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
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
              <div className="relative flex min-h-0 flex-col" style={{ borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", background: "rgba(11,11,16,0.025)", padding: "6px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("rendered")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4, borderRadius: "var(--le-r-sm)",
                        padding: "4px 8px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                        background: previewMode === "rendered" ? "var(--surface)" : "transparent",
                        color: previewMode === "rendered" ? "var(--ink)" : "var(--muted)",
                        boxShadow: previewMode === "rendered" ? "var(--shadow-sm)" : "none",
                      }}
                      title="Rendered preview"
                    >
                      <Eye style={{ width: 11, height: 11 }} /> Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode("source")}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4, borderRadius: "var(--le-r-sm)",
                        padding: "4px 8px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                        background: previewMode === "source" ? "var(--surface)" : "transparent",
                        color: previewMode === "source" ? "var(--ink)" : "var(--muted)",
                        boxShadow: previewMode === "source" ? "var(--shadow-sm)" : "none",
                      }}
                      title="HTML source"
                    >
                      <Code2 style={{ width: 11, height: 11 }} /> Source
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{form.body_html ? `${form.body_html.length.toLocaleString()} chars` : "empty"}</span>
                    <button
                      type="button"
                      onClick={openPreviewInNewTab}
                      disabled={!form.body_html}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4, borderRadius: "var(--le-r-sm)",
                        padding: "4px 8px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                        background: "transparent", color: "var(--muted)",
                        opacity: !form.body_html ? 0.4 : 1,
                      }}
                      title="Open in new tab"
                    >
                      <ExternalLink style={{ width: 11, height: 11 }} /> Open
                    </button>
                  </div>
                </div>
                {/* First-turn empty + isPending → skeleton ghost so the user sees
                    layout taking shape rather than a static "(empty)" page. */}
                {chat.isPending && !form.body_html.trim() ? (
                  <div className="flex-1 overflow-auto">
                    <AllySkeleton />
                  </div>
                ) : previewMode === "rendered" ? (
                  <HtmlPreview
                    html={form.body_html || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>Ally hasn't drafted anything yet — send a message.</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                ) : (
                  <pre className="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200">
                    <code>{form.body_html || "<!-- Empty -->"}</code>
                  </pre>
                )}
                {/* Subsequent turns with existing content + isPending → shimmer
                    overlay so the user sees activity without losing the previous draft underneath. */}
                <AllyShimmerOverlay visible={chat.isPending && !!form.body_html.trim()} />
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
        selectedId={form.image?.id ?? null}
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
      <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Label style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-2)" }}>{label}</Label>
        {filled && (
          <motion.span
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}
            style={{ fontSize: 10, color: "var(--good)", fontWeight: 500 }}
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
    <div style={{ marginLeft: "auto", marginRight: "auto", width: "100%", maxWidth: big ? 640 : undefined }}>
      {attachments.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 999, border: "1px solid var(--line)", background: "rgba(11,11,16,0.035)", padding: "4px 10px", fontSize: 11.5 }}>
              {a.kind === "pdf" ? <FileText style={{ width: 11, height: 11 }} /> : a.kind === "image" ? <ImageIcon style={{ width: 11, height: 11 }} /> : <FileText style={{ width: 11, height: 11 }} />}
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
              <span style={{ color: "var(--muted)" }}>{formatBytes(a.kind === "text" ? a.data.length : (a.data.length * 3) / 4)}</span>
              <button onClick={() => onRemoveAttachment(i)} style={{ marginLeft: 2, borderRadius: "var(--le-r-sm)", padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }} aria-label="Remove">
                <X style={{ width: 11, height: 11 }} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, borderRadius: "var(--le-r-xl)", border: "1px solid var(--line)", background: "var(--surface)", padding: "8px 12px", boxShadow: "var(--shadow-sm)", transition: "border-color .2s, box-shadow .2s" }} className="focus-within:!border-[rgba(42,111,219,0.4)] focus-within:!shadow-md">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" style={{ width: 34, height: 34, borderRadius: 999, border: "1px solid var(--line)", background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--muted)" }}>
              <Plus style={{ width: 15, height: 15 }} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <button
              type="button" onClick={onFilePick}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, borderRadius: "var(--le-r-sm)", padding: "8px 8px", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--ink)" }}
              className="hover:bg-muted"
            >
              <Paperclip style={{ width: 15, height: 15 }} />
              <div style={{ flex: 1 }}>
                <div>Attach file</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>PDF, image, CSV, .txt · up to 5 · 3 MB each</div>
              </div>
            </button>
            <div style={{ margin: "6px 0", borderTop: "1px solid var(--line)" }} />
            <div style={{ padding: "6px 8px" }}>
              <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                <LayoutTemplate style={{ width: 13, height: 13 }} /> Template
              </div>
              <select
                value={templateId}
                onChange={(e) => onTemplateChange(e.target.value)}
                style={{ display: "block", width: "100%", borderRadius: "var(--le-r-sm)", border: "1px solid var(--line)", background: "var(--surface)", padding: "6px 8px", fontSize: 13, color: "var(--ink)", fontFamily: "var(--le-font-sans)" }}
              >
                <option value="">— None —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div style={{ marginTop: 5, fontSize: 11, color: "var(--muted-2)" }}>AI fills the template's sections.</div>
            </div>
            <div style={{ margin: "6px 0", borderTop: "1px solid var(--line)" }} />
            <label style={{ display: "flex", cursor: "pointer", alignItems: "flex-start", gap: 8, borderRadius: "var(--le-r-sm)", padding: "8px 8px" }} className="hover:bg-muted">
              <input
                type="checkbox"
                checked={includeRecentPosts}
                onChange={(e) => onIncludeRecentPostsChange(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Wand2 style={{ width: 13, height: 13 }} /> Match recent posts
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  Style + depth of your last 5 published posts.
                </div>
              </div>
            </label>
            <label style={{ display: "flex", cursor: "pointer", alignItems: "flex-start", gap: 8, borderRadius: "var(--le-r-sm)", padding: "8px 8px" }} className="hover:bg-muted">
              <input
                type="checkbox"
                checked={useResearch}
                onChange={(e) => onUseResearchChange(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Globe style={{ width: 13, height: 13 }} /> Always research
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  Off: Ally only searches when your request needs fresh data (current rates, market stats, recent news). On: Gemini grounding every turn.
                </div>
              </div>
            </label>
          </PopoverContent>
        </Popover>

        <AutoGrowTextarea
          value={input}
          onChange={onInputChange}
          onSend={onSend}
          placeholder={
            isPending
              ? "Type to queue a follow-up while Ally finishes…"
              : big
                ? "Ask anything — describe the post, paste numbers, attach a market report…"
                : "Ask for tweaks, paste numbers, say 'publish it'…"
          }
          minRows={big ? 2 : 1}
          maxHeight={big ? 180 : 140}
        />

        <button
          type="button" onClick={onSend} disabled={!canSend}
          className="le-btn-dark"
          style={{ width: 34, height: 34, padding: 0, borderRadius: 999, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: !canSend ? 0.4 : 1 }}
          title={isPending ? "Queue for next" : "Send"}
        >
          <ArrowUp style={{ width: 15, height: 15 }} />
        </button>
      </div>

      <div style={{ marginTop: 6, paddingLeft: 4, fontSize: 11, color: "var(--muted-2)" }}>
        Enter to send · Shift+Enter for a new line · Say "publish it" or "save as draft" to ship.
      </div>
    </div>
  );
}
