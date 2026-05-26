// GET  /api/gen2/lab/mode-state               — returns current mode + recommended
// POST /api/gen2/lab/mode-state  { mode }     — sets manual override
// State is persisted to gen2_lab_state keyed by (listing_id|null for global).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { LabMode, ModeState } from "../../../lib/gen2-v21/types.js";

const VALID_MODES: LabMode[] = ["directors_cut", "apprentice_review", "autopilot"];

function computeRecommendedMode(totalLabels: number, agreementRate: number): LabMode {
  if (totalLabels < 10) return "directors_cut";
  if (agreementRate >= 0.9 && totalLabels >= 50) return "autopilot";
  if (agreementRate >= 0.7 && totalLabels >= 10) return "apprentice_review";
  return "directors_cut";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  if (req.method === "GET") {
    return handleGet(req, res);
  }
  if (req.method === "POST") {
    return handlePost(req, res, auth.user.id);
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const listingId = req.query.listing_id as string | undefined;
  const supabase = getSupabase();

  try {
    let stateQuery = supabase
      .from("gen2_lab_state")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (listingId) {
      stateQuery = stateQuery.eq("listing_id", listingId);
    } else {
      stateQuery = stateQuery.is("listing_id", null);
    }

    const { data: stateRows } = await stateQuery;
    const stateRow = stateRows?.[0];

    // Fetch label stats for recommendation
    let labelCountQuery = supabase
      .from("gen2_pair_labels")
      .select("label_id, apprentice_was_wrong", { count: "exact" });

    if (listingId) {
      labelCountQuery = labelCountQuery.eq("listing_id", listingId);
    }

    const { data: recentLabels, count: totalCount } = await labelCountQuery
      .order("created_at", { ascending: false })
      .limit(50);

    const totalLabels = totalCount ?? 0;

    // Compute rolling agreement on last 20 with predictions
    const withPrediction = (recentLabels ?? [])
      .slice(0, 20)
      .filter((l) => l.apprentice_was_wrong !== null);

    const agreementRate =
      withPrediction.length > 0
        ? withPrediction.filter((l) => !l.apprentice_was_wrong).length / withPrediction.length
        : 0;

    const currentMode: LabMode = (stateRow?.current_mode as LabMode) ?? "directors_cut";
    const recommendedMode = computeRecommendedMode(totalLabels, agreementRate);

    const modeState: ModeState = {
      listing_id: listingId ?? null,
      current_mode: currentMode,
      apprentice_agreement_rate: agreementRate,
      total_labels: totalLabels,
      recommended_mode: recommendedMode,
      updated_at: stateRow?.updated_at ?? new Date().toISOString(),
    };

    return res.status(200).json(modeState);
  } catch (err) {
    console.error("[mode-state] GET error:", err);
    return res.status(500).json({ error: "Failed to fetch mode state", detail: String(err) });
  }
}

async function handlePost(
  req: VercelRequest,
  res: VercelResponse,
  userId: string
) {
  const { mode, listing_id: listingId } = (req.body ?? {}) as { mode?: LabMode; listing_id?: string };

  if (!mode) {
    return res.status(400).json({ error: "mode is required" });
  }
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${VALID_MODES.join(", ")}` });
  }

  const supabase = getSupabase();

  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("gen2_lab_state")
      .upsert(
        {
          listing_id: listingId ?? null,
          current_mode: mode,
          manual_override: true,
          updated_by: userId,
          updated_at: now,
        },
        { onConflict: "listing_id" }
      )
      .select()
      .single();

    if (error) {
      console.error("[mode-state] POST upsert error:", error);
      return res.status(500).json({ error: "Failed to update mode", detail: error.message });
    }

    return res.status(200).json({
      current_mode: data.current_mode,
      listing_id: data.listing_id ?? null,
      manual_override: true,
      updated_at: now,
    });
  } catch (err) {
    console.error("[mode-state] POST error:", err);
    return res.status(500).json({ error: "Failed to set mode", detail: String(err) });
  }
}
