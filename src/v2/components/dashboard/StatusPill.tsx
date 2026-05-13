import type { ReactNode } from "react";

type Tone = "success" | "warn" | "danger" | "info" | "muted";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  warn: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  danger: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
  info: { bg: "var(--le-info-soft)", fg: "var(--le-info)" },
  muted: { bg: "var(--le-bg-sunken)", fg: "var(--le-text-muted)" },
};

const STATUS_TO_TONE: Record<string, Tone> = {
  complete: "success",
  ready: "success",
  paid: "success",
  active: "success",
  live: "success",
  draft: "muted",
  pending: "warn",
  needs_review: "warn",
  processing: "info",
  rendering: "info",
  generating: "info",
  analyzing: "info",
  failed: "danger",
  error: "danger",
  quarantined: "danger",
  archived: "muted",
};

export function StatusPill({
  status,
  tone,
  children,
}: {
  status?: string; // auto-maps via STATUS_TO_TONE if tone not given
  tone?: Tone;
  children?: ReactNode;
}) {
  const resolvedTone = tone ?? (status ? STATUS_TO_TONE[status] ?? "muted" : "muted");
  const { bg, fg } = TONE[resolvedTone];
  const label = children ?? (status ? status.replace(/_/g, " ") : "");
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: bg, color: fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: fg }} />
      {label}
    </span>
  );
}
