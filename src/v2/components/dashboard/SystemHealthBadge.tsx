import type { SystemHealthStatus } from "@/lib/types";

const STATUS_LABEL: Record<SystemHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
};

const STATUS_COLOR: Record<SystemHealthStatus, { bg: string; fg: string }> = {
  healthy: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  degraded: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  critical: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
};

export function SystemHealthBadge({ status }: { status: SystemHealthStatus }) {
  const { bg, fg } = STATUS_COLOR[status];
  return (
    <span
      className="le-mono inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
      style={{ background: bg, color: fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: fg }} />
      {STATUS_LABEL[status]}
    </span>
  );
}
