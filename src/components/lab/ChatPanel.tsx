import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Pin, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage, ChatStreamEvent } from "@/lib/labListingsApi";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string, onEvent: (evt: ChatStreamEvent) => void) => Promise<void>;
  onClear: () => Promise<void>;
  onPinMessage?: (index: number, content: string) => Promise<void>;
  onServerChange?: () => void;
  emptyHint: string;
  placeholder: string;
  headerLabel: string;
}

function formatTime(ts: string): string {
  try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ts; }
}

export function ChatPanel({ messages: initialMessages, onSend, onClear, onPinMessage, onServerChange, emptyHint, placeholder, headerLabel }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSaves, setStreamingSaves] = useState<string[]>([]);
  const [promptRewritten, setPromptRewritten] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(initialMessages); }, [initialMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText]);

  async function send() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setStreamingText("");
    setStreamingSaves([]);
    const optimistic: ChatMessage = { role: "user", content: msg, ts: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    try {
      let changed = false;
      await onSend(msg, (evt) => {
        if (evt.type === "text") setStreamingText((p) => p + evt.delta);
        else if (evt.type === "saved_instruction") { setStreamingSaves((p) => [...p, evt.instruction]); changed = true; }
        else if (evt.type === "prompt_updated") { setPromptRewritten(evt.new_prompt); changed = true; }
        else if (evt.type === "done") {
          setMessages(evt.chat_messages);
          setStreamingText("");
          setStreamingSaves([]);
          if (changed && onServerChange) onServerChange();
        } else if (evt.type === "error") {
          setMessages((m) => [...m, { role: "assistant", content: `Error: ${evt.message}`, ts: new Date().toISOString() }]);
          setStreamingText("");
        }
      });
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}`, ts: new Date().toISOString() }]);
      setStreamingText("");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Clear all chat messages?")) return;
    await onClear();
    setMessages([]);
  }

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label text-muted-foreground">{headerLabel}</span>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={clear} title="Clear chat">
            <Eraser className="h-3 w-3" />
          </Button>
        )}
      </div>

      {promptRewritten && (
        <div className="mb-2 border border-indigo-500/40 bg-indigo-500/10 p-2 text-[11px] text-indigo-800">
          <div className="font-semibold">Director prompt rewritten</div>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[10px]">{promptRewritten}</pre>
          <button type="button" onClick={() => setPromptRewritten(null)} className="mt-1 underline-offset-2 hover:underline">dismiss</button>
        </div>
      )}
      <div ref={scrollRef} className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 && !streamingText && (
          <p className="text-[11px] italic text-muted-foreground">{emptyHint}</p>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            msg={m}
            onPin={onPinMessage && m.role === "user" && !m.pinned ? () => onPinMessage(i, m.content) : undefined}
          />
        ))}
        {streamingText && (
          <MessageBubble
            msg={{ role: "assistant", content: streamingText, ts: new Date().toISOString() }}
            savedInstructions={streamingSaves}
            streaming
          />
        )}
        {busy && !streamingText && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-background">AI</span>
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={placeholder}
          className="min-h-[44px] text-sm"
          rows={1}
        />
        <Button size="sm" onClick={send} disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onPin, savedInstructions, streaming }: {
  msg: ChatMessage;
  onPin?: () => void;
  savedInstructions?: string[];
  streaming?: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`group flex items-start gap-2 text-xs ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <span className="mt-0.5 shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-background">AI</span>
      )}
      <div className={`max-w-[85%] space-y-1 rounded px-2.5 py-2 ${isUser ? "bg-foreground text-background" : "bg-muted"}`}>
        <div className="whitespace-pre-wrap">
          {msg.content}
          {streaming && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current align-middle" />}
        </div>
        {savedInstructions && savedInstructions.map((s, i) => (
          <div key={i} className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-800">
            <Pin className="h-2.5 w-2.5 fill-current" /> Saved: “{s}”
          </div>
        ))}
        {msg.pinned && isUser && (
          <div className="inline-flex items-center gap-1 rounded bg-background/20 px-1.5 py-0.5 text-[10px]">
            <Pin className="h-2.5 w-2.5 fill-current" /> Pinned as future instruction
          </div>
        )}
        <div className="text-[9px] opacity-0 transition-opacity group-hover:opacity-60" title={msg.ts}>
          {formatTime(msg.ts)}
        </div>
      </div>
      {isUser && onPin && (
        <button
          type="button"
          onClick={onPin}
          title="Pin as instruction for future renders"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Pin className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
