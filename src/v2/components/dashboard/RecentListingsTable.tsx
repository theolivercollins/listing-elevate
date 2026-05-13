import { Link } from "react-router-dom";
import type { OverviewRecentListing } from "@/lib/types";

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  complete: { bg: "var(--le-success-soft)", fg: "var(--le-success)" },
  needs_review: { bg: "var(--le-warn-soft)", fg: "var(--le-warn)" },
  failed: { bg: "var(--le-danger-soft)", fg: "var(--le-danger)" },
};

function StatusPill({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? { bg: "var(--le-bg-sunken)", fg: "var(--le-text-muted)" };
  return (
    <span
      className="le-mono inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function RecentListingsTable({
  listings,
  loading,
}: {
  listings: OverviewRecentListing[];
  loading: boolean;
}) {
  return (
    <div
      className="rounded-[14px] border"
      style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
    >
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--le-border)" }}>
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Recent listings</div>
        </div>
        <Link to="/dashboard/listings" className="le-mono text-xs font-medium" style={{ color: "var(--le-text-muted)" }}>
          View all →
        </Link>
      </div>
      {loading ? (
        <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
      ) : listings.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>No recent listings.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--le-text-muted)" }}>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Order</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Customer</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Address</th>
              <th className="le-eyebrow px-6 py-3 text-left font-medium">Stage</th>
              <th className="le-eyebrow px-6 py-3 text-right font-medium">Cost</th>
              <th className="le-eyebrow px-6 py-3 text-right font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id} className="border-t" style={{ borderColor: "var(--le-border)" }}>
                <td className="px-6 py-3">
                  <Link to={`/dashboard/listings/${l.id}`} className="le-mono text-xs font-semibold" style={{ color: "var(--le-text)" }}>
                    {l.order_id ?? l.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-6 py-3" style={{ color: "var(--le-text-muted)" }}>{l.customer_email ?? "—"}</td>
                <td className="px-6 py-3" style={{ color: "var(--le-text)" }}>{l.address}</td>
                <td className="px-6 py-3"><StatusPill status={l.status} /></td>
                <td className="le-mono px-6 py-3 text-right" style={{ color: "var(--le-text)" }}>{formatUSD(l.cost_cents)}</td>
                <td className="px-6 py-3 text-right text-xs" style={{ color: "var(--le-text-muted)" }}>{formatRelative(l.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
