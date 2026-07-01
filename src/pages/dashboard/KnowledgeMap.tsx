import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import {
  fetchCells,
  fetchCalibrationStatus,
  fetchCostRollup,
  type CalibrationStatusSummary,
} from "@/lib/knowledgeMapApi";
import type { CellSummary } from "../../../lib/knowledge-map/types.js";
import { PageHeading, KpiCard, Card } from "@/components/dashboard/primitives";

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

// Cell state → visual colors using design token vars
const STATE_BG: Record<string, string> = {
  untested: "var(--line-2)",
  weak:     "color-mix(in srgb, var(--bad) 15%, transparent)",
  okay:     "color-mix(in srgb, var(--warn) 15%, transparent)",
  strong:   "color-mix(in srgb, var(--good) 15%, transparent)",
  golden:   "color-mix(in srgb, var(--warn) 55%, transparent)",
};
const STATE_TEXT: Record<string, string> = {
  untested: "var(--muted)",
  weak:     "var(--bad)",
  okay:     "var(--warn)",
  strong:   "var(--good)",
  golden:   "var(--ink)",
};
const STATE_LABEL: Record<string, string> = {
  untested: "Untested",
  weak: "Weak",
  okay: "Okay",
  strong: "Strong",
  golden: "Golden",
};

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
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeading
        eyebrow="Lab · Knowledge map"
        title="Machine learning coverage"
        sub={`Every ${ROWS.length}×${COLS.length} = 168 scene cell (room type × camera verb) colored by its learning state. Click any cell to see the iterations, recipes, overrides, and fail-tag patterns backing that cell.`}
        actions={
          <button
            type="button"
            className="le-btn-ghost"
            onClick={reload}
            disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 500 }}
          >
            {loading
              ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
              : <RefreshCw style={{ width: 12, height: 12 }} />}
            Refresh
          </button>
        }
      />

      {/* KPI strip */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <KpiCard label="Golden cells" value={String(counts.golden ?? 0)} sub="at least 2 five-star ratings" />
        <KpiCard label="Strong cells" value={String(counts.strong ?? 0)} sub="avg rating at least 4.0" />
        <KpiCard label="Weak + losers" value={String(counts.weak ?? 0)} sub="avg 2 or below, or half losers" />
        <KpiCard label="Untested" value={String(counts.untested ?? 0)} sub="zero rated iterations" />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <KpiCard
          label="Judge calibration"
          value={calibration ? `${Math.round((calibration.overall_within_one_star ?? 0) * 100)}%` : "—"}
          sub={
            calibration
              ? `${calibration.cells_auto} auto / ${calibration.cells_advisory} advisory`
              : "Not calibrated yet"
          }
        />
        <KpiCard
          label="Spend · last 30 days"
          value={costTotalCents !== null ? `$${(costTotalCents / 100).toFixed(2)}` : "—"}
          sub="All providers, all stages"
        />
        <KpiCard
          label="Judge overhead · 30 days"
          value={judgeCostCents !== null ? `$${(judgeCostCents / 100).toFixed(2)}` : "—"}
          sub="Claude rubric judge calls"
        />
      </section>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            background: "color-mix(in srgb, var(--bad) 6%, transparent)",
            border: "1px solid color-mix(in srgb, var(--bad) 20%, transparent)",
            color: "var(--bad)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Legend + state key */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {(["untested", "weak", "okay", "strong", "golden"] as const).map((s) => (
          <span
            key={s}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: "var(--radius-pill)",
              fontSize: 11.5,
              fontWeight: 500,
              background: STATE_BG[s],
              color: STATE_TEXT[s],
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "var(--radius-pill)",
                background: "currentColor",
              }}
            />
            {STATE_LABEL[s]}
          </span>
        ))}
      </div>

      {/* Matrix */}
      <Card padding={0} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 10,
                    width: 148,
                    background: "var(--surface)",
                    padding: "10px 14px",
                    textAlign: "left",
                    color: "var(--muted)",
                    fontWeight: 500,
                    borderBottom: "1px solid var(--line-2)",
                  }}
                >
                  room \ verb
                </th>
                {COLS.map((verb) => (
                  <th
                    key={verb}
                    style={{
                      borderLeft: "1px solid var(--line-2)",
                      borderBottom: "1px solid var(--line-2)",
                      background: "var(--surface)",
                      padding: "10px 10px",
                      textAlign: "left",
                      color: "var(--muted)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {verb}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((room) => (
                <tr key={room} style={{ borderTop: "1px solid var(--line-2)" }}>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 10,
                      width: 148,
                      background: "var(--surface)",
                      padding: "10px 14px",
                      textAlign: "left",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      color: "var(--ink-2)",
                    }}
                  >
                    {room}
                  </th>
                  {COLS.map((verb) => {
                    const key = `${room}-${verb}`;
                    const c = cellLookup.get(key);
                    const state = c?.state ?? "untested";
                    return (
                      <td
                        key={key}
                        style={{ borderLeft: "1px solid var(--line-2)", padding: 0 }}
                      >
                        <Link
                          to={`/dashboard/development/knowledge-map/${encodeURIComponent(key)}`}
                          style={{
                            display: "block",
                            height: 56,
                            padding: "8px 10px",
                            background: STATE_BG[state] ?? STATE_BG.untested,
                            color: STATE_TEXT[state] ?? STATE_TEXT.untested,
                            textDecoration: "none",
                            transition: "opacity .15s",
                          }}
                          title={
                            c
                              ? `${c.sample_size} samples · avg ${c.avg_rating ?? "—"} · ${STATE_LABEL[state]}`
                              : STATE_LABEL[state]
                          }
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              fontSize: 10,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            <span>{c?.sample_size ?? 0}</span>
                            {c?.five_star_count ? (
                              <span style={{ fontWeight: 600 }}>★{c.five_star_count}</span>
                            ) : null}
                          </div>
                          {c?.avg_rating !== null && c?.avg_rating !== undefined && (
                            <div style={{ marginTop: 2, fontSize: 10, opacity: 0.8 }}>
                              avg {Number(c.avg_rating).toFixed(1)}
                            </div>
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
      </Card>
    </div>
  );
}
