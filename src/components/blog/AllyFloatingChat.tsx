import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowUp, Brain, Check, Eye, FileText, Globe, Image as ImageIcon,
  Paperclip, Plus, RotateCcw, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiChat, listAllyMemories, deleteAllyMemory,
  type AIChatMessage, type AIResearchSource,
} from "@/lib/blog/api-client";
import type { AIAttachment } from "@/lib/blog/types";
import { AllyThinking, AutoGrowTextarea } from "./ally-status";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { HtmlPreview } from "./HtmlPreview";

/**
 * "Improve with AI" floating chat anchored to the bottom-right corner of the
 * post detail page. Same /api/blog/ai/chat backend as the chat-compose page,
 * but advisory: each proposed change shows an Apply button that patches the
 * parent form state. Saving still happens via the existing Save / Update
 * Sierra buttons on the detail page — we never silently persist from here.
 */

interface FormPatch {
  title?: string;
  body_html?: string;
  meta_title?: string;
  meta_description?: string;
  meta_tags?: string[];
  author_label?: string;
  category_label?: string;
}

interface ProposalCard {
  id: string;
  reply: string;
  /** Only the fields that actually changed vs. the current form. */
  patch: FormPatch;
  /** Human-readable label like "title, body, meta description". */
  changedSummary: string;
  /** Multi-line plain-text bullets from Ally describing each change. */
  changesNarrative: string | null;
  /** Snapshot of the body BEFORE this proposal — used for the diff view. */
  beforeBodyHtml: string;
  /** Snapshot of the body AFTER (Ally's proposed body) — for the diff view. */
  afterBodyHtml: string;
  /** Title snapshots so the diff modal can show those too if changed. */
  beforeTitle: string;
  afterTitle: string;
  applied: boolean;
}

interface Props {
  /** Post id — used to scope the persisted chat thread in localStorage. */
  postId: string;
  /** Used as the chat's "current_html" so each turn anchors on the latest draft. */
  currentBodyHtml: string;
  /** Existing form values — chat sees them as the starting state. */
  current: {
    title: string;
    meta_title: string;
    meta_description: string;
    meta_tags: string[];
    author_label: string;
    category_label: string;
  };
  /** Called with a partial form when user clicks Apply. */
  onApply: (patch: FormPatch) => void;
  /** Hint shown in the chat header — usually "Editing live post" / "Editing draft". */
  contextLabel?: string;
}

const STARTERS = [
  "Tighten the intro — it's too long",
  "Add a section about HOA fees",
  "Suggest a stronger title",
  "Punchier closing CTA",
];

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 3_500_000;

function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function summariseChanges(patch: FormPatch): string {
  const bits: string[] = [];
  if (patch.title !== undefined) bits.push("title");
  if (patch.body_html !== undefined) bits.push("body");
  if (patch.meta_title !== undefined) bits.push("meta title");
  if (patch.meta_description !== undefined) bits.push("meta description");
  if (patch.meta_tags !== undefined) bits.push("keywords");
  if (patch.author_label !== undefined) bits.push("author");
  if (patch.category_label !== undefined) bits.push("category");
  if (bits.length === 0) return "no changes";
  if (bits.length === 1) return bits[0];
  if (bits.length === 2) return bits.join(" + ");
  return bits.slice(0, -1).join(", ") + ", and " + bits.slice(-1);
}

import { loadPersisted, savePersisted, clearPersisted } from "./ally-storage";

