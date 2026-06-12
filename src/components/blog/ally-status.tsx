import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Eye, Globe, BookOpenText, PenLine, ScrollText, Sparkles,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Status phases — what Ally is doing right now.
// Each phase carries a Lucide icon + a list of label variants. Within a phase
// the visible label rotates every ~2.5s so a long turn doesn't read as stuck.
// `until` is the elapsed-time upper bound for the phase (ms). Last phase uses
// Infinity.
// ---------------------------------------------------------------------------

interface Phase {
  icon: LucideIcon;
  labels: string[];
  until: number;
}

const PHASES_NO_RESEARCH: Phase[] = [
  {
    icon: Eye,
    labels: [
      "Reading your message…",
      "Parsing what you asked…",
      "Looking at your request…",
    ],
    until: 1500,
  },
  {
    icon: PenLine,
    labels: [
      "Sketching the structure…",
      "Drafting the outline…",
      "Putting together a draft…",
      "Mapping out the sections…",
    ],
    until: 4500,
  },
  {
    icon: ScrollText,
    labels: [
      "Writing the body copy…",
      "Filling in the details…",
      "Composing the sections…",
      "Hammering out the prose…",
      "Working through the post…",
    ],
    until: 9000,
  },
  {
    icon: PenLine,
    labels: [
      "Refining the structure…",
      "Tightening the prose…",
      "Editing for clarity…",
      "Trimming the fluff…",
      "Polishing the headings…",
    ],
    until: 14000,
  },
  {
    icon: Sparkles,
    labels: [
      "Final polish on details…",
      "Almost there — last touches…",
      "Wrapping up…",
      "Tidying the markup…",
    ],
    until: Number.POSITIVE_INFINITY,
  },
];

const PHASES_RESEARCH: Phase[] = [
  {
    icon: Eye,
    labels: [
      "Reading your message…",
      "Parsing what you asked…",
    ],
    until: 1200,
  },
  {
    icon: Globe,
    labels: [
      "Searching Google for current numbers…",
      "Hunting down fresh sources…",
      "Querying the web for recent data…",
      "Pulling from Stellar MLS / NAR / Redfin…",
    ],
    until: 5000,
  },
  {
    icon: BookOpenText,
    labels: [
      "Reading the top results…",
      "Skimming the strongest sources…",
      "Pulling key facts from results…",
      "Cross-checking the numbers…",
    ],
    until: 9000,
  },
  {
    icon: PenLine,
    labels: [
      "Stitching facts into a draft…",
      "Weaving the sources into prose…",
      "Connecting dots from research…",
      "Writing with citations inline…",
    ],
    until: 14000,
  },
  {
    icon: Sparkles,
    labels: [
      "Final polish with citations…",
      "Tidying the sources list…",
      "Wrapping up the post…",
      "Almost there — last touches…",
    ],
    until: Number.POSITIVE_INFINITY,
  },
];

function pickPhase(elapsedMs: number, research: boolean): Phase {
  const table = research ? PHASES_RESEARCH : PHASES_NO_RESEARCH;
  for (const p of table) if (elapsedMs < p.until) return p;
  return table[table.length - 1];
}

// ---------------------------------------------------------------------------
// useAllyStatus — drives the active phase + the rotating label index.
// Returns the current label string and the phase icon component, kept in
// sync via a single 400ms tick. Resets when `active` flips to true.
// ---------------------------------------------------------------------------

export function useAllyStatus(active: boolean, research: boolean): { label: string; Icon: LucideIcon } {
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

  const phase = pickPhase(elapsed, research);
  // Within a phase, rotate the label every ~2.5s.
  const idx = Math.floor(elapsed / 2500) % phase.labels.length;
  return { label: phase.labels[idx], Icon: phase.icon };
}

// ---------------------------------------------------------------------------
// AllyThinking — drop-in indicator for in-flight assistant bubbles.
// Renders the phase icon (gently scaling) + a left-to-right scanner bar +
// the current status text. Phase icon swaps with a crossfade as Ally moves
// through stages (Reading → Searching → Drafting → Polishing).
// ---------------------------------------------------------------------------

export function AllyThinking({
  active,
  research,
  size = "sm",
}: {
  active: boolean;
  research: boolean;
  size?: "sm" | "md";
}) {
  const { label, Icon } = useAllyStatus(active, research);
  const iconPx = size === "md" ? 14 : 12;
  return (
    <span className="inline-flex items-center gap-2 leading-tight">
      <motion.span
        key={Icon.displayName /* crossfade when icon changes */}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: [1, 1.12, 1] }}
        transition={{
          opacity: { duration: 0.25 },
          scale: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
        }}
        className="inline-flex shrink-0 items-center justify-center text-primary"
      >
        <Icon style={{ width: iconPx, height: iconPx }} />
      </motion.span>
      <span
        className={[
          "relative inline-block overflow-hidden rounded-full bg-muted",
          size === "md" ? "h-[3px] w-16" : "h-[2px] w-12",
        ].join(" ")}
        aria-hidden
      >
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: "40%" }}
          animate={{ x: ["-100%", "250%"] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
      <span>{label}</span>
    </span>
  );
}

// Back-compat: AllyPulse used to render just the pinging sparkle. Callers
// that still import it keep working — it now mirrors the phase icon look
// without the surrounding bar/label. Prefer <AllyThinking> for new code.
export function AllyPulse({ size = 12 }: { size?: number }) {
  return (
    <motion.span
      initial={{ scale: 0.85 }}
      animate={{ scale: [1, 1.12, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      className="inline-flex shrink-0 items-center justify-center text-primary"
    >
      <Sparkles style={{ width: size, height: size }} />
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// AutoGrowTextarea — chat composer input that grows to fit its content up to
// a max pixel height, then scrolls internally.
// ---------------------------------------------------------------------------

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
      style={{
        minHeight: 0, maxHeight, overflowY: "hidden", resize: "none",
        outline: "none", boxShadow: "none", border: "none",
      }}
      className={[
        "ally-composer-input w-full bg-transparent placeholder:text-muted-foreground/60",
        small ? "px-1 py-1 text-xs" : "px-1 py-1.5 text-sm",
        "disabled:cursor-not-allowed disabled:opacity-50",
      ].join(" ")}
    />
  );
}

// ---------------------------------------------------------------------------
// AllySkeleton — shimmer skeleton lines for the empty-preview state.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AllyShimmerOverlay — non-flickering overlay shown over the existing preview
// while Ally is regenerating. Uses a static translucent backdrop + an inline
// "updating" pill (no opacity oscillation on the dim layer, which caused the
// previous version to read as glitchy).
// ---------------------------------------------------------------------------

export function AllyShimmerOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {/* Subtle, NON-oscillating dim — just a stable backdrop. */}
      <div className="absolute inset-0 bg-background/25 backdrop-blur-[1px]" />
      {/* Top-edge progress bar — the actual "in-progress" signal. */}
      <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-muted/40">
        <motion.div
          className="h-full bg-primary"
          style={{ width: "30%" }}
          animate={{ x: ["-100%", "350%"] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-primary/40 bg-background/95 px-3 py-1 text-[11px] font-medium text-primary shadow-sm">
        <AllyPulse size={11} />
        <span className="ml-1.5">Ally is updating this draft…</span>
      </div>
    </div>
  );
}
