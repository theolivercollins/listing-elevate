// GET /api/gen2/lab/observability?listing_id=X (optional; defaults to global)
// Returns rolling accuracy, top features, apprentice agreement, mode state, cold-start countdown.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { LabMode } from "../../../lib/gen2-v21/types.js";

// TODO: integrate with telemetry/rolling-accuracy.ts, telemetry/feature-importance.ts,
//       apprentice/agreement-tracker.ts, and apprentice/mode-switcher.ts
// once those subagents ship. Current implementation is a direct SQL aggregation.

const COLD_START_THRESHOLD = 20; // labels needed before LightGBM takes over

function computeRecommendedMode(
  totalLabels: number,
  apprenticeAgreement: number
): LabMode {
  if (totalLabels < 10) return "directors_cut";
  if (apprenticeAgreement >= 0.9 && totalLabels >= 50) return "autopilot";
  if (apprenticeAgreement >= 0.7 && totalLabels >= 10) return "apprentice_review";
  return "directors_cut";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const listingId = req.query.listing_id as string | undefined;
  const supabase = getSupabase();

  try {
    // ── Label counts ──
    let labelQuery = supabase
      .from("gen2_pair_labels")
      .select("label_id, operator_verdict, apprentice_predicted_verdict, apprentice_was_wrong, source_mode, created_at", { count: "exact" });

    if (listingId) {
      labelQuery = labelQuery.eq("listing_id", listingId);
    }

    const { data: allLabels, count: totalLabels } = await labelQuery
      .order("created_at", { ascending: false })
      .limit(200); // enough for rolling windows

    const labels = allLabels ?? [];
    const total = totalLabels ?? labels.length;

    // ── Rolling accuracy helper ──
    function computeRollingAccuracy(n: number): number | null {
      const window = labels.slice(0, n);
      const withPrediction = window.filter((l) => l.apprentice_predicted_verdict != null);
      if (withPrediction.length === 0) return null;
      const correct = withPrediction.filter((l) => !l.apprentice_was_wrong).length;
      return correct / withPrediction.length;
    }

    const rollingAccuracy20 = computeRollingAccuracy(20);
    const rollingAccuracy50 = computeRollingAccuracy(50);
    const rollingAccuracy100 = computeRollingAccuracy(100);

    // ── Apprentice agreement (last 20) ──
    const recentWithPrediction = labels
      .slice(0, 20)
      .filter((l) => l.apprentice_predicted_verdict != null);
    const apprenticeAgreement20 =
      recentWithPrediction.length > 0
        ? recentWithPrediction.filter((l) => !l.apprentice_was_wrong).length /
          recentWithPrediction.length
        : 0;

    // ── Current mode from gen2_lab_state ──
    let modeQuery = supabase
      .from("gen2_lab_state")
      .select("current_mode, manual_override")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (listingId) {
      modeQuery = modeQuery.eq("listing_id", listingId);
    } else {
      modeQuery = modeQuery.is("listing_id", null);
    }

    const { data: modeRows } = await modeQuery;
    const currentMode: LabMode = (modeRows?.[0]?.current_mode as LabMode) ?? "directors_cut";

    // ── Top features (from latest picker model) ──
    // TODO: fetch real feature importances from telemetry/feature-importance.ts
    const topFeatures: Array<{ name: string; weight: number }> = [];

    const { data: latestModel } = await supabase
      .from("gen2_picker_models")
      .select("accuracy_held_out, label_count_at_train, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Recommended mode ──
    const recommendedMode = computeRecommendedMode(total, apprenticeAgreement20);

    // ── Cold-start countdown ──
    const coldStartCountdown = Math.max(0, COLD_START_THRESHOLD - total);

    return res.status(200).json({
      rollingAccuracy20,
      rollingAccuracy50,
      rollingAccuracy100,
      topFeatures,
      apprenticeAgreement20,
      totalLabels: total,
      currentMode,
      recommendedMode,
      coldStartCountdown,
      latestModel: latestModel
        ? {
            accuracy: latestModel.accuracy_held_out,
            trainedOnLabels: latestModel.label_count_at_train,
            trainedAt: latestModel.created_at,
          }
        : null,
      listing_id: listingId ?? null,
    });
  } catch (err) {
    console.error("[observability] error:", err);
    return res.status(500).json({ error: "Failed to compute observability metrics", detail: String(err) });
  }
}
