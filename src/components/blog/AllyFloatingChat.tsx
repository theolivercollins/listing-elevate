import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp, Check, Globe, Loader2, MessageSquare, Plus, Sparkles, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import { aiChat, type AIChatMessage, type AIResearchSource } from "@/lib/blog/api-client";
import { useAllyStatus, AllyPulse } from "./ally-status";

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
  /** Human-readable summary like "title, body, meta description". */
  changedSummary: string;
  applied: boolean;
}

interface Props {
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

export function AllyFloatingChat({ currentBodyHtml, current, onApply, contextLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<(AIChatMessage & { pending?: boolean; suggestResearch?: boolean })[]>([]);
  const [proposals, setProposals] = useState<ProposalCard[]>([]);
  const [input, setInput] = useState("");
  const [useResearch, setUseResearch] = useState(false);
  const [sources, setSources] = useState<AIResearchSource[]>([]);
  const [totalCostCents, setTotalCostCents] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

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
    mutationFn: async (args: { historyForApi: AIChatMessage[] }) => {
      const { currentBodyHtml: html } = latestRef.current;
      const r = await aiChat(args.historyForApi, html, {
        templateId: null,
        includeRecentPosts: true,
        research: useResearch,
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
    const userMsg: AIChatMessage = { role: "user", content: t };
    // Pending message starts blank — `useAllyStatus` drives the live text.
    const placeholder = { role: "assistant" as const, content: "", pending: true };
    const historyForApi: AIChatMessage[] = [
      ...messages.filter((m) => !m.pending).map(({ role, content }) => ({ role, content })),
      userMsg,
    ];
    setMessages((prev) => [...prev.filter((m) => !m.pending), userMsg, placeholder]);
    chat.mutate({ historyForApi });
  }

  const liveStatus = useAllyStatus(chat.isPending, useResearch);

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
            className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg ring-1 ring-black/10 hover:shadow-xl"
            aria-label="Improve with Ally"
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Improve with Ally</span>
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
            className="fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-black/10"
            style={{ width: "min(440px, calc(100vw - 24px))", height: "min(640px, calc(100vh - 100px))" }}
          >
            <div className="flex items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="flex-1 leading-tight">
                <div className="text-sm font-medium">Improve with Ally</div>
                <div className="text-[11px] text-muted-foreground">
                  {contextLabel ?? "Suggestions apply to this post"}
                  {useResearch && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                      · <Globe className="ml-0.5 h-2.5 w-2.5" /> research
                    </span>
                  )}
                </div>
              </div>
              {totalCostCents > 0 && (
                <span className="hidden text-[10px] text-muted-foreground sm:inline">
                  ${(totalCostCents / 100).toFixed(3)}
                </span>
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

            <div ref={scrollerRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
              {empty && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Ask Ally to tweak this post. I'll propose changes; you Apply what you like.
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
                        ? "ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                        : `max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-3 py-1.5 text-xs ${m.pending ? "italic text-muted-foreground" : ""}`
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      {m.role === "assistant" && m.pending && <AllyPulse size={11} />}
                      <span>{m.pending ? liveStatus : m.content}</span>
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
                  className={`rounded-xl border p-2.5 text-xs ${card.applied ? "border-emerald-300 bg-emerald-50" : "border-primary/30 bg-primary/5"}`}
                >
                  <div className="mb-2 flex items-center gap-1.5 font-medium">
                    {card.applied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        Applied: {card.changedSummary}
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-3.5 w-3.5 text-primary" />
                        Proposed changes — {card.changedSummary}
                      </>
                    )}
                  </div>
                  {!card.applied && (
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => applyProposal(card)}>
                        Apply
                      </Button>
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
              <div className="flex items-end gap-1.5 rounded-2xl border bg-background px-2 py-1.5 shadow-sm transition focus-within:border-primary/40">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 shrink-0 rounded-full p-0">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-2">
                    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={useResearch}
                        onChange={(e) => setUseResearch(e.target.checked)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5" /> Research with Gemini
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Pull current facts + sources from the web before drafting.
                        </div>
                      </div>
                    </label>
                  </PopoverContent>
                </Popover>

                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Ask Ally to tweak this post…"
                  rows={1}
                  className="min-h-0 resize-none border-0 bg-transparent px-1 py-1 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  style={{ maxHeight: 120 }}
                  disabled={chat.isPending}
                />

                <Button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() || chat.isPending}
                  className="h-7 w-7 shrink-0 rounded-full p-0"
                >
                  {chat.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">
                Enter to send · changes are advisory — click Save above to persist.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