export function AllyFloatingChat({ postId, currentBodyHtml, current, onApply, contextLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [diffCard, setDiffCard] = useState<ProposalCard | null>(null);

  // Hydrate from localStorage on first render so reopening Ally on the same
  // post resumes the conversation. New posts start with empty state.
  const initial = (typeof window !== "undefined" ? loadPersisted(postId) : null);
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean; queued?: boolean; suggestResearch?: boolean })[]>(initial?.messages ?? []);
  const [proposals, setProposals] = useState<ProposalCard[]>(initial?.proposals ?? []);
  const [input, setInput] = useState("");
  const [useResearch, setUseResearch] = useState(initial?.useResearch ?? false);
  const [sources, setSources] = useState<AIResearchSource[]>(initial?.sources ?? []);
  const [totalCostCents, setTotalCostCents] = useState(initial?.totalCostCents ?? 0);
  // Attachments are one-shot per turn — never persisted, consumed on send.
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
  // Memories panel — what Ally has been told to remember (site-wide, not per-post).
  const { data: memoriesData } = useQuery({
    queryKey: ["ally-memories"],
    queryFn: () => listAllyMemories(),
    enabled: open,
  });
  const memories = memoriesData?.memories ?? [];
  const delMemory = useMutation({
    mutationFn: (id: string) => deleteAllyMemory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ally-memories"] }),
    onError: (e: any) => toast.error(`Couldn't forget: ${e?.message ?? e}`),
  });

  // Save thread to localStorage on every change (debounced via React batching).
  useEffect(() => {
    savePersisted(postId, {
      v: 1,
      messages: messages.filter((m) => !m.pending), // drop transient placeholders
      proposals,
      sources,
      totalCostCents,
      useResearch,
    });
  }, [postId, messages, proposals, sources, totalCostCents, useResearch]);

  // Always send the latest current state to the API — refs avoid closure
  // staleness on the in-flight mutation.
  const latestRef = useRef({ currentBodyHtml, current });
  useEffect(() => {
    latestRef.current = { currentBodyHtml, current };
  }, [currentBodyHtml, current]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length, proposals.length, open]);

  const chat = useMutation({
    mutationFn: async (args: { historyForApi: AIChatMessage[]; attachments?: AIAttachment[] }) => {
      const { currentBodyHtml: html } = latestRef.current;
      const r = await aiChat(args.historyForApi, html, {
        templateId: null,
        includeRecentPosts: true,
        researchMode: useResearch ? "always" : "auto",
        attachments: args.attachments && args.attachments.length ? args.attachments : undefined,
      });
      return { r };
    },
    onSuccess: ({ r }) => {
      // Replace trailing pending placeholder with the real reply text.
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy.length - 1;
        const msg = {
          role: "assistant" as const,
          content: r.reply,
          suggestResearch: r.suggest_research === true && !useResearch,
        };
        if (last >= 0 && copy[last].pending) copy[last] = msg;
        else copy.push(msg);
        return copy;
      });

      // Build the proposed patch — only include fields that actually changed
      // vs. the current state, so applying doesn't churn unchanged values.
      const cur = latestRef.current.current;
      const curHtml = latestRef.current.currentBodyHtml;
      const patch: FormPatch = {};
      if (r.title !== null && r.title !== undefined && r.title !== cur.title) patch.title = r.title;
      if (r.body_html && r.body_html !== curHtml) patch.body_html = r.body_html;
      if (r.meta_title !== null && r.meta_title !== undefined && r.meta_title !== cur.meta_title) patch.meta_title = r.meta_title;
      if (r.meta_description !== null && r.meta_description !== undefined && r.meta_description !== cur.meta_description) patch.meta_description = r.meta_description;
      if (
        Array.isArray(r.meta_tags) &&
        r.meta_tags.join("\n") !== cur.meta_tags.join("\n")
      ) {
        patch.meta_tags = r.meta_tags;
      }
      if (r.author !== null && r.author !== undefined && r.author !== cur.author_label) patch.author_label = r.author;
      if (r.category !== null && r.category !== undefined && r.category !== cur.category_label) patch.category_label = r.category;

      if (Object.keys(patch).length > 0) {
        setProposals((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${prev.length}`,
            reply: r.reply,
            patch,
            changedSummary: summariseChanges(patch),
            changesNarrative: r.changes_summary,
            beforeBodyHtml: curHtml,
            afterBodyHtml: patch.body_html ?? curHtml,
            beforeTitle: cur.title,
            afterTitle: patch.title ?? cur.title,
            applied: false,
          },
        ]);
      }

      setTotalCostCents((c) => c + r.cost_cents);
      if (r.research_sources?.length) {
        setSources((prev) => {
          const seen = new Set(prev.map((s) => s.url));
          return [...prev, ...r.research_sources.filter((s) => !seen.has(s.url))];
        });
      }
      if (r.new_memory) {
        toast.success(`Got it. I'll remember: "${r.new_memory.content.slice(0, 80)}${r.new_memory.content.length > 80 ? "…" : ""}"`);
        qc.invalidateQueries({ queryKey: ["ally-memories"] });
      }
    },
    onError: (e: any) => {
      const msg = e?.message ?? String(e);
      toast.error(`Chat failed: ${msg}`);
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy.length - 1;
        if (last >= 0 && copy[last].pending) {
          copy[last] = { role: "assistant", content: `Hit an error: ${msg}` };
        }
        return copy;
      });
    },
  });

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");

    // If a turn is in flight, queue the message: it appears in the thread
    // with a "queued" badge and auto-fires as soon as the current turn lands.
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
    const sentAttachments = attachments;
    setAttachments([]); // one-shot — clear immediately so user sees them consumed
    chat.mutate({ historyForApi, attachments: sentAttachments });
  }

  // When the current turn finishes, promote the first queued message and fire it.
  useEffect(() => {
    if (chat.isPending) return;
    const firstQueuedIdx = messages.findIndex((m) => m.queued);
    if (firstQueuedIdx === -1) return;

    const historyForApi: AIChatMessage[] = messages
      .slice(0, firstQueuedIdx + 1)
      .filter((m) => !m.pending && !m.queued)
      .map(({ role, content }) => ({ role, content }))
      // Add the queued message at the end (it was filtered out as queued).
      .concat({ role: "user", content: messages[firstQueuedIdx].content });

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.queued);
      if (idx === -1) return prev;
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], queued: false };
      copy.splice(idx + 1, 0, { role: "assistant", content: "", pending: true });
      return copy;
    });
    // Defer mutate to next tick so React commits the setMessages first.
    setTimeout(() => chat.mutate({ historyForApi }), 0); // no attachments on queued turns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isPending]);

  // Status is owned by <AllyThinking /> directly inside the pending bubble.

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

  function resetChat() {
    if (messages.length === 0 && proposals.length === 0) return;
    if (!window.confirm("Clear this conversation? The post itself isn't affected.")) return;
    setMessages([]);
    setProposals([]);
    setSources([]);
    setTotalCostCents(0);
    setAttachments([]);
    clearPersisted(postId);
  }

  function enableResearchAndRetry() {
    // Find the last user message and resend it with research on.
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && !m.pending);
    if (!lastUser) {
      setUseResearch(true);
      return;
    }
    setUseResearch(true);
    // Trim trailing assistant messages so we don't get duplicate replies.
    const lastUserIdx = messages.lastIndexOf(lastUser);
    setMessages(messages.slice(0, lastUserIdx)); // remove the user msg + anything after
    // Defer send so state has flushed.
    setTimeout(() => send(lastUser.content), 0);
  }

  function applyProposal(card: ProposalCard) {
    onApply(card.patch);
    setProposals((prev) => prev.map((p) => (p.id === card.id ? { ...p, applied: true } : p)));
    toast.success(`Applied: ${card.changedSummary}`);
  }

  function dismissProposal(card: ProposalCard) {
    setProposals((prev) => prev.filter((p) => p.id !== card.id));
  }

  const empty = messages.length === 0 && proposals.length === 0;

  return (
    <>
      {/* Closed-state floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="bubble"
            type="button"
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            onClick={() => setOpen(true)}
            className="le-btn-dark"
            style={{
              position: "fixed", bottom: 20, right: 20, zIndex: 50,
              padding: "10px 18px", borderRadius: "var(--le-r-pill)",
              boxShadow: "var(--shadow-lg)", fontSize: 13.5,
            }}
            aria-label="Improve with Ally"
          >
            <Sparkles style={{ width: 15, height: 15 }} />
            <span style={{ fontWeight: 600 }}>Improve with Ally</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Open-state panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="le-card-strong"
            style={{
              position: "fixed", bottom: 20, right: 20, zIndex: 50,
              display: "flex", flexDirection: "column", overflow: "hidden",
              width: "min(440px, calc(100vw - 24px))",
              height: "min(640px, calc(100vh - 100px))",
              borderRadius: "var(--le-r-xl)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--line, var(--le-border))", background: "rgba(255,255,255,0.97)", padding: "10px 12px", backdropFilter: "blur(8px)" }}>
              <Sparkles style={{ width: 15, height: 15, color: "var(--accent, var(--le-accent))", flexShrink: 0 }} />
              <div style={{ flex: 1, lineHeight: 1.3 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink, var(--le-text))" }}>Improve with Ally</div>
                <div style={{ fontSize: 11, color: "var(--muted, var(--le-muted))", display: "flex", alignItems: "center", gap: 4 }}>
                  {contextLabel ?? "Suggestions apply to this post"}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: useResearch ? "var(--accent, var(--le-accent))" : "var(--muted, var(--le-muted))" }}>
                    · <Globe style={{ marginLeft: 2, width: 10, height: 10 }} /> {useResearch ? "research always-on" : "research: auto"}
                  </span>
                </div>
              </div>
              {totalCostCents > 0 && (
                <span style={{ fontSize: 10, color: "var(--muted-2, var(--le-faint))", fontVariantNumeric: "tabular-nums", display: "none" }} className="sm:inline">
                  ${(totalCostCents / 100).toFixed(3)}
                </span>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    style={{ position: "relative", borderRadius: "var(--le-r-sm)", padding: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted, var(--le-muted))" }}
                    className="hover:bg-muted hover:!text-foreground"
                    aria-label="Ally's memory"
                    title={memories.length ? `Ally remembers ${memories.length} note${memories.length === 1 ? "" : "s"}` : "Ally's memory"}
                  >
                    <Brain style={{ width: 14, height: 14 }} />
                    {memories.length > 0 && (
                      <span style={{
                        position: "absolute", right: -2, top: -2,
                        display: "inline-flex", height: 14, minWidth: 14, alignItems: "center", justifyContent: "center",
                        borderRadius: "var(--le-r-pill)", background: "var(--ink, var(--le-text))", padding: "0 3px",
                        fontSize: 9, fontWeight: 600, color: "#fff",
                      }}>
                        {memories.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-2">
                  <div style={{ marginBottom: 8, padding: "0 4px", fontSize: 12, fontWeight: 500, color: "var(--muted, var(--le-muted))" }}>
                    Ally remembers ({memories.length})
                  </div>
                  {memories.length === 0 ? (
                    <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--muted, var(--le-muted))" }}>
                      Tell Ally to remember something — e.g. "from now on use Brian as the default author" — and it'll show up here.
                    </div>
                  ) : (
                    <ul style={{ maxHeight: 288, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                      {memories.map((m) => (
                        <li key={m.id} className="group" style={{ display: "flex", alignItems: "flex-start", gap: 8, borderRadius: "var(--le-r-sm)", padding: 8 }}>
                          <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>{m.content}</span>
                          <button
                            type="button"
                            onClick={() => delMemory.mutate(m.id)}
                            disabled={delMemory.isPending}
                            style={{ borderRadius: "var(--le-r-sm)", padding: 4, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted, var(--le-muted))", opacity: 0 }}
                            className="group-hover:!opacity-100 hover:!bg-[rgba(196,74,74,0.1)] hover:!text-[var(--bad, var(--le-bad))]"
                            aria-label="Forget this"
                            title="Forget this"
                          >
                            <Trash2 style={{ width: 12, height: 12 }} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
              {(messages.length > 0 || proposals.length > 0) && (
                <button
                  type="button"
                  onClick={resetChat}
                  style={{ borderRadius: "var(--le-r-sm)", padding: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted, var(--le-muted))" }}
                  className="hover:bg-muted"
                  aria-label="Reset conversation"
                  title="Reset this conversation"
                >
                  <RotateCcw style={{ width: 14, height: 14 }} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ borderRadius: "var(--le-r-sm)", padding: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--ink, var(--le-text))" }}
                className="hover:bg-muted"
                aria-label="Close"
              >
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>

            <div ref={scrollerRef} className="flex-1 overflow-y-auto" style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 10 }}>
              {empty && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--muted, var(--le-muted))" }}>
                    Ask Ally to tweak this post. I'll propose changes; you Apply what you like.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="le-btn-ghost"
                        style={{ fontSize: 11.5, padding: "5px 12px" }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    style={
                      m.role === "user"
                        ? {
                            marginLeft: "auto", maxWidth: "88%", whiteSpace: "pre-wrap",
                            borderRadius: "16px 16px 4px 16px",
                            background: "var(--ink, var(--le-text))", padding: "8px 12px",
                            fontSize: 12.5, color: "var(--surface, var(--le-surface))",
                            opacity: m.queued ? 0.7 : 1,
                            outline: m.queued ? "1px solid rgba(255,255,255,0.2)" : "none",
                          }
                        : {
                            maxWidth: "88%", whiteSpace: "pre-wrap",
                            borderRadius: "16px 16px 16px 4px",
                            background: "var(--surface, var(--le-surface))", padding: "8px 12px",
                            fontSize: 12.5, color: m.pending ? "var(--muted, var(--le-muted))" : "var(--ink, var(--le-text))",
                            fontStyle: m.pending ? "italic" : "normal",
                            border: "1px solid var(--line, var(--le-border))",
                            boxShadow: "var(--shadow-sm)",
                          }
                    }
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {m.role === "assistant" && m.pending ? (
                        <AllyThinking active research={useResearch} size="sm" />
                      ) : (
                        <span>{m.content}</span>
                      )}
                      {m.queued && (
                        <span style={{ marginLeft: 4, borderRadius: "var(--le-r-pill)", background: "rgba(255,255,255,0.18)", padding: "2px 6px", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
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
                      style={{ fontSize: 11.5, padding: "5px 10px", color: "var(--accent, var(--le-accent))", opacity: chat.isPending ? 0.5 : 1 }}
                    >
                      <Globe style={{ width: 11, height: 11 }} /> Search the web &amp; retry
                    </motion.button>
                  )}
                </div>
              ))}

              {proposals.map((card) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    borderRadius: "var(--le-r-lg)", padding: 12,
                    border: card.applied ? "1px solid rgba(47,138,85,0.4)" : "1px solid rgba(30,74,140,0.2)",
                    background: card.applied ? "rgba(47,138,85,0.07)" : "rgba(30,74,140,0.04)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: card.applied ? "var(--good, var(--le-good))" : "var(--ink, var(--le-text))" }}>
                    {card.applied ? (
                      <>
                        <Check style={{ width: 13, height: 13 }} />
                        Applied — {card.changedSummary}. Scroll up to review.
                      </>
                    ) : (
                      <>
                        <Wand2 style={{ width: 13, height: 13, color: "var(--accent, var(--le-accent))" }} />
                        Proposed changes — {card.changedSummary}
                      </>
                    )}
                  </div>
                  {card.changesNarrative && (
                    <ul style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 2, fontSize: 11, lineHeight: 1.4, color: "var(--ink-2, var(--le-text-secondary))" }}>
                      {card.changesNarrative
                        .split("\n")
                        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
                        .filter(Boolean)
                        .slice(0, 8)
                        .map((bullet, i) => (
                          <li key={i} style={{ display: "flex", gap: 6 }}>
                            <span style={{ color: "var(--muted, var(--le-muted))" }}>•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {!card.applied && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <button type="button" className="le-btn-dark" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={() => applyProposal(card)}>
                        Apply
                      </button>
                      {(card.patch.body_html !== undefined || card.patch.title !== undefined) && (
                        <button
                          type="button"
                          className="le-btn-ghost"
                          style={{ fontSize: 11.5, padding: "5px 10px" }}
                          onClick={() => setDiffCard(card)}
                        >
                          <Eye style={{ width: 11, height: 11, marginRight: 4 }} /> See the diff
                        </button>
                      )}
                      <button
                        type="button"
                        className="le-btn-ghost"
                        style={{ fontSize: 11.5, padding: "5px 10px" }}
                        onClick={() => dismissProposal(card)}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}

              {sources.length > 0 && (
                <div style={{ borderRadius: "var(--le-r-lg)", border: "1px solid var(--line, var(--le-border))", background: "rgba(12,14,22,0.02)", padding: 10, fontSize: 11 }}>
                  <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 4, fontWeight: 500, color: "var(--muted, var(--le-muted))" }}>
                    <Globe style={{ width: 11, height: 11 }} /> Sources · {sources.length}
                  </div>
                  <ol style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {sources.slice(0, 5).map((s, i) => (
                      <li key={s.url} style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                        <span style={{ color: "var(--muted-2, var(--le-faint))" }}>[{i + 1}]</span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--accent, var(--le-accent))", textDecoration: "none", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}
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

            {/* Composer */}
            <div style={{ borderTop: "1px solid var(--line, var(--le-border))", background: "rgba(255,255,255,0.97)", padding: "8px 12px 10px", backdropFilter: "blur(8px)" }}>
              {attachments.length > 0 && (
                <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {attachments.map((a, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: "var(--le-r-pill)", border: "1px solid var(--line, var(--le-border))", background: "rgba(12,14,22,0.035)", padding: "3px 8px", fontSize: 10.5 }}>
                      {a.kind === "pdf" ? <FileText style={{ width: 10, height: 10 }} /> : a.kind === "image" ? <ImageIcon style={{ width: 10, height: 10 }} /> : <FileText style={{ width: 10, height: 10 }} />}
                      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</span>
                      <span style={{ color: "var(--muted, var(--le-muted))" }}>{formatBytes(a.kind === "text" ? a.data.length : (a.data.length * 3) / 4)}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                        style={{ borderRadius: "var(--le-r-sm)", padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "var(--muted, var(--le-muted))" }}
                        aria-label="Remove attachment"
                      >
                        <X style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, borderRadius: "var(--le-r-xl)", border: "1px solid var(--line, var(--le-border))", background: "var(--surface, var(--le-surface))", padding: "6px 8px", boxShadow: "var(--shadow-sm)", transition: "border-color .2s" }} className="focus-within:!border-[rgba(30,74,140,0.4)]">
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" style={{ width: 28, height: 28, borderRadius: "var(--le-r-pill)", border: "1px solid var(--line, var(--le-border))", background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "var(--muted, var(--le-muted))" }}>
                      <Plus style={{ width: 13, height: 13 }} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, borderRadius: "var(--le-r-sm)", padding: "8px 8px", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--ink, var(--le-text))", opacity: attachments.length >= MAX_ATTACHMENTS ? 0.5 : 1 }}
                      className="hover:bg-muted"
                    >
                      <Paperclip style={{ width: 14, height: 14 }} />
                      <div style={{ flex: 1 }}>
                        <div>Attach file</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted, var(--le-muted))", marginTop: 2 }}>
                          PDF, image, CSV, .txt · up to {MAX_ATTACHMENTS} · 3 MB each · one-shot per turn
                        </div>
                      </div>
                    </button>
                    <div style={{ margin: "6px 0", borderTop: "1px solid var(--line, var(--le-border))" }} />
                    <label style={{ display: "flex", cursor: "pointer", alignItems: "flex-start", gap: 8, borderRadius: "var(--le-r-sm)", padding: "8px 8px" }} className="hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={useResearch}
                        onChange={(e) => setUseResearch(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <div style={{ flex: 1, fontSize: 13, color: "var(--ink, var(--le-text))" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <Globe style={{ width: 13, height: 13 }} /> Always research
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--muted, var(--le-muted))", marginTop: 3 }}>
                          Off: Ally auto-detects when fresh data is needed. On: Gemini every turn.
                        </div>
                      </div>
                    </label>
                  </PopoverContent>
                </Popover>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,application/pdf,image/*,text/csv,text/plain"
                  multiple
                  className="hidden"
                  onChange={onFileChange}
                />

                <AutoGrowTextarea
                  value={input}
                  onChange={setInput}
                  onSend={() => send(input)}
                  placeholder={chat.isPending ? "Type to queue a follow-up…" : "Ask Ally to tweak this post…"}
                  minRows={1}
                  maxHeight={110}
                  small
                />

                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() && attachments.length === 0}
                  className="le-btn-dark"
                  style={{ width: 28, height: 28, padding: 0, borderRadius: "var(--le-r-pill)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: (!input.trim() && attachments.length === 0) ? 0.4 : 1 }}
                  title={chat.isPending ? "Queue for next" : "Send"}
                >
                  <ArrowUp style={{ width: 13, height: 13 }} />
                </button>
              </div>
              <div style={{ marginTop: 5, paddingLeft: 4, fontSize: 10, color: "var(--muted-2, var(--le-faint))" }}>
                Enter to send · changes are advisory — click Save above to persist.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog open={!!diffCard} onOpenChange={(v) => { if (!v) setDiffCard(null); }}>
        <DialogContent className="max-w-6xl gap-0 p-0">
          <DialogHeader style={{ borderBottom: "1px solid var(--line, var(--le-border))", padding: "12px 20px" }}>
            <DialogTitle style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, color: "var(--ink, var(--le-text))" }}>
              <Eye style={{ width: 15, height: 15, color: "var(--accent, var(--le-accent))" }} /> See the change
              {diffCard && (
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted, var(--le-muted))" }}>
                  · {diffCard.changedSummary}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {diffCard && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {diffCard.changesNarrative && (
                <div style={{ borderBottom: "1px solid var(--line, var(--le-border))", background: "rgba(12,14,22,0.02)", padding: "12px 20px" }}>
                  <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 500, color: "var(--muted, var(--le-muted))" }}>What Ally changed</div>
                  <ul style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 13.5, lineHeight: 1.5 }}>
                    {diffCard.changesNarrative
                      .split("\n")
                      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
                      .filter(Boolean)
                      .map((bullet, i) => (
                        <li key={i} style={{ display: "flex", gap: 8 }}>
                          <span style={{ color: "var(--muted, var(--le-muted))" }}>•</span>
                          <span style={{ color: "var(--ink, var(--le-text))" }}>{bullet}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {(diffCard.beforeTitle !== diffCard.afterTitle) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--line, var(--le-border))", fontSize: 13.5 }}>
                  <div style={{ borderRight: "1px solid var(--line, var(--le-border))", padding: "12px 20px" }}>
                    <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted, var(--le-muted))" }}>Title — current</div>
                    <div style={{ borderRadius: "var(--le-r-sm)", background: "rgba(196,74,74,0.08)", padding: "6px 10px", color: "var(--bad, var(--le-bad))" }}>
                      {diffCard.beforeTitle || <em style={{ color: "var(--muted, var(--le-muted))" }}>(empty)</em>}
                    </div>
                  </div>
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted, var(--le-muted))" }}>Title — proposed</div>
                    <div style={{ borderRadius: "var(--le-r-sm)", background: "rgba(47,138,85,0.08)", padding: "6px 10px", color: "var(--good, var(--le-good))" }}>
                      {diffCard.afterTitle}
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "65vh" }}>
                <div style={{ display: "flex", minHeight: 0, flexDirection: "column", borderRight: "1px solid var(--line, var(--le-border))" }}>
                  <div style={{ borderBottom: "1px solid var(--line, var(--le-border))", background: "rgba(12,14,22,0.03)", padding: "6px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted, var(--le-muted))" }}>
                    Current draft
                  </div>
                  <HtmlPreview
                    html={diffCard.beforeBodyHtml || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>(empty)</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                </div>
                <div style={{ display: "flex", minHeight: 0, flexDirection: "column" }}>
                  <div style={{ borderBottom: "1px solid var(--line, var(--le-border))", background: "rgba(12,14,22,0.03)", padding: "6px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted, var(--le-muted))" }}>
                    Proposed
                  </div>
                  <HtmlPreview
                    html={diffCard.afterBodyHtml || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>(empty)</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line, var(--le-border))", padding: "12px 20px" }}>
                <button type="button" className="le-btn-ghost" style={{ fontSize: 13, padding: "7px 14px" }} onClick={() => setDiffCard(null)}>Close</button>
                {!diffCard.applied && (
                  <button type="button" className="le-btn-dark" style={{ fontSize: 13, padding: "7px 14px" }} onClick={() => { applyProposal(diffCard); setDiffCard(null); }}>
                    Apply this change
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
