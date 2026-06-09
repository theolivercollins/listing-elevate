import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, Star } from "lucide-react";
import { fetchCellDrillDown } from "@/lib/knowledgeMapApi";
import type { CellDrillDown } from "../../../lib/knowledge-map/types.js";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";

const STATE_COLOR: Record<string, string> = {
  untested: "var(--muted)",
  weak:     "var(--bad)",
  okay:     "var(--warn)",
  strong:   "var(--good)",
  golden:   "var(--warn)",
};

function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          style={{
            width: 12,
            height: 12,
            fill: n <= rating ? "var(--ink)" : "transparent",
            color: n <= rating ? "var(--ink)" : "rgba(11,11,16,0.18)",
          }}
        />
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
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeading
        eyebrow="Lab · Knowledge map"
        title={cellKey || "Cell"}
        sub={
          data ? (
            <span>
              <span style={{ color: STATE_COLOR[data.state] ?? "var(--muted)" }}>{data.state}</span>
              {" · "}{data.sample_size} samples
              {data.avg_rating !== null && ` · avg ${Number(data.avg_rating).toFixed(2)}`}
              {data.five_star_count > 0 && ` · 5-star × ${data.five_star_count}`}
              {data.loser_count > 0 && ` · losers × ${data.loser_count}`}
            </span>
          ) : undefined
        }
        actions={
          <Link
            to="/dashboard/development/knowledge-map"
            className="le-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 12.5,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            <ArrowLeft style={{ width: 12, height: 12 }} />
            Back to map
          </Link>
        }
      />

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(196,74,74,0.06)",
            border: "1px solid rgba(196,74,74,0.20)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px 0" }}>
          <Loader2 style={{ width: 20, height: 20, color: "var(--muted)" }} className="animate-spin mx-auto" />
        </div>
      )}

      {data && (
        <>
          {/* Failure tag histogram */}
          <Card padding={20}>
            <SectionTitle eyebrow="Failure tags" title="Fail tag histogram" />
            <div style={{ marginTop: 14 }}>
              {data.fail_tags.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  No fail:* tags recorded in this cell.
                </p>
              ) : (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  }}
                >
                  {data.fail_tags.map((f) => (
                    <li
                      key={f.tag}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(11,11,16,0.03)",
                        border: "1px solid var(--line)",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{f.tag}</span>
                      <span
                        style={{
                          color: "var(--muted)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {f.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Active recipes */}
          <Card padding={20}>
            <SectionTitle eyebrow="Recipes" title="Active recipes" />
            <div style={{ marginTop: 14 }}>
              {data.recipes.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                  No active recipes in this cell.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.recipes.map((r) => (
                    <li
                      key={r.id}
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(11,11,16,0.025)",
                        border: "1px solid var(--line)",
                        fontSize: 12.5,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.archetype}</span>
                        <span
                          style={{
                            color: "var(--muted)",
                            fontSize: 12,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          ★{r.rating_at_promotion} · applied {r.times_applied}×
                        </span>
                      </div>
                      <pre
                        style={{
                          marginTop: 8,
                          maxHeight: 96,
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                          fontSize: 10.5,
                          color: "var(--muted)",
                          lineHeight: 1.6,
                          padding: "6px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: "rgba(11,11,16,0.03)",
                        }}
                      >
                        {r.prompt_template}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Overrides */}
          <Card padding={20}>
            <SectionTitle eyebrow="Overrides" title="Overrides matching this cell" />
            <div style={{ marginTop: 14 }}>
              {data.overrides.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>None.</p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.overrides.map((o) => (
                    <li
                      key={o.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(11,11,16,0.025)",
                        border: "1px solid var(--line)",
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{o.prompt_name}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                        {o.body_hash.slice(0, 10)}…
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Recent iterations */}
          <Card padding={20}>
            <SectionTitle eyebrow="Iterations" title={`Recent iterations (${data.iterations.length})`} />
            <div style={{ marginTop: 14 }}>
              {data.iterations.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>No rated iterations yet.</p>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 12,
                  }}
                >
                  {data.iterations.map((i) => (
                    <div
                      key={`${i.source}-${i.id}`}
                      className="le-lift"
                      style={{
                        padding: "12px",
                        borderRadius: "var(--radius-sm)",
                        background: "rgba(11,11,16,0.025)",
                        border: "1px solid var(--line)",
                        fontSize: 12.5,
                      }}
                    >
                      {i.source_image_url && (
                        <img
                          src={i.source_image_url}
                          alt=""
                          style={{
                            display: "block",
                            marginBottom: 8,
                            aspectRatio: "16/9",
                            width: "100%",
                            objectFit: "cover",
                            borderRadius: "var(--radius-sm)",
                          }}
                          loading="lazy"
                        />
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Stars rating={i.rating} />
                        <span
                          style={{
                            fontSize: 10.5,
                            color: "var(--muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {i.source}
                        </span>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11.5,
                          color: "var(--muted)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {i.provider ?? "—"}
                        {i.judge_composite !== null && (
                          <> · judge {Number(i.judge_composite).toFixed(2)}</>
                        )}
                      </div>
                      {i.tags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {i.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              style={{
                                padding: "1px 6px",
                                borderRadius: 999,
                                fontSize: 10,
                                border: "1px solid var(--line)",
                                color: t.startsWith("fail:") ? "var(--bad)" : "var(--muted)",
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
            </div>
          </Card>

          <div
            style={{
              textAlign: "right",
              fontSize: 11.5,
              color: "var(--muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            Spend scoped to this cell (judge only so far): ${(data.total_cost_cents / 100).toFixed(2)}
          </div>
        </>
      )}
    </div>
  );
}
