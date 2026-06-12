import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeading, Card, KpiCard, StatusPill, fmtCents } from "@/components/dashboard/primitives";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import "@/v2/styles/v2.css";

const ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "3fr 1fr 1fr 1fr",
  gap: 16,
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid var(--line-2)",
  transition: "background .12s",
};

export default function AccountBilling() {
  const { user } = useAuth();

  const { data: properties, isLoading } = useQuery({
    queryKey: ["account-billing", user?.id],
    queryFn: async () => {
      // Select stripe_amount_cents — what the agent actually paid — never total_cost_cents
      // (that field holds internal provider cost and must never reach agent surfaces).
      const { data, error } = await supabase
        .from("properties")
        .select("id, address, status, stripe_amount_cents, created_at")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const totalCost = properties?.reduce((sum, p) => sum + ((p as { stripe_amount_cents?: number }).stripe_amount_cents || 0), 0) ?? 0;
  const completedCount = properties?.filter((p) => p.status === "complete" || (p.status as string) === "delivered").length ?? 0;
  const avgCost = completedCount > 0 ? Math.round(totalCost / completedCount) : null;

  return (
    <div className="le-fade-up" style={{ maxWidth: 800 }}>
      <AccountSubNav />
      <PageHeading eyebrow="Account · Billing" title="Billing & spend" />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <KpiCard
            label="Total spend"
            value={isLoading ? "—" : fmtCents(totalCost)}
          />
          <KpiCard
            label="Average / video"
            value={isLoading ? "—" : avgCost != null ? fmtCents(avgCost) : "—"}
          />
          <KpiCard
            label="Videos delivered"
            value={isLoading ? "—" : String(completedCount).padStart(2, "0")}
          />
        </div>

        {/* Per-property table */}
        <Card padding={0}>
          {/* Table header */}
          <div
            style={{
              ...ROW_STYLE,
              borderBottom: "1px solid var(--line)",
              background: "var(--line-2)",
            }}
          >
            <span className="le-d-label">Property</span>
            <span className="le-d-label">Date submitted</span>
            <span className="le-d-label">Status</span>
            <span className="le-d-label" style={{ textAlign: "right" }}>Cost</span>
          </div>

          {isLoading ? (
            <div style={{ padding: "40px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              Loading...
            </div>
          ) : !properties?.length ? (
            <div style={{ padding: "40px 14px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No spend yet — once your first listing is delivered, the breakdown appears here.
            </div>
          ) : (
            <>
              {properties.map((p) => (
                <div
                  key={p.id}
                  style={ROW_STYLE}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--line-2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.address}
                  </span>
                  <span
                    style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <StatusPill status={p.status} />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                      fontVariantNumeric: "tabular-nums",
                      textAlign: "right",
                    }}
                  >
                    {/* Render stripe_amount_cents (what agent paid); never internal total_cost_cents */}
                    {(p as { stripe_amount_cents?: number }).stripe_amount_cents
                      ? fmtCents((p as { stripe_amount_cents?: number }).stripe_amount_cents)
                      : "—"}
                  </span>
                </div>
              ))}

              {/* Totals row */}
              <div
                style={{
                  ...ROW_STYLE,
                  borderBottom: "none",
                  borderTop: "1px solid var(--line)",
                  background: "var(--line-2)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Total</span>
                <span />
                <span />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--ink)",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {fmtCents(totalCost)}
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
