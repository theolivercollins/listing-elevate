import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { listOrders, formatStatus, formatOrderNumber, type PortalOrder } from "@/lib/portalApi";
import { getRelativeTime } from "@/lib/types";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function StatusBadge({ status }: { status: PortalOrder["status"] }) {
  const { label, tone } = formatStatus(status);
  const cls =
    tone === "accent"
      ? "border-accent/40 bg-accent/10 text-accent"
      : tone === "success"
      ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-600"
      : tone === "warning"
      ? "border-amber-600/40 bg-amber-600/10 text-amber-600"
      : tone === "destructive"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-border bg-secondary text-muted-foreground";
  return <span className={`label inline-flex items-center border px-2 py-1 ${cls}`}>{label}</span>;
}

export default function DashboardOrders() {
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOrders()
      .then((rows) => { if (!cancelled) setOrders(rows); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-12">
      <div className="flex items-end justify-between gap-6">
        <div>
          <span className="label text-muted-foreground">— Client work</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] md:text-3xl">Orders</h2>
        </div>
        <Link
          to="/dashboard/orders/new"
          className="inline-flex items-center gap-2 border border-foreground bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Plus className="h-4 w-4" /> New order
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">{error}</div>
      ) : orders.length === 0 ? (
        <div className="border border-dashed border-border p-16 text-center">
          <p className="text-sm text-muted-foreground">No orders yet.</p>
          <Link
            to="/dashboard/orders/new"
            className="label mt-6 inline-flex items-center gap-2 text-foreground hover:opacity-70"
          >
            Create your first order <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="border-t border-border">
          <div className="hidden grid-cols-[2.5fr_1.6fr_1fr_1.4fr_1fr] gap-6 border-b border-border py-4 md:grid">
            <span className="label text-muted-foreground">Order</span>
            <span className="label text-muted-foreground">Client</span>
            <span className="label text-right text-muted-foreground">Amount</span>
            <span className="label text-muted-foreground">Status</span>
            <span className="label text-right text-muted-foreground">Created</span>
          </div>
          {orders.map((o, i) => (
            <motion.div
              key={o.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.02, ease: EASE }}
            >
              <Link
                to={`/dashboard/orders/${o.id}`}
                className="block border-b border-border py-5 transition-colors hover:bg-secondary/40 md:grid md:grid-cols-[2.5fr_1.6fr_1fr_1.4fr_1fr] md:items-center md:gap-6"
              >
                <div className="flex items-start justify-between gap-3 md:contents">
                  <span className="min-w-0 truncate text-sm font-medium">
                    <span className="tabular mr-2 text-xs text-muted-foreground">{formatOrderNumber(o.order_number)}</span>
                    {o.title}
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold md:text-right">
                    ${(o.amount_cents / 100).toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 md:contents md:mt-0">
                  <span className="truncate text-xs text-muted-foreground">
                    {o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : "—"}
                  </span>
                  <span><StatusBadge status={o.status} /></span>
                  <span className="tabular hidden text-right text-xs text-muted-foreground md:inline">
                    {getRelativeTime(o.created_at)}
                  </span>
                </div>
                <span className="tabular mt-2 block text-xs text-muted-foreground md:hidden">
                  {getRelativeTime(o.created_at)}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
