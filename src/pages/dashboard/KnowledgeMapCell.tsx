import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, Star } from "lucide-react";
import { fetchCellDrillDown } from "@/lib/knowledgeMapApi";
import type { CellDrillDown } from "../../../lib/knowledge-map/types.js";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };

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
    <div className="space-y-10">
      <div>
        <Link to="/dashboard/development/knowledge-map" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> back to map
        </Link>
        <h2 className="mt-2" style={PAGE_H1}>{cellKey}</h2>
        {data && (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className={STATE_COLOR[data.state]}>{data.state}</span> · {data.sample_size} samples
            {data.avg_rating !== null && <> · avg {Number(data.avg_rating).toFixed(2)}</>}
            {data.five_star_count > 0 && <> · ★5 × {data.five_star_count}</>}
            {data.loser_count > 0 && <> · losers × {data.loser_count}</>}
          </p>
        )}
      </div>

      {error && <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {data && (
        <>
          <section className="border border-border bg-background p-6">
            <span style={EYEBROW}>Failure tag histogram</span>
            {data.fail_tags.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No fail:* tags recorded in this cell.</p>
            ) : (
              <ul className="mt-3 grid gap-2 md:grid-cols-2">
                {data.fail_tags.map((f) => (
                  <li key={f.tag} className="flex items-center justify-between border border-border p-2 text-xs">
                    <span className="font-mono">{f.tag}</span>
                    <span className="text-muted-foreground">{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border bg-background p-6">
            <span style={EYEBROW}>Active recipes</span>
            {data.recipes.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No active recipes in this cell.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.recipes.map((r) => (
                  <li key={r.id} className="border border-border p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{r.archetype}</span>
                      <span className="text-muted-foreground">★{r.rating_at_promotion} · applied {r.times_applied}×</span>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{r.prompt_template}</pre>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border bg-background p-6">
            <span style={EYEBROW}>Overrides matching this cell</span>
            {data.overrides.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.overrides.map((o) => (
                  <li key={o.id} className="flex items-center justify-between border border-border p-2 text-xs">
                    <span className="font-mono">{o.prompt_name}</span>
                    <span className="text-muted-foreground">{o.body_hash.slice(0, 10)}…</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border bg-background p-6">
            <span style={EYEBROW}>Recent iterations ({data.iterations.length})</span>
            {data.iterations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No rated iterations yet.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {data.iterations.map((i) => (
                  <div key={`${i.source}-${i.id}`} className="border border-border bg-background p-3 text-xs">
                    {i.source_image_url && (
                      <img src={i.source_image_url} alt="" className="mb-2 aspect-video w-full object-cover" loading="lazy" />
                    )}
                    <div className="flex items-center justify-between">
                      <Stars rating={i.rating} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{i.source}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {i.provider ?? "—"}
                      {i.judge_composite !== null && <> · judge {Number(i.judge_composite).toFixed(2)}</>}
                    </div>
                    {i.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {i.tags.slice(0, 4).map((t) => (
                          <span key={t} className={`border border-border px-1 py-0.5 text-[9px] ${t.startsWith("fail:") ? "text-red-600" : "text-muted-foreground"}`}>{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="text-right text-[11px] text-muted-foreground">
            Spend scoped to this cell (judge only so far): ${(data.total_cost_cents / 100).toFixed(2)}
          </div>
        </>
      )}
    </div>
  );
}
