import type { OverviewPeriod } from "@/lib/types";

const OPTIONS: Array<{ value: OverviewPeriod; label: string }> = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
];

export function PeriodSelector({
  value,
  onChange,
}: {
  value: OverviewPeriod;
  onChange: (v: OverviewPeriod) => void;
}) {
  return (
    <div
      className="inline-flex rounded-[10px] border p-1"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)" }}
      role="group"
      aria-label="Time period"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className="le-mono rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors"
            style={{
              background: active ? "var(--le-accent)" : "transparent",
              color: active ? "var(--le-accent-fg)" : "var(--le-text-muted)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
