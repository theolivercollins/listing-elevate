import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
  dashed = true,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-[14px] ${dashed ? "border border-dashed" : "border"} px-6 py-12 text-center`}
      style={{
        borderColor: "var(--le-border)",
        background: "var(--le-bg-elev)",
      }}
    >
      {icon && <div style={{ color: "var(--le-text-muted)" }}>{icon}</div>}
      <div className="text-sm font-medium" style={{ color: "var(--le-text)" }}>{title}</div>
      {body && (
        <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>
          {body}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
