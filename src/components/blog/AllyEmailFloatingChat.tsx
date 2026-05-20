// src/components/blog/AllyEmailFloatingChat.tsx
//
// "Improve with Ally" floating chat for the email detail page.
// Mirrors AllyFloatingChat.tsx but uses aiEmailChat + email-specific field patches.
// Advisory only — Apply patches the parent's form state; saving is still explicit.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  ArrowUp, Brain, Check, Eye, FileText, Globe, Image as ImageIcon, Loader2, Paperclip,
  Plus, RotateCcw, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiEmailChat, listAllyMemories, deleteAllyMemory,
  type AIChatMessage, type AIResearchSource,
} from "@/lib/blog/api-client";
import type { AIAttachment } from "@/lib/blog/types";
import { AllyThinking, AutoGrowTextarea } from "./ally-status";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { HtmlPreview } from "./HtmlPreview";
import {
  loadPersisted, savePersisted, clearPersisted,
  type EmailProposalCardSnapshot,
} from "./ally-email-storage";

interface EmailFormPatch {
  subject?: string;
  preheader?: string;
  body_html?: string;
  from_name?: string;
  from_email?: string;
  audience?: string;
}

interface ProposalCard extends EmailProposalCardSnapshot {}

interface Props {
  /** Email id — used to scope the persisted chat thread in localStorage. */
  emailId: string;
  /** Used as the chat's "current_html" so each turn anchors on the latest draft. */
  currentBodyHtml: string;
  /** Existing form values — chat sees them as the starting state. */
  current: {
    subject: string;
    preheader: string;
    from_name: string;
    from_email: string;
    audience: string;
  };
  /** Called with a partial email form when user clicks Apply. */
  onApply: (patch: EmailFormPatch) => void;
  /** Optional source post id for context injection. */
  sourcePostId?: string | null;
  contextLabel?: string;
}

const STARTERS = [
  "Make the subject line punchier",
  "Add an intro paragraph about current market conditions",
  "Suggest a stronger call to action",
  "Trim this down — it's too long",
];

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 3_500_000;

function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function summariseChanges(patch: EmailFormPatch): string {
  const bits: string[] = [];
  if (patch.subject !== undefined) bits.push("subject");
  if (patch.preheader !== undefined) bits.push("preheader");
  if (patch.body_html !== undefined) bits.push("body");
  if (patch.from_name !== undefined) bits.push("from name");
  if (patch.from_email !== undefined) bits.push("from email");
  if (patch.audience !== undefined) bits.push("audience");
  if (bits.length === 0) return "no changes";
  if (bits.length === 1) return bits[0];
  if (bits.length === 2) return bits.join(" + ");
  return bits.slice(0, -1).join(", ") + ", and " + bits.slice(-1);
}

