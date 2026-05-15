import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp, FileText, Image as ImageIcon, LayoutTemplate, Loader2, MessageSquare,
  Paperclip, Plus, Sparkles, Wand2, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiChat, listTemplates, type AIChatMessage,
} from "@/lib/blog/api-client";
import type { AIAttachment } from "@/lib/blog/types";
import { HtmlPreview } from "./HtmlPreview";

interface Props {
  open: boolean;
  onClose: () => void;
  initialHtml: string;
  onApply: (html: string) => void;
}

const STARTERS = [
  "Punta Gorda May market update — inventory up 4%, median $385K, DOM 28",
  "5 reasons to list this fall in Charlotte County",
  "Neighborhood spotlight: Burnt Store Isles",
  "How rising rates affect Punta Gorda buyers right now",
];

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 3_500_000;

function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AIChatModal({ open, onClose, initialHtml, onApply }: Props) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [draft, setDraft] = useState<string>(initialHtml ?? "");
  const [input, setInput] = useState("");
  const [totalCostCents, setTotalCostCents] = useState(0);
  const [templateId, setTemplateId] = useState<string>("");
  const [includeRecentPosts, setIncludeRecentPosts] = useState(true);
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tplData } = useQuery({
    queryKey: ["blog-templates"], queryFn: () => listTemplates(), enabled: open,
  });
  const templates = tplData?.templates ?? [];
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  useEffect(() => {
    if (open) {
      setMessages([]);
      setDraft(initialHtml ?? "");
      setInput("");
      setTotalCostCents(0);
      setAttachments([]);
      setPreviewOpen(!!initialHtml);
    }
  }, [open, initialHtml]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages.length]);

  const chat = useMutation({
    mutationFn: async (nextUser: string) => {
      const nextMessages: AIChatMessage[] = [
        ...messages,
        { role: "user", content: nextUser },
      ];
      const r = await aiChat(nextMessages, draft, {
        templateId: templateId || null,
        includeRecentPosts,
        attachments: attachments.length ? attachments : undefined,
      });
      return { nextMessages, r };
    },
    onSuccess: ({ nextMessages, r }) => {
      setMessages([...nextMessages, { role: "assistant", content: r.reply }]);
      if (r.body_html) {
        setDraft(r.body_html);
        setPreviewOpen(true);
      }
      setTotalCostCents((c) => c + r.cost_cents);
      // Attachments are one-shot — consumed once they've been sent.
      setAttachments([]);
    },
    onError: (e: any) => toast.error(`Chat failed: ${e?.message ?? e}`),
  });

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setInput("");
    chat.mutate(t);
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
      if (!isPdf && !isImage && !isText) { toast.error(`${file.name}: unsupported type`); continue; }
      if (isText) {
        const text = await file.text();
        if (text.length > 100_000) { toast.error(`${file.name}: text > 100KB`); continue; }
        setAttachments((prev) => [...prev, { kind: "text", filename: file.name, data: text }]);
      } else {
        const buf = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buf.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
        }
        const b64 = btoa(binary);
        setAttachments((prev) => [...prev, {
          kind: isPdf ? "pdf" : "image",
          filename: file.name,
          data: b64,
          media_type: isPdf ? "application/pdf" : (file.type || "image/jpeg"),
        }]);
      }
    }
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

  const hasThread = messages.length > 0 || chat.isPending;
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !chat.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-5xl gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl"
        style={{ height: "min(85vh, 820px)" }}
      >
        <DialogHeader className="border-b bg-background/95 px-5 py-3 backdrop-blur">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" /> Chat with AI
            <span className="ml-3 hidden text-xs font-normal text-muted-foreground sm:inline">
              {selectedTemplate ? (
                <>using template <span className="font-medium">{selectedTemplate.name}</span></>
              ) : includeRecentPosts ? (
                <>style-matched to recent posts</>
              ) : (
                <>free-form</>
              )}
            </span>
            {totalCostCents > 0 && (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                ${(totalCostCents / 100).toFixed(3)} this session
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[1fr_minmax(0,1fr)]">
          {/* LEFT COLUMN — chat */}
          <div className="relative flex min-h-0 flex-col bg-background">
            <AnimatePresence mode="wait">
              {!hasThread ? (
                <motion.div
                  key="hero"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="flex flex-1 flex-col items-center justify-center px-6 pt-2"
                >
                  <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight md:text-3xl">
                    Ready when you are.
                  </h2>
                  <Composer
                    big
                    input={input}
                    onInputChange={setInput}
                    onSend={() => send(input)}
                    canSend={canSend}
                    isPending={chat.isPending}
                    attachments={attachments}
                    onRemoveAttachment={(i) => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                    onFilePick={() => fileInputRef.current?.click()}
                    templates={templates}
                    templateId={templateId}
                    onTemplateChange={setTemplateId}
                    includeRecentPosts={includeRecentPosts}
                    onIncludeRecentPostsChange={setIncludeRecentPosts}
                  />
                  <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
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
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-1 flex-col min-h-0"
                >
                  <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
                    {messages.map((m, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay: 0.02 }}
                        className={
                          m.role === "user"
                            ? "ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm"
                            : "max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-muted px-3.5 py-2 text-sm"
                        }
                      >
                        {m.content}
                      </motion.div>
                    ))}
                    {chat.isPending && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" /> Claude is thinking…
                      </motion.div>
                    )}
                  </div>
                  <div className="border-t bg-background/95 px-5 pb-4 pt-3 backdrop-blur">
                    <Composer
                      input={input}
                      onInputChange={setInput}
                      onSend={() => send(input)}
                      canSend={canSend}
                      isPending={chat.isPending}
                      attachments={attachments}
                      onRemoveAttachment={(i) => setAttachments((p) => p.filter((_, idx) => idx !== i))}
                      onFilePick={() => fileInputRef.current?.click()}
                      templates={templates}
                      templateId={templateId}
                      onTemplateChange={setTemplateId}
                      includeRecentPosts={includeRecentPosts}
                      onIncludeRecentPostsChange={setIncludeRecentPosts}
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

          {/* RIGHT COLUMN — live preview */}
          <AnimatePresence mode="wait">
            {previewOpen && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="hidden border-l md:flex md:flex-col min-h-0"
              >
                <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 text-xs">
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
                      Send a message — the proposed draft shows up here.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Composer — rounded pill input + + menu + send button. Used in both the empty
// hero state (large) and the active state (pinned at the bottom).
// -----------------------------------------------------------------------------

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
}

function Composer({
  big = false,
  input, onInputChange, onSend, canSend, isPending,
  attachments, onRemoveAttachment, onFilePick,
  templates, templateId, onTemplateChange,
  includeRecentPosts, onIncludeRecentPostsChange,
}: ComposerProps) {
  return (
    <div className={`mx-auto w-full ${big ? "max-w-2xl" : ""}`}>
      {/* Attachment chips */}
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
        {/* + menu */}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 rounded-full p-0">
              <Plus className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <button
              type="button"
              onClick={onFilePick}
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
              <div className="mt-1 text-[11px] text-muted-foreground">
                AI fills this template's sections in.
              </div>
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
          </PopoverContent>
        </Popover>

        {/* Input */}
        <Textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={big ? "Ask anything — describe the post, paste numbers, attach a market report…" : "Ask for tweaks, paste numbers, attach files…"}
          rows={big ? 2 : 1}
          className="min-h-0 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          style={{ maxHeight: 200 }}
          disabled={isPending}
        />

        {/* Send */}
        <Button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="h-9 w-9 shrink-0 rounded-full p-0"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>

      <div className="mt-1.5 px-1 text-[11px] text-muted-foreground">
        Enter to send · Shift+Enter for a new line
      </div>
    </div>
  );
}
