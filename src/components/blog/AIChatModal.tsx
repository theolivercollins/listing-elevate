import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { aiChat, type AIChatMessage } from "@/lib/blog/api-client";
import { HtmlPreview } from "./HtmlPreview";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Current body_html so the chat starts from whatever's already in the editor. */
  initialHtml: string;
  /** Called with the latest proposed HTML when user clicks "Use this draft". */
  onApply: (html: string) => void;
}

const STARTER_PROMPTS = [
  "Punta Gorda May 2026 market update — inventory up 4%, median $385K, DOM 28",
  "5 reasons to list this fall in Charlotte County",
  "Just-Listed neighborhood spotlight: Burnt Store Isles",
];

export function AIChatModal({ open, onClose, initialHtml, onApply }: Props) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [draft, setDraft] = useState<string>(initialHtml ?? "");
  const [input, setInput] = useState("");
  const [totalCostCents, setTotalCostCents] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      // Reset on open. If the editor already has content, carry it as the starting draft.
      setMessages([]);
      setDraft(initialHtml ?? "");
      setInput("");
      setTotalCostCents(0);
    }
  }, [open, initialHtml]);

  useEffect(() => {
    // Autoscroll the thread on new turn.
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length]);

  const chat = useMutation({
    mutationFn: async (nextUser: string) => {
      const nextMessages: AIChatMessage[] = [
        ...messages,
        { role: "user", content: nextUser },
      ];
      const r = await aiChat(nextMessages, draft);
      return { nextMessages, r };
    },
    onSuccess: ({ nextMessages, r }) => {
      setMessages([...nextMessages, { role: "assistant", content: r.reply }]);
      if (r.body_html) setDraft(r.body_html);
      setTotalCostCents((c) => c + r.cost_cents);
    },
    onError: (e: any) => toast.error(`Chat failed: ${e?.message ?? e}`),
  });

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    chat.mutate(t);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function applyAndClose() {
    if (!draft.trim()) {
      toast.error("Draft is empty — chat a bit first.");
      return;
    }
    onApply(draft);
    onClose();
    toast.success("Draft applied to editor");
  }

  const isEmpty = messages.length === 0 && !chat.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-6xl p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" /> Chat with AI to build this post
            {totalCostCents > 0 && (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                ${(totalCostCents / 100).toFixed(3)} this session
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2" style={{ height: "70vh" }}>
          {/* LEFT: chat thread */}
          <div className="flex flex-col border-r">
            <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {isEmpty && (
                <div className="space-y-3 text-sm">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Sparkles className="h-3 w-3" /> Start with a prompt
                    </div>
                    <div className="space-y-1">
                      {STARTER_PROMPTS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => send(p)}
                          className="block w-full rounded border bg-background px-3 py-2 text-left text-xs hover:bg-muted"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tell me what the post is about, paste raw stats, or ask me to rewrite a section. I'll keep updating the draft on the right.
                  </p>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm"
                  }
                >
                  {m.content}
                </div>
              ))}

              {chat.isPending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Claude is thinking…
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="border-t p-3">
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Tell me what to write, paste numbers, ask for tweaks…"
                  rows={2}
                  className="resize-none"
                  disabled={chat.isPending}
                />
                <Button type="submit" disabled={!input.trim() || chat.isPending} className="self-end">
                  {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send</div>
            </form>
          </div>

          {/* RIGHT: live preview */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2 text-xs">
              <span className="font-medium">Live preview</span>
              <Button
                type="button"
                size="sm"
                onClick={applyAndClose}
                disabled={!draft.trim() || chat.isPending}
              >
                Use this draft
              </Button>
            </div>
            <div className="flex-1 overflow-hidden bg-white">
              {draft.trim() ? (
                <HtmlPreview html={draft} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  The proposed draft will appear here once you send a message.
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
