import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

/**
 * Status phases that rotate as a chat request stays in flight. We don't have
 * true server-sent progress yet — these timings are a best-guess narration so
 * the user knows something is actually happening, not a stuck spinner.
 *
 * Pure-research-on path takes meaningfully longer because Gemini grounding
 * has to do a search round-trip before Claude even starts drafting, so the
 * phases differ.
 */
export function getAllyStatus(elapsedMs: number, research: boolean): string {
  if (elapsedMs < 1200) return "Reading your message…";
  if (research) {
    if (elapsedMs < 4500) return "Searching the web for current numbers…";
    if (elapsedMs < 8500) return "Reading the top sources…";
    if (elapsedMs < 14000) return "Stitching the facts into a draft…";
    return "Polishing the draft…";
  }
  if (elapsedMs < 3500) return "Putting together a draft…";
  if (elapsedMs < 7500) return "Refining the structure…";
  if (elapsedMs < 12000) return "Tightening the body copy…";
  return "Almost there — polishing…";
}

/**
 * useAllyStatus — returns a string that rotates through phases while
 * `active` is true. Resets when active flips to true.
 */
export function useAllyStatus(active: boolean, research: boolean): string {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 400);
    return () => clearInterval(id);
  }, [active]);
  return getAllyStatus(elapsed, research);
}

/**
 * AllyPulse — a small pulsing sparkle, used inline in pending message
 * bubbles. Confirms motion is happening even if the status text hasn't
 * advanced to its next phase yet.
 */
export function AllyPulse({ size = 12 }: { size?: number }) {
  return (
    <span className="relative inline-flex items-center justify-center" aria-hidden>
      <span
        className="absolute inset-0 animate-ping rounded-full bg-primary/30"
        style={{ width: size, height: size, left: 0, top: 0 }}
      />
      <Sparkles className="relative text-primary" style={{ width: size, height: size }} />
    </span>
  );
}

/**
 * AutoGrowTextarea — chat composer input that grows to fit its content up to
 * a max pixel height, then scrolls internally. Overrides shadcn Textarea's
 * baseline min-h-[96px] (too tall for an inline pill composer) and avoids
 * the failure mode where typing more than two lines pushed the message
 * thread off-screen because the textarea kept expanding upward.
 *
 * Enter sends, Shift+Enter inserts a newline.
 */
export function AutoGrowTextarea({
  value, onChange, onSend, placeholder, disabled,
  minRows = 1, maxHeight = 140, small = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  maxHeight?: number;
  small?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // useLayoutEffect to avoid a visible flash between content change + resize.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      }}
      placeholder={placeholder}
      rows={minRows}
      disabled={disabled}
      // Inline outline/box-shadow none — Chrome's :focus-visible outline beats
      // Tailwind's `outline-none` (which renders a transparent ring for a11y).
      // The outer pill already shows a primary border on focus-within, so
      // the textarea itself shouldn't draw any focus chrome.
      style={{
        minHeight: 0, maxHeight, overflowY: "hidden", resize: "none",
        outline: "none", boxShadow: "none", border: "none",
      }}
      className={[
        "w-full bg-transparent placeholder:text-muted-foreground/60",
        "focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0",
        small ? "px-1 py-1 text-xs" : "px-1 py-1.5 text-sm",
        "disabled:cursor-not-allowed disabled:opacity-50",
      ].join(" ")}
    />
  );
}

/**
 * AllySkeleton — shimmer skeleton lines for use as a "ghost" preview while
 * Ally is generating the actual content. Mirrors a typical post body shape:
 * a heading, three text rows, a heading, two text rows.
 */
export function AllySkeleton({ className }: { className?: string }) {
  return (
    <div className={["space-y-4 p-6 animate-pulse", className].filter(Boolean).join(" ")}>
      <div className="h-6 w-2/3 rounded bg-muted-foreground/15" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-muted-foreground/15" />
        <div className="h-3 w-[97%] rounded bg-muted-foreground/15" />
        <div className="h-3 w-[88%] rounded bg-muted-foreground/15" />
        <div className="h-3 w-[92%] rounded bg-muted-foreground/15" />
        <div className="h-3 w-[78%] rounded bg-muted-foreground/15" />
      </div>
      <div className="h-5 w-1/3 rounded bg-muted-foreground/15" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-muted-foreground/15" />
        <div className="h-3 w-[95%] rounded bg-muted-foreground/15" />
        <div className="h-3 w-[60%] rounded bg-muted-foreground/15" />
      </div>
      <div className="h-5 w-2/5 rounded bg-muted-foreground/15" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-muted-foreground/15" />
        <div className="h-3 w-[82%] rounded bg-muted-foreground/15" />
      </div>
    </div>
  );
}

/**
 * AllyShimmerOverlay — semi-transparent shimmer that sits over existing
 * content while it's being regenerated, so the user sees activity without
 * losing the previous draft underneath.
 */
export function AllyShimmerOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-background/30 backdrop-blur-[1.5px]">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
      <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-primary/40 bg-background/95 px-3 py-1 text-[11px] font-medium text-primary shadow-sm">
        <span className="inline-flex items-center gap-1.5">
          <AllyPulse size={11} />
          Ally is updating this draft…
        </span>
      </div>
    </div>
  );
}
