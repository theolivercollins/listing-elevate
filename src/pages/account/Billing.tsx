import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { CreditCard, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import "@/v2/styles/v2.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };
const SECTION_H3: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: 20, fontWeight: 500, letterSpacing: "-0.025em", color: "#fff", margin: 0 };
const MONO_VALUE: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff" };

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AccountBilling() {
  const { user } = useAuth();

  const { data: properties, isLoading } = useQuery({
    queryKey: ["account-billing", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address, status, total_cost_cents, created_at")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalCost = properties?.reduce((sum, p) => sum + (p.total_cost_cents || 0), 0) ?? 0;
  const completedCount = properties?.filter((p) => p.status === "complete").length ?? 0;
  const avgCost = completedCount > 0 ? Math.round(totalCost / completedCount) : 0;

  const stats = [
    { label: "Total spent", value: formatCents(totalCost) },
    { label: "Videos delivered", value: String(completedCount).padStart(2, "0") },
    { label: "Average per video", value: completedCount > 0 ? formatCents(avgCost) : "—" },
  ];

  return (
    <div className="space-y-16">
      {/* Header */}
      <div>
        <span style={EYEBROW}>— Billing</span>
        <h2 className="mt-3" style={PAGE_H1}>Spend at a glance.</h2>
      </div>

      {/* Stats */}
      <div className="grid gap-px border border-border bg-border md:grid-cols-3" style={{ borderRadius: 0 }}>
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: i * 0.06, ease: EASE }}
            className="bg-background p-8"
            style={{ borderRadius: 0 }}
          >
            <span style={EYEBROW}>{s.label}</span>
            <div className="mt-6" style={MONO_VALUE}>{s.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Payment method */}
      <div className="border border-dashed border-border bg-secondary/30 p-10" style={{ borderRadius: 0 }}>
        <div className="flex items-start gap-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-border text-muted-foreground" style={{ borderRadius: 0 }}>
            <CreditCard className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <span style={EYEBROW}>— Coming soon</span>
            <h3 className="mt-3" style={SECTION_H3}>Payment method</h3>
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Card-on-file billing through Stripe is on the way. For now, we invoice manually after delivery.
            </p>
          </div>
        </div>
      </div>

      {/* Breakdown */}
      {properties && properties.length > 0 && (
        <div>
          <div className="flex items-end justify-between">
            <div>
              <span style={EYEBROW}>— Detail</span>
              <h3 className="mt-3" style={SECTION_H3}>Cost breakdown</h3>
            </div>
          </div>
          <div className="mt-10 border-t border-border">
            <div className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-6 border-b border-border py-4" style={{ background: "rgba(255,255,255,0.03)", fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.18em" }}>
              <span style={EYEBROW}>Property</span>
              <span style={EYEBROW}>Status</span>
              <span style={EYEBROW}>Date</span>
              <span className="text-right" style={EYEBROW}>Cost</span>
            </div>
            {properties.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: i * 0.03, ease: EASE }}
                className="grid grid-cols-[3fr_1fr_1fr_1fr] items-center gap-6 border-b border-border py-5 transition-colors duration-500 hover:bg-secondary/40"
              >
                <span className="truncate text-sm font-medium">{p.address}</span>
                <span className="label text-muted-foreground capitalize">{p.status.replace("_", " ")}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
                <span className="tabular text-right text-sm font-semibold">
                  {p.total_cost_cents > 0 ? formatCents(p.total_cost_cents) : "—"}
                </span>
              </motion.div>
            ))}
            <div className="grid grid-cols-[3fr_1fr_1fr_1fr] gap-6 py-6">
              <span className="label text-foreground">Total</span>
              <span />
              <span />
              <span className="tabular text-right text-lg font-semibold">{formatCents(totalCost)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
