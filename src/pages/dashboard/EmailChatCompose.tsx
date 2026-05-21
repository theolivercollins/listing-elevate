// src/pages/dashboard/EmailChatCompose.tsx
//
// Chat-as-page email compose — direct port of BlogPostChatCompose but using
// email-specific fields + aiEmailChat. Same hero / thread / live-preview /
// sidebar pattern. On send/save_draft action, creates the email row and
// navigates to /dashboard/blog/emails/:id.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowUp, ChevronLeft, Code2, Eye, ExternalLink, FileText, Globe,
  Image as ImageIcon, Loader2, MessageSquare, Paperclip, Plus, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiEmailChat, createEmail,
  type AIChatMessage, type AIResearchSource,
} from "@/lib/blog/api-client";
import type { AIAttachment, AIEmailChatResponse } from "@/lib/blog/types";
import { HtmlPreview } from "@/components/blog/HtmlPreview";
import {
  AllyThinking, AllySkeleton, AllyShimmerOverlay, AutoGrowTextarea,
} from "@/components/blog/ally-status";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 3_500_000;

interface PendingActionCard {
  id: string;
  kind: "send" | "save_draft" | "test_send";
  snapshot: EmailFormState;
}

interface EmailFormState {
  subject: string;
  preheader: string;
  body_html: string;
  from_name: string;
  from_email: string;
  audience: string;
}

const emptyForm: EmailFormState = {
  subject: "", preheader: "", body_html: "", from_name: "", from_email: "", audience: "",
};

