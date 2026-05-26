// GET /api/gen2/lab/observability?listing_id=X (optional; defaults to global)
// Returns rolling accuracy, top features, apprentice agreement, mode state, cold-start countdown.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { LabMode } from "../../../lib/gen2-v21/types.js";
import { fetchTopFeatures, computeRollingAccuracy } from "../../../lib/gen2-v21/telemetry/index.js";

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
    // ── Label counts (for apprentice agreement + totals) ──
    let labelCountQuery = supabase
      .from("gen2_pair_labels")
      .select("label_id, apprentice_predicted_verdict, apprentice_was_wrong", { count: "exact" });

    if (listingId) {
      labelCountQuery = labelCountQuery.eq("listing_id", listingId);
    }

    const { data: allLabels, count: totalLabels } = await labelCountQuery
      .order("created_at", { ascending: false })
      .limit(200);

    const labels = allLabels ?? [];
    const total = totalLabels ?? labels.length;

    // ── Rolling accuracy via telemetry module ──
    const [ra20, ra50, ra100] = await Promise.all([
      computeRollingAccuracy(supabase, { listingId, lastN: 20 }).catch(() => null),
      computeRollingAccuracy(supabase, { listingId, lastN: 50 }).catch(() => null),
      computeRollingAccuracy(supabase, { listingId, lastN: 100 }).catch(() => null),
    ]);
    const rollingAccuracy20 = ra20 ? ra20.accuracy : null;
    const rollingAccuracy50 = ra50 ? ra50.accuracy : null;
    const rollingAccuracy100 = ra100 ? ra100.accuracy : null;

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

    // ── Top features from latest picker model via telemetry ──
    const featureSnapshots = await fetchTopFeatures(supabase, { activeOnly: true }).catch(() => []);
    const latestSnapshot = featureSnapshots[featureSnapshots.length - 1];
    const topFeatures: Array<{ name: string; weight: number }> = latestSnapshot
      ? Object.entries(latestSnapshot.top_features).map(([name, weight]) => ({ name, weight }))
      : [];

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
