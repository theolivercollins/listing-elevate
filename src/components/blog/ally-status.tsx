import { useEffect, useState } from "react";
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