function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function EmailChatCompose() {
  const navigate = useNavigate();

  const [form, setForm] = useState<EmailFormState>(emptyForm);
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean; queued?: boolean; suggestResearch?: boolean })[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingActionCard[]>([]);
  const [input, setInput] = useState("");
  const [totalCostCents, setTotalCostCents] = useState(0);
  const [useResearch, setUseResearch] = useState(false);
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const [showFields, setShowFields] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [previewMode, setPreviewMode] = useState<"rendered" | "source">("rendered");
  const [sources, setSources] = useState<AIResearchSource[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length, pendingActions.length]);

  const chat = useMutation({
    mutationFn: async (args: { historyForApi: AIChatMessage[] }) => {
      const r = await aiEmailChat(args.historyForApi, form.body_html, {
        researchMode: useResearch ? "always" : "auto",
        attachments: attachments.length ? attachments : undefined,
      });
      return { r };
    },
    onSuccess: ({ r }: { r: AIEmailChatResponse }) => {
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

      setForm((f) => {
        const next: EmailFormState = {
          ...f,
          subject: r.subject ?? f.subject,
          preheader: r.preheader ?? f.preheader,
          body_html: r.body_html || f.body_html,
          from_name: r.from_name ?? f.from_name,
          from_email: r.from_email ?? f.from_email,
          audience: r.audience ?? f.audience,
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
    if (!lastUser) { setUseResearch(true); return; }
    setUseResearch(true);
    const lastUserIdx = messages.lastIndexOf(lastUser);
    setMessages(messages.slice(0, lastUserIdx));
    setTimeout(() => send(lastUser.content), 0);
  }

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    if (chat.isPending) {
      setMessages((prev) => [...prev, { role: "user", content: t, queued: true }]);
      return;
    }
    const userMsg: AIChatMessage = { role: "user", content: t };
    const placeholder = { role: "assistant" as const, content: "", pending: true };
    const historyForApi: AIChatMessage[] = [
      ...messages.filter((m) => !m.pending && !m.queued).map(({ role, content }) => ({ role, content })),
      userMsg,
    ];
    setMessages((prev) => [...prev.filter((m) => !m.pending), userMsg, placeholder]);
    chat.mutate({ historyForApi });
  }

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
      copy.splice(idx + 1, 0, { role: "assistant", content: "", pending: true });
      return copy;
    });
    setTimeout(() => chat.mutate({ historyForApi }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isPending]);

  const createDraftMutation = useMutation({
    mutationFn: (state: EmailFormState) => createEmail({
      subject: state.subject || "Untitled email",
      preheader: state.preheader || null,
      body_html: state.body_html || "<p></p>",
      from_name: state.from_name || null,
      from_email: state.from_email || null,
      audience: state.audience || null,
      authored: "manual",
      initial_state: "draft",
    }),
    onSuccess: (r) => {
      toast.success("Saved as draft");
      navigate(`/dashboard/blog/emails/${r.id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const createSendMutation = useMutation({
    mutationFn: (state: EmailFormState) => createEmail({
      subject: state.subject || "Untitled email",
      preheader: state.preheader || null,
      body_html: state.body_html || "<p></p>",
      from_name: state.from_name || null,
      from_email: state.from_email || null,
      audience: state.audience || null,
      authored: "manual",
      initial_state: "ready",
    }),
    onSuccess: (r) => {
      toast.success("Saved as ready to send");
      navigate(`/dashboard/blog/emails/${r.id}`);
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  function confirmAction(card: PendingActionCard) {
    if (card.kind === "save_draft") createDraftMutation.mutate(card.snapshot);
    else createSendMutation.mutate(card.snapshot);
    setPendingActions((prev) => prev.filter((a) => a.id !== card.id));
  }
  function cancelAction(card: PendingActionCard) {
    setPendingActions((prev) => prev.filter((a) => a.id !== card.id));
  }

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

  function openPreviewInNewTab() {
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.subject || "Email preview"}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:0;}</style></head><body>${form.body_html || "<p><em>Empty.</em></p>"}</body></html>`;
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) toast.error("Popup blocked — allow popups for this site");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const hasThread = messages.length > 0 || chat.isPending;
  const canSend = input.trim().length > 0 || attachments.length > 0;
  const filledFieldsCount = useMemo(
    () => [form.subject, form.preheader, form.body_html, form.from_name, form.from_email, form.audience]
      .filter(Boolean).length,
    [form],
  );

  const STARTERS = [
    "Draft a market update email for buyers",
    "Write a home valuation offer to homeowners",
    "Create a just-listed announcement",
    "Write a seasonal real estate tips email",
  ];

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-background px-5 py-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate("/dashboard/blog/emails")}
          className="-ml-1 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Emails
        </button>
        <div className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-medium">New email · Chat with Ally</span>
          {useResearch && (
            <span className="inline-flex items-center gap-0.5 text-xs text-primary">
              · <Globe className="ml-0.5 h-3 w-3" /> research always-on
            </span>
          )}
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
            onClick={() => createDraftMutation.mutate(form)}
            disabled={createDraftMutation.isPending || !form.body_html.trim()}
          >
            {createDraftMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save draft
          </Button>
          <Button
            size="sm"
            onClick={() => createSendMutation.mutate(form)}
            disabled={createSendMutation.isPending || !form.body_html.trim()}
          >
            {createSendMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Mark ready
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className={`grid min-h-0 flex-1 ${showFields ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-1"} grid-cols-1`}>
        {/* Chat column */}
        <div className="relative flex min-h-0 flex-col bg-background">
          <AnimatePresence mode="wait">
            {!hasThread && pendingActions.length === 0 ? (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
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
                  useResearch={useResearch} onUseResearchChange={setUseResearch}
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
                    <div key={i} className="space-y-1.5">
                      <motion.div
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
                        className={
                          m.role === "user"
                            ? `ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm ${m.queued ? "opacity-70 ring-1 ring-primary-foreground/30" : ""}`
                            : `max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm ${m.pending ? "italic text-muted-foreground" : ""}`
                        }
                      >
                        <div className="flex items-center gap-2">
                          {m.role === "assistant" && m.pending ? (
                            <AllyThinking active research={useResearch} size="md" />
                          ) : (
                            <span>{m.content}</span>
                          )}
                          {m.queued && (
                            <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                              queued
                            </span>
                          )}
                        </div>
                      </motion.div>
                      {m.role === "assistant" && m.suggestResearch && !useResearch && (
                        <motion.button
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, delay: 0.05 }}
                          onClick={enableResearchAndRetry}
                          disabled={chat.isPending}
                          className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary transition hover:bg-primary/10 disabled:opacity-50"
                        >
                          <Globe className="h-3 w-3" /> Search the web &amp; retry
                        </motion.button>
                      )}
                    </div>
                  ))}

                  {pendingActions.map((card) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
                      className="max-w-[88%] rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"
                    >
                      <div className="mb-2 font-medium">
                        {card.kind === "send" ? "Send this email?" : card.kind === "test_send" ? "Send a test email?" : "Save this as a draft?"}
                      </div>
                      <div className="mb-3 space-y-0.5 text-xs text-muted-foreground">
                        {card.snapshot.subject && <div><span className="font-medium text-foreground">{card.snapshot.subject}</span></div>}
                        {card.snapshot.audience && <div>Audience: {card.snapshot.audience}</div>}
                        {card.snapshot.from_email && <div>From: {card.snapshot.from_email}</div>}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => confirmAction(card)}
                          disabled={createDraftMutation.isPending || createSendMutation.isPending}
                        >
                          {card.kind === "send" ? "Save ready" : card.kind === "test_send" ? "Save" : "Save draft"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => cancelAction(card)}>Cancel</Button>
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

        {/* Fields sidebar */}
        {showFields && (
          <motion.div
            initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
            className="flex min-h-0 flex-col border-l bg-muted/10"
          >
            <div className="flex items-center justify-between border-b bg-background px-4 py-2">
              <div className="text-xs font-medium">
                Email details
                <span className="ml-2 text-muted-foreground">{filledFieldsCount}/6 filled</span>
              </div>
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Hide preview" : "Show preview"}
              </Button>
            </div>

            <div className={`flex-1 min-h-0 ${showPreview ? "grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)]" : "block"}`}>
              <div className="space-y-4 overflow-y-auto p-4 min-h-0">
                <Field label="Subject" filled={!!form.subject}>
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    placeholder="Ally will suggest this"
                  />
                </Field>
                <Field label="Preheader" filled={!!form.preheader}>
                  <Input
                    value={form.preheader}
                    onChange={(e) => setForm({ ...form, preheader: e.target.value })}
                    placeholder="Preview text…"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From name" filled={!!form.from_name}>
                    <Input
                      value={form.from_name}
                      onChange={(e) => setForm({ ...form, from_name: e.target.value })}
                      placeholder="Your Name"
                    />
                  </Field>
                  <Field label="From email" filled={!!form.from_email}>
                    <Input
                      value={form.from_email}
                      onChange={(e) => setForm({ ...form, from_email: e.target.value })}
                      placeholder="you@example.com"
                      type="email"
                    />
                  </Field>
                </div>
                <Field label="Audience" filled={!!form.audience}>
                  <Input
                    value={form.audience}
                    onChange={(e) => setForm({ ...form, audience: e.target.value })}
                    placeholder="e.g. Buyers, Sellers, All"
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
                <div className="relative flex min-h-0 flex-col border-t bg-white">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("rendered")}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${previewMode === "rendered" ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50"}`}
                      >
                        <Eye className="h-3 w-3" /> Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("source")}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${previewMode === "source" ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50"}`}
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
                  <AllyShimmerOverlay visible={chat.isPending && !!form.body_html.trim()} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// Field component
function Field({ label, filled, children }: { label: string; filled?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {filled && (
          <motion.span
            initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.15 }}
            className="text-[10px] text-emerald-600"
          >
            filled
          </motion.span>
        )}
      </div>
      {children}
    </div>
  );
}

// Composer component
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
  useResearch: boolean;
  onUseResearchChange: (v: boolean) => void;
}

function Composer({
  big = false, input, onInputChange, onSend, canSend, isPending,
  attachments, onRemoveAttachment, onFilePick,
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
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <input
                type="checkbox"
                checked={useResearch}
                onChange={(e) => onUseResearchChange(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1 text-sm">
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> Always research
                </div>
                <div className="text-xs text-muted-foreground">
                  Off: Ally searches when needed. On: Gemini grounding every turn.
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
                ? "Describe the email you need — audience, topic, tone, goal…"
                : "Ask for tweaks, say 'save as draft' to ship…"
          }
          minRows={big ? 2 : 1}
          maxHeight={big ? 180 : 140}
        />

        <Button
          type="button" onClick={onSend} disabled={!canSend}
          className="h-9 w-9 shrink-0 rounded-full p-0"
          title={isPending ? "Queue for next" : "Send"}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for new line · Say "save as draft" or "mark ready" to ship.
      </div>
    </div>
  );
}
