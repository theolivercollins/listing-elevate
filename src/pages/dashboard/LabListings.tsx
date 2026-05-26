import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { listListings, type LabListing } from "@/lib/labListingsApi";
import { PageHeading, StatusPill, PropertyThumb, Card, fmtCents } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import "@/v2/styles/v2.css";

// Map lab listing statuses → design system status tokens
const LAB_STATUS_MAP: Record<string, string> = {
  draft: "queued",
  analyzing: "analyzing",
  directing: "scripting",
  ready_to_render: "complete",
  rendering: "generating",
  complete: "complete",
  failed: "failed",
};

const LAB_MODE_KEY = "lab_mode_version";
type LabVersion = "v1" | "v21";

// ── V1 ↔ V2.1 mode toggle ────────────────────────────────────────────
function LabVersionToggle({ current }: { current: LabVersion }) {
  const navigate = useNavigate();

  function switchTo(v: LabVersion) {
    localStorage.setItem(LAB_MODE_KEY, v);
    if (v === "v21") {
      navigate("/dashboard/development/lab/v21");
    }
    // v1 is current page — already here
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0,
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--line)",
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {(["v1", "v21"] as LabVersion[]).map((v) => {
        const active = current === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => switchTo(v)}
            style={{
              padding: "7px 18px",
              border: "none",
              background: active ? "var(--ink)" : "transparent",
              color: active ? "var(--bg, #fff)" : "var(--muted)",
              fontSize: 12.5,
              fontWeight: active ? 600 : 400,
              cursor: active ? "default" : "pointer",
              fontFamily: "var(--le-font-sans)",
              letterSpacing: "-0.01em",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {v === "v1" ? "V1 Single-Image Lab" : "V2.1 Pair-Picker Lab"}
          </button>
        );
      })}
    </div>
  );
}

function labThumbHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return 200 + (h % 160);
}

export default function LabListings() {
  const [listings, setListings] = useState<LabListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const { listings } = await listListings();
      setListings(listings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* V1 ↔ V2.1 mode toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <LabVersionToggle current="v1" />
      </div>

      <PageHeading
        eyebrow="Lab · Listings"
        title="Listings lab"
        sub="Upload photos, watch the director plan scenes, render clips, and rate each result to feed the Knowledge Map."
        actions={
          <Link
            to="/dashboard/development/lab/new"
            className="le-btn-dark"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="plus" size={13} />
            Create listing
          </Link>
        }
      />

      {error && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(196,74,74,0.07)",
            border: "1px solid rgba(196,74,74,0.18)",
            fontSize: 13,
            color: "var(--bad)",
          }}
        >
          {error}
        </div>
      )}

      {loading && !listings && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13 }}>
          <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
          Loading listings…
        </div>
      )}

      {listings && listings.length === 0 && !loading && (
        <Card padding={40}>
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            No listings yet. Create your first — upload 10–30 photos and watch the director plan the video.
          </div>
        </Card>
      )}

      {listings && listings.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {listings.map((l) => {
            const dsStatus = LAB_STATUS_MAP[l.status] ?? "queued";
            return (
              <Link
                key={l.id}
                to={`/dashboard/development/lab/${l.id}`}
                className="le-lift"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  padding: 20,
                  borderRadius: "var(--radius)",
                  background: "var(--surface)",
                  boxShadow: "var(--shadow-sm)",
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                {/* Thumb + name row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <PropertyThumb hue={labThumbHue(l.id)} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {l.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>
                      {new Date(l.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <ArrowRight style={{ width: 13, height: 13, color: "var(--muted-2)", flexShrink: 0 }} />
                </div>

                {/* Status pill + model chip */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <StatusPill status={dsStatus} />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                      background: "rgba(11,11,16,0.05)",
                      color: "var(--muted)",
                    }}
                  >
                    {l.model_name}
                  </span>
                </div>

                {/* Mini stats row */}
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    paddingTop: 12,
                    borderTop: "1px solid var(--line-2)",
                  }}
                >
                  {l.total_cost_cents > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Spend</div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "var(--ink)",
                          fontVariantNumeric: "tabular-nums",
                          marginTop: 2,
                        }}
                      >
                        {fmtCents(l.total_cost_cents)}
                      </div>
                    </div>
                  )}
                  {l.notes && (
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Notes</div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--ink-2)",
                          marginTop: 2,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {l.notes}
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
