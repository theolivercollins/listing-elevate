// src/components/marketing/MarketingAllyChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ArrowUp, ChevronUp, Loader2, RotateCcw, X } from "lucide-react";
import { useAllyStatus, AllyPulse, AutoGrowTextarea } from "@/components/blog/ally-status";
import { AllyAvatar } from "./AllyAvatar";
import { AllyChip } from "./AllyChip";
import { AllyCTACard } from "./AllyCTACard";
import {
  marketingAllyChat,
  type MarketingChatMessage,
  type MarketingChatResponse,
} from "@/lib/marketing/api-client";

const STARTER_CHIPS = [
  "My video is stuck",
  "Show me pricing",
  "What photos work best?",
];

interface ThreadEntry {
  id: string;
  message: MarketingChatMessage;
  /** Only set on assistant entries. */
  meta?: {
    followup_chips: string[] | null;
    cta: "get_started" | null;
    lead_capture: MarketingChatResponse["lead_capture"];
  };
}

interface MarketingAllyChatProps {
  /** Called when Ally's CTA card is clicked or the user explicitly asks to sign up. */
  onGetStarted: () => void;
}

export function MarketingAllyChat({ onGetStarted }: MarketingAllyChatProps) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadEntry[]>(() => initialThread());
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const sendMessage = async (text: string) => {
    const message = text.trim();
    if (!message || pending) return;
    const nextThread = [
      ...thread,
      { id: crypto.randomUUID(), message: { role: "user" as const, content: message } },
    ];
    setThread(nextThread);
    setDraft("");
    setPending(true);
    try {
      const resp = await marketingAllyChat(nextThread.map(t => t.message));
      setThread(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: { role: "assistant", content: resp.reply },
          meta: {
            followup_chips: resp.followup_chips,
            cta: resp.cta,
            lead_capture: resp.lead_capture,
          },
        },
      ]);
    } catch (err) {
      setThread(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: { role: "assistant", content: `Sorry - ${(err as Error).message}. Try again in a sec.` },
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  const status = useAllyStatus(pending, /* research */ false);

  // Autoscroll on new messages
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, pending]);

  const handleSubmit = () => {
    void sendMessage(draft);
  };

  const handleChip = (chip: string) => {
    void sendMessage(chip);
  };

  const handleReset = () => {
    setThread(initialThread());
    setDraft("");
  };

  // Find the latest assistant entry to pull chips/cta off
  const lastAssistant = useMemo(
    () => [...thread].reverse().find(t => t.message.role === "assistant"),
    [thread],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="fixed bottom-4 left-4 right-4 z-50 inline-flex items-center justify-center gap-2 rounded-full bg-background border border-border shadow-lg px-4 py-3 hover:shadow-xl transition-shadow sm:left-auto sm:right-6 sm:bottom-6 sm:justify-start"
          aria-label="Open chat with Ally"
        >
          <AllyAvatar size={24} />
          <span className="text-sm font-medium text-foreground">Chat with Ally</span>
          <ChevronUp size={16} className="text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={12}
        className="p-0 w-[360px] sm:w-[360px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-6rem)] rounded-2xl shadow-2xl border-border overflow-hidden flex flex-col"
      >
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-col h-full"
          >
            {/* Header */}
            <div className="flex flex-col items-center pt-4 pb-3 border-b border-border relative">
              <button
                onClick={handleReset}
                className="absolute top-3 right-9 text-muted-foreground hover:text-foreground"
                aria-label="Reset conversation"
                title="Start over"
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
                aria-label="Minimize chat"
              >
                <X size={16} />
              </button>
              <div className="relative">
                <AllyAvatar size={32} />
                {pending && <AllyPulse size={10} />}
              </div>
              <p className="text-base font-semibold text-foreground mt-2">Ally</p>
              <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {pending ? status.label : "Support and sales"}
              </p>
            </div>

            {/* Thread */}
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {thread.map(entry => (
                <Bubble key={entry.id} entry={entry} />
              ))}
              {pending && (
                <div className="self-start text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  {status.label}
                </div>
              )}
            </div>

            {/* Chips + CTA */}
            {!pending && lastAssistant?.meta && (
              <div className="px-4 pb-2 space-y-2">
                {lastAssistant.meta.followup_chips && lastAssistant.meta.followup_chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {lastAssistant.meta.followup_chips.map(chip => (
                      <AllyChip key={chip} label={chip} onClick={() => handleChip(chip)} />
                    ))}
                  </div>
                )}
                {lastAssistant.meta.cta === "get_started" && (
                  <AllyCTACard onGetStarted={onGetStarted} />
                )}
              </div>
            )}

            {/* Composer */}
            <div className="p-3 border-t border-border flex items-end gap-2">
              <div className="flex-1">
                <AutoGrowTextarea
                  value={draft}
                  onChange={setDraft}
                  onSend={handleSubmit}
                  placeholder="Ask anything…"
                  disabled={pending}
                />
              </div>
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!draft.trim() || pending}
                className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0"
                aria-label="Send"
              >
                {pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </PopoverContent>
    </Popover>
  );
}

function Bubble({ entry }: { entry: ThreadEntry }) {
  const isUser = entry.message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-accent text-accent-foreground" : "bg-muted text-foreground"
        }`}
      >
        {entry.message.content}
      </div>
    </div>
  );
}

function initialThread(): ThreadEntry[] {
  return [
    {
      id: "ally-intro",
      message: {
        role: "assistant",
        content:
          "I'm Ally. Ask me about Listing Elevate, pricing, getting started, or what to check if something is not working the way you expected.",
      },
      meta: {
        followup_chips: STARTER_CHIPS,
        cta: null,
        lead_capture: null,
      },
    },
  ];
}
