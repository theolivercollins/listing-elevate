import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { OverviewRevenueSpendPoint } from "@/lib/types";

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function RevenueSpendChart({
  points,
  loading,
}: {
  points: OverviewRevenueSpendPoint[];
  loading: boolean;
}) {
  const totalRev = points.reduce((acc, p) => acc + p.revenue_cents, 0);
  const totalSpend = points.reduce((acc, p) => acc + p.spend_cents, 0);

  return (
    <div
      className="rounded-[14px] border p-6"
      style={{
        background: "var(--le-bg-elev)",
        borderColor: "var(--le-border)",
        boxShadow: "var(--le-shadow-md)",
      }}
    >
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>
            Revenue &amp; Spend
          </div>
          <div className="mt-1 flex gap-6">
            <div>
              <div
                className="le-mono text-2xl font-semibold"
                style={{ color: "var(--le-text)" }}
              >
                {formatUSD(totalRev)}
              </div>
              <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                Revenue
              </div>
            </div>
            <div>
              <div
                className="le-mono text-2xl font-semibold"
                style={{ color: "var(--le-text-muted)" }}
              >
                {formatUSD(totalSpend)}
              </div>
              <div className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                Spend
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="h-[260px]">
        {loading ? (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{ color: "var(--le-text-muted)" }}
          >
            Loading…
          </div>
        ) : (
          <div data-testid="chart-empty" style={{ width: "100%", height: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="oklch(0.62 0.13 240)"
                    stopOpacity={0.5}
                  />
                  <stop
                    offset="100%"
                    stopColor="oklch(0.62 0.13 240)"
                    stopOpacity={0.0}
                  />
                </linearGradient>
                <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="oklch(0.85 0.04 80)"
                    stopOpacity={0.5}
                  />
                  <stop
                    offset="100%"
                    stopColor="oklch(0.85 0.04 80)"
                    stopOpacity={0.0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--le-border)"
              />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => d.slice(5)}
                tick={{ fontSize: 11, fill: "var(--le-text-muted)" }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--le-text-muted)" }}
                tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatUSD(value),
                  name === "revenue_cents" ? "Revenue" : "Spend",
                ]}
                labelFormatter={(d) => d}
              />
              <Area
                type="monotone"
                dataKey="revenue_cents"
                stroke="oklch(0.5 0.16 245)"
                strokeWidth={2}
                fill="url(#gradRev)"
              />
              <Area
                type="monotone"
                dataKey="spend_cents"
                stroke="oklch(0.78 0.05 75)"
                strokeWidth={2}
                fill="url(#gradSpend)"
              />
            </AreaChart>
          </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
