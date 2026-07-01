import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Link } from "react-router-dom";
import { PageHeading, Card, StatusChip, EmptyState, SkeletonRow } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import "@/v2/styles/v2.css";

// Cost column removed: agents must never see internal total_cost_cents.
// Rows link to /status/:id (agent-safe public status page), not to
// /dashboard/properties/:id (admin-only, inside RequireAdmin).
const ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "3fr 1fr 1fr 32px",
  gap: 16,
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid var(--line-2)",
  textDecoration: "none",
  color: "inherit",
  transition: "background .12s",
};

export default function AccountListings() {
  const { user } = useAuth();

  const { data: properties, isLoading } = useQuery({
    queryKey: ["account-listings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("submitted_by", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return (
    <div className="le-fade-up" style={{ maxWidth: 900 }}>
      <AccountSubNav />
      <PageHeading eyebrow="Account · Listings" title="My listings" />

      <div style={{ marginTop: 28 }}>
        <Card padding={0}>
          {/* Table header */}
          <div
            style={{
              ...ROW_STYLE,
              borderBottom: "1px solid var(--line)",
              background: "var(--line-2)",
              color: "var(--muted)",
            }}
          >
            <span className="le-d-label">Property</span>
            <span className="le-d-label">Submitted</span>
            <span className="le-d-label">Status</span>
            <span />
          </div>

          {isLoading ? (
            <div style={{ padding: "4px 14px" }}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : !properties?.length ? (
            <div style={{ padding: "24px 14px" }}>
              <EmptyState
                message="You haven't submitted any listings yet."
                icon="home"
                cta={{ label: "Upload your first listing", to: "/upload" }}
              />
            </div>
          ) : (
            properties.map((p) => (
              <Link
                key={p.id}
                to={`/status/${p.id}`}
                style={ROW_STYLE}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--line-2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
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
                  </div>
                  {(p.bedrooms || p.bathrooms || p.price) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginTop: 2,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {p.bedrooms ? `${p.bedrooms}bd` : null}
                      {p.bedrooms && p.bathrooms ? " · " : null}
                      {p.bathrooms ? `${p.bathrooms}ba` : null}
                      {p.price ? ` · $${p.price.toLocaleString()}` : null}
                    </div>
                  )}
                </div>
                <span
                  style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}
                >
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
                <StatusChip status={p.status} />
                <span style={{ display: "flex", justifyContent: "center", color: "var(--muted-2)" }}>
                  <Icon name="chevron-right" size={14} />
                </span>
              </Link>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
