import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, Star } from "lucide-react";
import { fetchCellDrillDown } from "@/lib/knowledgeMapApi";
import type { CellDrillDown } from "../../../lib/knowledge-map/types.js";
import "@/v2/styles/v2.css";

const STATE_COLOR: Record<string, string> = {
  untested: "text-muted-foreground",
  weak: "text-red-600 dark:text-red-400",
  okay: "text-amber-600 dark:text-amber-300",
  strong: "text-emerald-600 dark:text-emerald-300",
  golden: "text-amber-700 dark:text-amber-100 font-semibold",
};

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`h-3 w-3 ${n <= rating ? "fill-foreground text-foreground" : "text-muted-foreground/30"}`} />
      ))}
    </span>
  );
}

export default function KnowledgeMapCell() {
  const { cellKey = "" } = useParams();
  const [data, setData] = useState<CellDrillDown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetchCellDrillDown(cellKey);
        if (!cancelled) setData(resp.cell);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [cellKey]);

  return (
    <div className="le-root" style={{ background: "transparent", padding: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

        {/* Page header */}
        <div>
          <Link
            to="/dashboard/dev/knowledge-map"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "var(--le-text-muted)",
              textDecoration: "none", marginBottom: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--le-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--le-text-muted)")}
          >
            <ArrowLeft style={{ width: 12, height: 12 }} /> back to map
          </Link>
          <div className="le-eyebrow" style={{ marginBottom: 8 }}>Studio / Dev · Knowledge Map</div>
          <h1
            className="le-display le-mono"
            style={{ fontSize: "clamp(22px, 3vw, 34px)", fontWeight: 500, color: "var(--le-text)", margin: 0 }}
          >
            {cellKey}
          </h1>
          {data && (
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--le-text-muted)" }}>
              <span className={STATE_COLOR[data.state]}>{data.state}</span>
              {" · "}{data.sample_size} samples
              {data.avg_rating !== null && <> · avg {Number(data.avg_rating).toFixed(2)}</>}
              {data.five_star_count > 0 && <> · ★5 × {data.five_star_count}</>}
              {data.loser_count > 0 && <> · losers × {data.loser_count}</>}
            </p>
          )}
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "var(--le-danger-soft)",
              border: "1px solid var(--le-danger)",
              borderRadius: "var(--le-r-md)",
              color: "var(--le-danger)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {loading && (
          <Loader2 style={{ width: 20, height: 20, color: "var(--le-text-muted)", animation: "spin 1s linear infinite" }} />
        )}

        {data && (
          <>
            {/* Fail tag histogram */}
            <section
              className="le-card"
              style={{ padding: 24 }}
            >
              <div className="le-eyebrow" style={{ marginBottom: 16 }}>Failure tag histogram</div>
              {data.fail_tags.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--le-text-muted)" }}>
                  No fail:* tags recorded in this cell.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                  {data.fail_tags.map((f) => (
                    <li
                      key={f.tag}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        border: "1px solid var(--le-border)", borderRadius: "var(--le-r-sm)",
                        padding: "8px 10px", fontSize: 12,
                      }}
                    >
                      <span className="le-mono" style={{ color: "var(--le-text)" }}>{f.tag}</span>
                      <span style={{ color: "var(--le-text-muted)" }}>{f.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Active recipes */}
            <section
              className="le-card"
              style={{ padding: 24 }}
            >
              <div className="le-eyebrow" style={{ marginBottom: 16 }}>Active recipes</div>
              {data.recipes.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--le-text-muted)" }}>
                  No active recipes in this cell.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.recipes.map((r) => (
                    <li
                      key={r.id}
                      style={{
                        border: "1px solid var(--le-border)", borderRadius: "var(--le-r-sm)", padding: 14, fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span className="le-mono" style={{ fontWeight: 500, color: "var(--le-text)" }}>{r.archetype}</span>
                        <span style={{ fontSize: 11, color: "var(--le-text-muted)" }}>
                          ★{r.rating_at_promotion} · applied {r.times_applied}×
                        </span>
                      </div>
                      <pre
                        style={{
                          margin: 0, maxHeight: 96, overflow: "auto", whiteSpace: "pre-wrap",
                          fontSize: 10, color: "var(--le-text-muted)",
                          fontFamily: "var(--le-font-mono)",
                        }}
                      >
                        {r.prompt_template}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Overrides */}
            <section
              className="le-card"
              style={{ padding: 24 }}
            >
              <div className="le-eyebrow" style={{ marginBottom: 16 }}>Overrides matching this cell</div>
              {data.overrides.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--le-text-muted)" }}>None.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.overrides.map((o) => (
                    <li
                      key={o.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        border: "1px solid var(--le-border)", borderRadius: "var(--le-r-sm)",
                        padding: "8px 10px", fontSize: 12,
                      }}
                    >
                      <span className="le-mono" style={{ color: "var(--le-text)" }}>{o.prompt_name}</span>
                      <span style={{ color: "var(--le-text-muted)" }}>{o.body_hash.slice(0, 10)}…</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Recent iterations */}
            <section
              className="le-card"
              style={{ padding: 24 }}
            >
              <div className="le-eyebrow" style={{ marginBottom: 16 }}>
                Recent iterations ({data.iterations.length})
              </div>
              {data.iterations.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--le-text-muted)" }}>
                  No rated iterations yet.
                </p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                  {data.iterations.map((i) => (
                    <div
                      key={`${i.source}-${i.id}`}
                      style={{
                        border: "1px solid var(--le-border)", borderRadius: "var(--le-r-sm)",
                        padding: 12, fontSize: 12,
                        background: "var(--le-bg)",
                      }}
                    >
                      {i.source_image_url && (
                        <img
                          src={i.source_image_url}
                          alt=""
                          style={{ display: "block", width: "100%", aspectRatio: "16/9", objectFit: "cover", marginBottom: 8, borderRadius: "var(--le-r-sm)" }}
                          loading="lazy"
                        />
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Stars rating={i.rating} />
                        <span
                          className="le-mono"
                          style={{ fontSize: 10, color: "var(--le-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}
                        >
                          {i.source}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 10, color: "var(--le-text-muted)" }}>
                        {i.provider ?? "—"}
                        {i.judge_composite !== null && <> · judge {Number(i.judge_composite).toFixed(2)}</>}
                      </div>
                      {i.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {i.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              style={{
                                border: "1px solid var(--le-border)",
                                borderRadius: "var(--le-r-sm)",
                                padding: "1px 5px",
                                fontSize: 9,
                                color: t.startsWith("fail:") ? "var(--le-danger)" : "var(--le-text-muted)",
                              }}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Cost footer */}
            <div style={{ textAlign: "right", fontSize: 11, color: "var(--le-text-faint)" }}>
              Spend scoped to this cell (judge only so far): ${(data.total_cost_cents / 100).toFixed(2)}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
