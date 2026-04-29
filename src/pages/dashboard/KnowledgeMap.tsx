import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import "@/v2/styles/v2.css";

const EYEBROW: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(255,255,255,0.45)" };
const PAGE_H1: CSSProperties = { fontFamily: "var(--le-font-sans)", fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 0.98, color: "#fff", margin: 0 };
const MONO_VALUE: CSSProperties = { fontFamily: "var(--le-font-mono)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff" };
import {
  fetchCells,
  fetchCalibrationStatus,
  fetchCostRollup,
  type CalibrationStatusSummary,
} from "@/lib/knowledgeMapApi";
import type { CellSummary } from "../../../lib/knowledge-map/types.js";

type ByStateCounts = Record<string, number>;

const ROWS: string[] = [
  "kitchen", "living_room", "master_bedroom", "bedroom", "bathroom",
  "exterior_front", "exterior_back", "pool", "aerial", "dining",
  "hallway", "garage", "foyer", "other",
];
const COLS: string[] = [
  "push_in", "pull_out", "orbit", "parallax",
  "dolly_left_to_right", "dolly_right_to_left", "reveal",
  "drone_push_in", "drone_pull_back", "top_down",
  "low_angle_glide", "feature_closeup",
];

const STATE_COLOR: Record<string, string> = {
  untested: "bg-muted/50 text-muted-foreground",
  weak:     "bg-red-500/20 text-red-700 dark:text-red-300",
  okay:     "bg-amber-400/20 text-amber-700 dark:text-amber-300",
  strong:   "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  golden:   "bg-amber-300/80 text-amber-900 dark:text-amber-100 font-semibold",
};

const STATE_LABEL: Record<string, string> = {
  untested: "Untested",
  weak: "Weak",
  okay: "Okay",
  strong: "Strong",
  golden: "Golden",
};

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border bg-background p-4" style={{ borderRadius: 0 }}>
      <div style={EYEBROW}>{label}</div>
      <div className="mt-2" style={MONO_VALUE}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function KnowledgeMap() {
  const [cells, setCells] = useState<CellSummary[] | null>(null);
  const [counts, setCounts] = useState<ByStateCounts>({});
  const [calibration, setCalibration] = useState<CalibrationStatusSummary | null>(null);
  const [costTotalCents, setCostTotalCents] = useState<number | null>(null);
  const [judgeCostCents, setJudgeCostCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [cellsResp, calResp, costResp] = await Promise.all([
        fetchCells(),
        fetchCalibrationStatus().catch(() => null),
        fetchCostRollup(30).catch(() => null),
      ]);
      setCells(cellsResp.cells);
      setCounts(cellsResp.summary.by_state);
      setCalibration(calResp?.summary ?? null);
      setCostTotalCents(costResp?.total_cents ?? null);
      setJudgeCostCents(costResp?.judge_total_cents ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const cellLookup = useMemo(() => {
    const m = new Map<string, CellSummary>();
    for (const c of cells ?? []) m.set(c.cell_key, c);
    return m;
  }, [cells]);

  return (
    <div className="space-y-10">
      <div>
        <span style={EYEBROW}>— Knowledge Map</span>
        <h2 className="mt-3 flex items-center gap-3" style={PAGE_H1}>
          <MapIcon className="h-6 w-6 text-muted-foreground" />
          Machine learning coverage at a glance
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Every {ROWS.length}×{COLS.length} = 168 scene cell (room type × camera verb) colored by its learning state.
          Click any cell to see the iterations, recipes, overrides, and fail-tag patterns backing that cell.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <StatBlock label="Golden cells" value={String(counts.golden ?? 0)} sub="≥ 2 five-star ratings — 10/10 ready" />
        <StatBlock label="Strong cells" value={String(counts.strong ?? 0)} sub="avg rating ≥ 4.0" />
        <StatBlock label="Weak + losers" value={String(counts.weak ?? 0)} sub="avg ≤ 2 or half losers" />
        <StatBlock label="Untested" value={String(counts.untested ?? 0)} sub="zero rated iterations" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatBlock
          label="Judge calibration"
          value={calibration ? `${Math.round((calibration.overall_within_one_star ?? 0) * 100)}%` : "—"}
          sub={calibration ? `${calibration.cells_auto} auto / ${calibration.cells_advisory} advisory` : "Not calibrated yet"}
        />
        <StatBlock
          label="Spend, last 30 days"
          value={costTotalCents !== null ? `$${(costTotalCents / 100).toFixed(2)}` : "—"}
          sub="All providers, all stages"
        />
        <StatBlock
          label="Judge overhead, last 30 days"
          value={judgeCostCents !== null ? `$${(judgeCostCents / 100).toFixed(2)}` : "—"}
          sub="Claude rubric judge calls"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {(["untested", "weak", "okay", "strong", "golden"] as const).map((s) => (
            <span key={s} className={`inline-flex items-center gap-2 border border-border px-2 py-1 text-[11px] ${STATE_COLOR[s]}`}>
              <span className={`inline-block h-2 w-2 ${STATE_COLOR[s].split(" ")[0]}`} />
              {STATE_LABEL[s]}
            </span>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="overflow-x-auto border border-border">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-40 bg-background p-2 text-left text-muted-foreground">room \ verb</th>
              {COLS.map((verb) => (
                <th key={verb} className="border-l border-border bg-background p-2 text-left text-muted-foreground whitespace-nowrap">
                  {verb}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((room) => (
              <tr key={room} className="border-t border-border">
                <th className="sticky left-0 z-10 w-40 bg-background p-2 text-left font-medium whitespace-nowrap">{room}</th>
                {COLS.map((verb) => {
                  const key = `${room}-${verb}`;
                  const c = cellLookup.get(key);
                  const state = c?.state ?? "untested";
                  const bg = STATE_COLOR[state] ?? STATE_COLOR.untested;
                  return (
                    <td key={key} className="border-l border-border p-0">
                      <Link
                        to={`/dashboard/development/knowledge-map/${encodeURIComponent(key)}`}
                        className={`block h-14 w-full px-2 py-2 transition-opacity hover:opacity-80 ${bg}`}
                        title={c ? `${c.sample_size} samples · avg ${c.avg_rating ?? "—"} · ${STATE_LABEL[state]}` : STATE_LABEL[state]}
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span>{c?.sample_size ?? 0}</span>
                          {c?.five_star_count ? <span className="font-semibold">★{c.five_star_count}</span> : null}
                        </div>
                        {c?.avg_rating !== null && c?.avg_rating !== undefined && (
                          <div className="mt-1 text-[10px] opacity-80">avg {Number(c.avg_rating).toFixed(1)}</div>
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
