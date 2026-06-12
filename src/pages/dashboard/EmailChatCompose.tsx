// src/pages/dashboard/EmailChatCompose.tsx
//
// Chat-as-page email compose — direct port of BlogPostChatCompose but using
// email-specific fields + aiEmailChat. Same hero / thread / live-preview /
// sidebar pattern. On send/save_draft action, creates the email row and
// navigates to /dashboard/studio/email/messages/:id.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
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
      navigate(`/dashboard/studio/email/messages/${r.id}`);
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
      navigate(`/dashboard/studio/email/messages/${r.id}`);
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
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12,
          borderBottom: "1px solid var(--line)", background: "var(--surface)",
          padding: "10px 20px", flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/dashboard/studio/email/messages")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "6px 10px", borderRadius: 999,
            border: "1px solid var(--line)", background: "transparent",
            color: "var(--muted)", fontSize: 12, fontWeight: 500, cursor: "pointer",
            fontFamily: "var(--le-font-sans)",
          }}
        >
          <ChevronLeft style={{ width: 13, height: 13 }} /> Emails
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare style={{ width: 15, height: 15, color: "var(--accent)" }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>
            New email · Chat with Ally
          </span>
          {useResearch && (
            <span style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)" }}>
              · <Globe style={{ marginLeft: 2, width: 11, height: 11 }} /> research always-on
            </span>
          )}
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
            onClick={() => createDraftMutation.mutate(form)}
            disabled={createDraftMutation.isPending || !form.body_html.trim()}
            className="le-btn-ghost"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {createDraftMutation.isPending && <Loader2 style={{ width: 13, height: 13, marginRight: 4, animation: "spin 1s linear infinite" }} />}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => createSendMutation.mutate(form)}
            disabled={createSendMutation.isPending || !form.body_html.trim()}
            className="le-btn-dark"
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            {createSendMutation.isPending && <Loader2 style={{ width: 13, height: 13, marginRight: 4, animation: "spin 1s linear infinite" }} />}
            Mark ready
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={`grid min-h-0 flex-1 ${showFields ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-1"} grid-cols-1`}>
        {/* Chat column */}
        <div className="relative flex min-h-0 flex-col" style={{ background: "var(--bg, #f3f3f5)" }}>
          <AnimatePresence mode="wait">
            {!hasThread && pendingActions.length === 0 ? (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
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
                          initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15, delay: 0.05 }}
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
                        {card.kind === "send" ? "Send this email?" : card.kind === "test_send" ? "Send a test email?" : "Save this as a draft?"}
                      </div>
                      <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                        {card.snapshot.subject && <div><span style={{ fontWeight: 600, color: "var(--ink-2)" }}>{card.snapshot.subject}</span></div>}
                        {card.snapshot.audience && <div>Audience: {card.snapshot.audience}</div>}
                        {card.snapshot.from_email && <div>From: {card.snapshot.from_email}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className="le-btn-dark"
                          style={{ fontSize: 12, padding: "6px 14px" }}
                          onClick={() => confirmAction(card)}
                          disabled={createDraftMutation.isPending || createSendMutation.isPending}
                        >
                          {card.kind === "send" ? "Save ready" : card.kind === "test_send" ? "Save" : "Save draft"}
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
            style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--line)", background: "var(--surface)" }}
            className="min-h-0"
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", background: "var(--surface)", padding: "10px 16px" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                Email details
                <span style={{ marginLeft: 8, color: "var(--muted)", fontWeight: 500 }}>{filledFieldsCount}/6 filled</span>
              </div>
              <button type="button" className="le-btn-ghost" style={{ fontSize: 11.5, padding: "5px 10px" }} onClick={() => setShowPreview((v) => !v)}>
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
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

// Field component — sidebar label + body + subtle filled indicator (matches
// BlogPostChatCompose's Field exactly so the two compose pages are twins).
function Field({ label, filled, children }: { label: string; filled?: boolean; children: React.ReactNode }) {
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
        Enter to send · Shift+Enter for a new line · Say "save as draft" or "mark ready" to ship.
      </div>
    </div>
  );
}
