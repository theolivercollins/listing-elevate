import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Film, Percent, Activity } from "lucide-react";
import {
  fetchOverviewSystemHealth,
  fetchOverviewRecentListings,
  fetchOverviewCostByProvider,
  fetchOverviewRevenueSpendSeries,
  fetchProperties,
} from "@/lib/api";
import { KpiCard } from "@/v2/components/dashboard/KpiCard";
import { PeriodSelector } from "@/v2/components/dashboard/PeriodSelector";
import { RevenueSpendChart } from "@/v2/components/dashboard/RevenueSpendChart";
import { CostProviderDonut } from "@/v2/components/dashboard/CostProviderDonut";
import { RecentListingsTable } from "@/v2/components/dashboard/RecentListingsTable";
import { SystemHealthBadge } from "@/v2/components/dashboard/SystemHealthBadge";
import type { OverviewPeriod, Property } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import "@/v2/styles/v2.css";

function periodMs(period: OverviewPeriod): number {
  return { "7d": 7, "30d": 30, "90d": 90 }[period] * 86_400_000;
}

const Overview = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<OverviewPeriod>("30d");

  const health = useQuery({
    queryKey: ["overview", "system-health"],
    queryFn: fetchOverviewSystemHealth,
    refetchInterval: 60_000,
  });

  const recent = useQuery({
    queryKey: ["overview", "recent-listings"],
    queryFn: () => fetchOverviewRecentListings(10),
  });

  const cost = useQuery({
    queryKey: ["overview", "cost-by-provider", period],
    queryFn: () => fetchOverviewCostByProvider(period),
  });

  const series = useQuery({
    queryKey: ["overview", "revenue-spend-series", period],
    queryFn: () => fetchOverviewRevenueSpendSeries(period),
  });

  // Customer count (active in period) — count distinct user_id from properties created in period.
  const activeCustomers = useQuery({
    queryKey: ["overview", "active-customers", period],
    queryFn: async () => {
      const { properties } = await fetchProperties({ limit: 500 });
      const sincePropMs = Date.now() - periodMs(period);
      const recent = properties.filter((p) => new Date(p.created_at).getTime() >= sincePropMs);
      const users = new Set(recent.map((p) => (p as Property & { user_id?: string }).user_id).filter(Boolean) as string[]);
      return users.size;
    },
  });

  // Videos delivered (period) — count of properties moved to complete with completed_at >= since
  const delivered = useQuery({
    queryKey: ["overview", "delivered", period],
    queryFn: async () => {
      const { properties } = await fetchProperties({ status: "complete", limit: 500 });
      const sinceMs = Date.now() - periodMs(period);
      return properties.filter((p) => {
        const completedAt = (p as Property & { completed_at?: string }).completed_at;
        return completedAt ? new Date(completedAt).getTime() >= sinceMs : false;
      }).length;
    },
  });

  // Margin % — (revenue - spend) / revenue from current period series. Falls back to 0.
  const margin = (() => {
    const points = series.data?.points ?? [];
    const rev = points.reduce((acc, p) => acc + p.revenue_cents, 0);
    const sp = points.reduce((acc, p) => acc + p.spend_cents, 0);
    if (rev === 0) return null;
    return ((rev - sp) / rev) * 100;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Welcome back</div>
          <h2 className="le-display mt-1 text-[28px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
            {user?.email?.split("@")[0] ?? "Admin"}
          </h2>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={`Active customers (${period})`}
          value={activeCustomers.isLoading ? "…" : String(activeCustomers.data ?? 0)}
          gradient="blue"
          icon={<Users className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label={`Videos delivered (${period})`}
          value={delivered.isLoading ? "…" : String(delivered.data ?? 0)}
          gradient="navy"
          icon={<Film className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label={`Margin (${period})`}
          value={margin === null ? "—" : `${margin.toFixed(1)}%`}
          gradient="beige"
          icon={<Percent className="h-5 w-5" strokeWidth={1.6} />}
        />
        <KpiCard
          label="System health"
          value={
            health.isLoading ? (
              "…"
            ) : (
              <div className="flex flex-col gap-1">
                <SystemHealthBadge status={health.data?.status ?? "healthy"} />
                <span className="text-xs" style={{ color: "var(--le-text-muted)" }}>
                  {health.data?.alert_count ?? 0} alerts
                </span>
              </div>
            )
          }
          gradient={
            health.data?.status === "critical"
              ? "status-critical"
              : health.data?.status === "degraded"
              ? "status-degraded"
              : "status-healthy"
          }
          icon={<Activity className="h-5 w-5" strokeWidth={1.6} />}
          href="/dashboard/dev/system-status"
        />
      </div>

      {/* Chart + donut row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueSpendChart points={series.data?.points ?? []} loading={series.isLoading} />
        </div>
        <CostProviderDonut
          rows={cost.data?.rows ?? []}
          totalCents={cost.data?.total_cents ?? 0}
          loading={cost.isLoading}
        />
      </div>

      {/* Recent listings */}
      <RecentListingsTable listings={recent.data?.listings ?? []} loading={recent.isLoading} />
    </div>
  );
};

export default Overview;
