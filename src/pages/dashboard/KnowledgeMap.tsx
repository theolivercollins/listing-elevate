import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { DashboardButton } from "@/v2/components/dashboard/DashboardButton";
import "@/v2/styles/v2.css";
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

type State = "untested" | "weak" | "okay" | "strong" | "golden";

const STATE_COLOR: Record<State, { bg: string; fg: string; cell: string }> = {
  untested: { bg: "var(--le-bg-sunken)", fg: "var(--le-text-muted)", cell: "var(--le-bg-sunken)" },
  weak:     { bg: "var(--le-danger-soft)", fg: "var(--le-danger)", cell: "var(--le-danger-soft)" },
  okay:     { bg: "var(--le-warn-soft)", fg: "var(--le-warn)", cell: "var(--le-warn-soft)" },
  strong:   { bg: "var(--le-success-soft)", fg: "var(--le-success)", cell: "var(--le-success-soft)" },
  golden:   { bg: "var(--le-info-soft)", fg: "var(--le-info)", cell: "var(--le-info-soft)" },
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
    <div
      className="le-card"
      style={{ padding: "18px 20px" }}
    >
      <div className="le-eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="le-mono"
        style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--le-text)" }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--le-text-muted)" }}>{sub}</div>
      )}
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
    <div className="le-root" style={{ background: "transparent", padding: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

        {/* Page header */}
        <div>
          <div className="le-eyebrow" style={{ marginBottom: 8 }}>Studio / Dev</div>
          <h1
            className="le-display"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 500, color: "var(--le-text)", margin: 0 }}
          >
            Knowledge Map
          </h1>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--le-text-muted)", maxWidth: 560 }}>
            Per-cell ML coverage: untested · weak · okay · strong · golden.
            Click any cell to see the iterations, recipes, overrides, and fail-tag patterns backing it.
          </p>
        </div>

        {/* Coverage counts */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          <StatBlock label="Golden cells" value={String(counts.golden ?? 0)} sub="≥ 2 five-star ratings — 10/10 ready" />
          <StatBlock label="Strong cells" value={String(counts.strong ?? 0)} sub="avg rating ≥ 4.0" />
          <StatBlock label="Weak + losers" value={String(counts.weak ?? 0)} sub="avg ≤ 2 or half losers" />
          <StatBlock label="Untested" value={String(counts.untested ?? 0)} sub="zero rated iterations" />
        </div>

        {/* Calibration + cost */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
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

        {/* Legend + refresh */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {(["untested", "weak", "okay", "strong", "golden"] as const).map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[11px]"
                style={{ background: STATE_COLOR[s].bg, color: STATE_COLOR[s].fg, borderColor: STATE_COLOR[s].fg + "40" }}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOR[s].fg }} />
                {STATE_LABEL[s]}
              </span>
            ))}
          </div>
          <DashboardButton variant="ghost" size="sm" onClick={reload} disabled={loading}
            leftIcon={loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          >
            Refresh
          </DashboardButton>
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

        {/* Grid */}
        <div
          className="le-card le-scroll"
          style={{ overflowX: "auto", borderRadius: "var(--le-r-lg)", padding: 0 }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky", left: 0, zIndex: 10,
                    width: 160, background: "var(--le-bg-elev)",
                    padding: "8px 10px", textAlign: "left",
                    color: "var(--le-text-muted)",
                    borderBottom: "1px solid var(--le-border)",
                  }}
                >
                  room \ verb
                </th>
                {COLS.map((verb) => (
                  <th
                    key={verb}
                    style={{
                      background: "var(--le-bg-elev)",
                      padding: "8px 10px",
                      textAlign: "left",
                      color: "var(--le-text-muted)",
                      whiteSpace: "nowrap",
                      borderLeft: "1px solid var(--le-border)",
                      borderBottom: "1px solid var(--le-border)",
                    }}
                  >
                    {verb}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((room) => (
                <tr key={room} style={{ borderTop: "1px solid var(--le-border)" }}>
                  <th
                    style={{
                      position: "sticky", left: 0, zIndex: 10,
                      width: 160, background: "var(--le-bg-elev)",
                      padding: "8px 10px", textAlign: "left",
                      fontWeight: 500, whiteSpace: "nowrap",
                      color: "var(--le-text)",
                    }}
                  >
                    {room}
                  </th>
                  {COLS.map((verb) => {
                    const key = `${room}-${verb}`;
                    const c = cellLookup.get(key);
                    const state = (c?.state ?? "untested") as State;
                    const colors = STATE_COLOR[state] ?? STATE_COLOR.untested;
                    return (
                      <td
                        key={key}
                        style={{ borderLeft: "1px solid var(--le-border)", padding: 0 }}
                      >
                        <Link
                          to={`/dashboard/dev/knowledge-map/${encodeURIComponent(key)}`}
                          className="block h-14 w-full px-2 py-2 transition-opacity hover:opacity-80"
                          style={{ background: colors.cell, color: colors.fg }}
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
    </div>
  );
}
