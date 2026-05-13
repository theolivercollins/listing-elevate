import type { ReactNode } from "react";

export interface ChipTabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function ChipTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: ChipTabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      className="inline-flex gap-1 rounded-[10px] border p-1"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)" }}
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-xs font-medium transition-colors"
            style={{
              background: active ? "var(--le-accent)" : "transparent",
              color: active ? "var(--le-accent-fg)" : "var(--le-text-muted)",
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