export function AllyEmailFloatingChat({
  emailId, currentBodyHtml, current, onApply, sourcePostId, contextLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [diffCard, setDiffCard] = useState<ProposalCard | null>(null);

  const initial = typeof window !== "undefined" ? loadPersisted(emailId) : null;
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean; queued?: boolean; suggestResearch?: boolean })[]>(initial?.messages ?? []);
  const [proposals, setProposals] = useState<ProposalCard[]>(initial?.proposals ?? []);
  const [input, setInput] = useState("");
  const [useResearch, setUseResearch] = useState(initial?.useResearch ?? false);
  const [sources, setSources] = useState<AIResearchSource[]>(initial?.sources ?? []);
  const [totalCostCents, setTotalCostCents] = useState(initial?.totalCostCents ?? 0);
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const qc = useQueryClient();
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

  useEffect(() => {
    savePersisted(emailId, {
      v: 1,
      messages: messages.filter((m) => !m.pending),
      proposals,
      sources,
      totalCostCents,
      useResearch,
    });
  }, [emailId, messages, proposals, sources, totalCostCents, useResearch]);

  const latestRef = useRef({ currentBodyHtml, current });
  useEffect(() => { latestRef.current = { currentBodyHtml, current }; }, [currentBodyHtml, current]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length, proposals.length, open]);

  const chat = useMutation({
    mutationFn: async (args: { historyForApi: AIChatMessage[]; attachments?: AIAttachment[] }) => {
      const { currentBodyHtml: html } = latestRef.current;
      const r = await aiEmailChat(args.historyForApi, html, {
        researchMode: useResearch ? "always" : "auto",
        attachments: args.attachments && args.attachments.length ? args.attachments : undefined,
        sourcePostId: sourcePostId ?? null,
      });
      return { r };
    },
    onSuccess: ({ r }) => {
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

      const cur = latestRef.current.current;
      const curHtml = latestRef.current.currentBodyHtml;
      const patch: EmailFormPatch = {};
      if (r.subject !== null && r.subject !== undefined && r.subject !== cur.subject) patch.subject = r.subject;
      if (r.preheader !== null && r.preheader !== undefined && r.preheader !== cur.preheader) patch.preheader = r.preheader;
      if (r.body_html && r.body_html !== curHtml) patch.body_html = r.body_html;
      if (r.from_name !== null && r.from_name !== undefined && r.from_name !== cur.from_name) patch.from_name = r.from_name;
      if (r.from_email !== null && r.from_email !== undefined && r.from_email !== cur.from_email) patch.from_email = r.from_email;
      if (r.audience !== null && r.audience !== undefined && r.audience !== cur.audience) patch.audience = r.audience;

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
            beforeSubject: cur.subject,
            afterSubject: patch.subject ?? cur.subject,
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
    setAttachments([]);
    chat.mutate({ historyForApi, attachments: sentAttachments });
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
    if (!window.confirm("Clear this conversation? The email itself isn't affected.")) return;
    setMessages([]);
    setProposals([]);
    setSources([]);
    setTotalCostCents(0);
    setAttachments([]);
    clearPersisted(emailId);
  }

  function enableResearchAndRetry() {
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && !m.pending);
    if (!lastUser) { setUseResearch(true); return; }
    setUseResearch(true);
    const lastUserIdx = messages.lastIndexOf(lastUser);
    setMessages(messages.slice(0, lastUserIdx));
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
            className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg ring-1 ring-black/10 hover:shadow-xl"
            aria-label="Improve with Ally"
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Improve with Ally</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-black/10"
            style={{ width: "min(440px, calc(100vw - 24px))", height: "min(640px, calc(100vh - 100px))" }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="flex-1 leading-tight">
                <div className="text-sm font-medium">Improve with Ally</div>
                <div className="text-[11px] text-muted-foreground">
                  {contextLabel ?? "Suggestions apply to this email"}
                  <span className={`ml-1 inline-flex items-center gap-0.5 ${useResearch ? "text-primary" : "text-muted-foreground"}`}>
                    · <Globe className="ml-0.5 h-2.5 w-2.5" /> {useResearch ? "research always-on" : "research: auto"}
                  </span>
                </div>
              </div>
              {totalCostCents > 0 && (
                <span className="hidden text-[10px] text-muted-foreground sm:inline">
                  ${(totalCostCents / 100).toFixed(3)}
                </span>
              )}
              {/* Memory popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Ally's memory"
                    title={memories.length ? `Ally remembers ${memories.length} note${memories.length === 1 ? "" : "s"}` : "Ally's memory"}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    {memories.length > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
                        {memories.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-2">
                  <div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
                    Ally remembers ({memories.length})
                  </div>
                  {memories.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      Tell Ally to remember something — it'll show up here.
                    </div>
                  ) : (
                    <ul className="max-h-72 space-y-1 overflow-y-auto">
                      {memories.map((m) => (
                        <li key={m.id} className="group flex items-start gap-2 rounded-md p-2 hover:bg-muted">
                          <span className="flex-1 text-xs leading-snug">{m.content}</span>
                          <button
                            type="button"
                            onClick={() => delMemory.mutate(m.id)}
                            disabled={delMemory.isPending}
                            className="invisible rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:visible"
                            aria-label="Forget this"
                          >
                            <Trash2 className="h-3 w-3" />
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
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Reset conversation"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Thread */}
            <div ref={scrollerRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
              {empty && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Ask Ally to tweak this email. I'll propose changes; you Apply what you like.
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className="space-y-1">
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={
                      m.role === "user"
                        ? `ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground ${m.queued ? "opacity-70 ring-1 ring-primary-foreground/30" : ""}`
                        : `max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3 py-1.5 text-xs ${m.pending ? "italic text-muted-foreground" : ""}`
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      {m.role === "assistant" && m.pending ? (
                        <AllyThinking active research={useResearch} size="sm" />
                      ) : (
                        <span>{m.content}</span>
                      )}
                      {m.queued && (
                        <span className="ml-1 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
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
                      className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary transition hover:bg-primary/10 disabled:opacity-50"
                    >
                      <Globe className="h-3 w-3" /> Search the web &amp; retry
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
                  className={`rounded-xl border p-2.5 text-xs ${
                    card.applied
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-primary/30 bg-primary/5"
                  }`}
                >
                  <div className={`mb-2 flex items-center gap-1.5 font-medium ${card.applied ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                    {card.applied ? (
                      <><Check className="h-3.5 w-3.5" /> Applied — {card.changedSummary}. Review above.</>
                    ) : (
                      <><Wand2 className="h-3.5 w-3.5 text-primary" /> Proposed changes — {card.changedSummary}</>
                    )}
                  </div>
                  {card.changesNarrative && (
                    <ul className="mb-2 space-y-0.5 text-[11px] leading-snug text-foreground/80">
                      {card.changesNarrative
                        .split("\n")
                        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
                        .filter(Boolean)
                        .slice(0, 8)
                        .map((bullet, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="text-muted-foreground">•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  {!card.applied && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => applyProposal(card)}>
                        Apply
                      </Button>
                      {(card.patch.body_html !== undefined || card.patch.subject !== undefined) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setDiffCard(card)}
                        >
                          <Eye className="mr-1 h-3 w-3" /> See the diff
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => dismissProposal(card)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </motion.div>
              ))}

              {sources.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                  <div className="mb-1 flex items-center gap-1 font-medium text-muted-foreground">
                    <Globe className="h-3 w-3" /> Sources · {sources.length}
                  </div>
                  <ol className="space-y-0.5">
                    {sources.slice(0, 5).map((s, i) => (
                      <li key={s.url} className="flex items-start gap-1">
                        <span className="text-muted-foreground">[{i + 1}]</span>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="line-clamp-1 text-primary underline-offset-2 hover:underline"
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
            <div className="border-t bg-background/95 px-3 py-2 backdrop-blur">
              {attachments.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px]">
                      {a.kind === "pdf" ? <FileText className="h-2.5 w-2.5" /> : a.kind === "image" ? <ImageIcon className="h-2.5 w-2.5" /> : <FileText className="h-2.5 w-2.5" />}
                      <span className="max-w-[120px] truncate">{a.filename}</span>
                      <span className="text-muted-foreground">{formatBytes(a.kind === "text" ? a.data.length : (a.data.length * 3) / 4)}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                        className="rounded p-0.5 hover:bg-background"
                        aria-label="Remove attachment"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5 rounded-2xl border bg-background px-2 py-1.5 shadow-sm transition focus-within:border-primary/40">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 shrink-0 rounded-full p-0">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 p-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={attachments.length >= MAX_ATTACHMENTS}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    >
                      <Paperclip className="h-4 w-4" />
                      <div className="flex-1">
                        <div>Attach file</div>
                        <div className="text-xs text-muted-foreground">
                          PDF, image, CSV, .txt · up to {MAX_ATTACHMENTS} · 3 MB each
                        </div>
                      </div>
                    </button>
                    <div className="my-1 border-t" />
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={useResearch}
                        onChange={(e) => setUseResearch(e.target.checked)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5" /> Always research
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Off: Ally auto-detects. On: Gemini grounding every turn.
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
                  placeholder={chat.isPending ? "Type to queue a follow-up…" : "Ask Ally to tweak this email…"}
                  minRows={1}
                  maxHeight={110}
                  small
                />
                <Button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() && attachments.length === 0}
                  className="h-7 w-7 shrink-0 rounded-full p-0"
                  title={chat.isPending ? "Queue for next" : "Send"}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">
                Enter to send · changes are advisory — click Save above to persist.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diff modal */}
      <Dialog open={!!diffCard} onOpenChange={(v) => { if (!v) setDiffCard(null); }}>
        <DialogContent className="max-w-6xl gap-0 p-0">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" /> See the change
              {diffCard && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {diffCard.changedSummary}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {diffCard && (
            <div className="flex flex-col">
              {diffCard.changesNarrative && (
                <div className="border-b bg-muted/30 px-5 py-3">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">What Ally changed</div>
                  <ul className="space-y-0.5 text-sm leading-snug">
                    {diffCard.changesNarrative
                      .split("\n")
                      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
                      .filter(Boolean)
                      .map((bullet, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-muted-foreground">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {diffCard.beforeSubject !== diffCard.afterSubject && (
                <div className="grid grid-cols-2 gap-0 border-b text-sm">
                  <div className="border-r px-5 py-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Subject — current</div>
                    <div className="rounded bg-rose-50 px-2 py-1 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
                      {diffCard.beforeSubject || <em className="text-muted-foreground">(empty)</em>}
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Subject — proposed</div>
                    <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                      {diffCard.afterSubject}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-0" style={{ height: "65vh" }}>
                <div className="flex min-h-0 flex-col border-r">
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Current draft
                  </div>
                  <HtmlPreview
                    html={diffCard.beforeBodyHtml || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>(empty)</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                </div>
                <div className="flex min-h-0 flex-col">
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Proposed
                  </div>
                  <HtmlPreview
                    html={diffCard.afterBodyHtml || "<p style='color:#9ca3af;font-family:system-ui;padding:24px'>(empty)</p>"}
                    style={{ width: "100%", height: "100%", flex: 1, border: "none", display: "block" }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                <Button variant="ghost" onClick={() => setDiffCard(null)}>Close</Button>
                {!diffCard.applied && (
                  <Button onClick={() => { applyProposal(diffCard); setDiffCard(null); }}>
                    Apply this change
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
