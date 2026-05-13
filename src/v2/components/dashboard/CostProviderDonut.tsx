import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { OverviewCostByProviderRow } from "@/lib/types";

const COLOR_RAMP = [
  "oklch(0.6 0.13 240)",
  "oklch(0.62 0.15 155)",
  "oklch(0.72 0.14 75)",
  "oklch(0.58 0.17 25)",
  "oklch(0.32 0.08 250)",
  "oklch(0.78 0.05 75)",
  "oklch(0.5 0.1 290)",
  "oklch(0.6 0.08 200)",
  "oklch(0.4 0.05 60)",
];

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

export function CostProviderDonut({
  rows,
  totalCents,
  loading,
}: {
  rows: OverviewCostByProviderRow[];
  totalCents: number;
  loading: boolean;
}) {
  if (!loading && rows.length === 0) {
    return (
      <div
        className="flex h-full min-h-[340px] flex-col rounded-[14px] border p-6"
        style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
      >
        <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Cost by provider</div>
        <div className="flex flex-1 items-center justify-center text-sm" style={{ color: "var(--le-text-muted)" }}>
          No cost data in this period
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-[340px] flex-col rounded-[14px] border p-6"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
    >
      <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Cost by provider</div>
      <div className="relative mt-2 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="cost_cents"
              nameKey="provider"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="none"
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={COLOR_RAMP[i % COLOR_RAMP.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, _name: string, p: { payload?: { provider: string; pct: number } }) => [
                `${formatUSD(value)} (${(p.payload?.pct ?? 0).toFixed(1)}%)`,
                p.payload?.provider ?? "",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="le-mono text-2xl font-semibold" style={{ color: "var(--le-text)" }}>{formatUSD(totalCents)}</div>
          <div className="le-eyebrow mt-1" style={{ color: "var(--le-text-muted)" }}>Total</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.slice(0, 6).map((r, i) => (
          <div key={r.provider} className="flex items-center gap-2 text-xs" style={{ color: "var(--le-text-muted)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: COLOR_RAMP[i % COLOR_RAMP.length] }} />
            <span>{r.provider}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
