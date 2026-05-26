// POST /api/gen2/lab/pair-label
// Inserts a gen2_pair_labels row with FK validation.
// Triggers picker retrain at every-10-label boundary.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { Verdict, TransitionTag } from "../../../lib/gen2-v21/types.js";

// TODO: import { shouldRetrain, trainAndPersist } from "../../../lib/gen2-v21/picker/index.js";
// Stubs until picker subagent ships:
async function shouldRetrain(_totalLabels: number): Promise<boolean> {
  // Trigger every 10 labels
  return _totalLabels > 0 && _totalLabels % 10 === 0;
}
async function trainAndPersist(_listingId: string): Promise<void> {
  console.warn("TODO: picker subagent not yet integrated — import from lib/gen2-v21/picker/index.js");
}

interface PairLabelBody {
  listing_id?: string;
  photo_a_id?: string;
  photo_b_id?: string;
  candidate_id?: string;
  operator_verdict?: Verdict;
  transition_tag?: TransitionTag;
  thumbnail_hash_a?: string;
  thumbnail_hash_b?: string;
  source_mode?: "directors_cut" | "apprentice_review" | "autopilot_audit";
  apprentice_predicted_verdict?: Verdict | null;
  model_prediction_at_time?: number | null;
  model_version_at_prediction?: string | null;
  scene_graph_version?: string;
}

const VALID_VERDICTS: Verdict[] = ["good", "bad", "tie"];
const VALID_SOURCE_MODES = ["directors_cut", "apprentice_review", "autopilot_audit"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return res.status(404).json({ error: "Not found" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const body = (req.body ?? {}) as PairLabelBody;

  // Validate required fields
  const required: (keyof PairLabelBody)[] = [
    "listing_id",
    "photo_a_id",
    "photo_b_id",
    "operator_verdict",
    "thumbnail_hash_a",
    "thumbnail_hash_b",
    "source_mode",
    "scene_graph_version",
  ];
  for (const field of required) {
    if (body[field] == null || body[field] === "") {
      return res.status(400).json({ error: `${field} is required` });
    }
  }

  if (!VALID_VERDICTS.includes(body.operator_verdict!)) {
    return res.status(400).json({ error: `operator_verdict must be one of: ${VALID_VERDICTS.join(", ")}` });
  }
  if (!VALID_SOURCE_MODES.includes(body.source_mode! as (typeof VALID_SOURCE_MODES)[number])) {
    return res.status(400).json({ error: `source_mode must be one of: ${VALID_SOURCE_MODES.join(", ")}` });
  }

  const supabase = getSupabase();

  try {
    // FK validation: verify listing exists
    const { data: listing, error: listingErr } = await supabase
      .from("properties")
      .select("id")
      .eq("id", body.listing_id!)
      .single();

    if (listingErr || !listing) {
      return res.status(400).json({ error: "listing_id does not reference a valid property" });
    }

    // Compute apprentice_was_wrong if we have both verdicts
    let apprentice_was_wrong: boolean | null = null;
    if (body.apprentice_predicted_verdict != null) {
      apprentice_was_wrong = body.apprentice_predicted_verdict !== body.operator_verdict;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("gen2_pair_labels")
      .insert({
        listing_id: body.listing_id!,
        photo_a_id: body.photo_a_id!,
        photo_b_id: body.photo_b_id!,
        candidate_id: body.candidate_id ?? null,
        scene_graph_version: body.scene_graph_version!,
        model_version_at_prediction: body.model_version_at_prediction ?? null,
        model_prediction_at_time: body.model_prediction_at_time ?? null,
        operator_verdict: body.operator_verdict!,
        transition_tag: body.transition_tag ?? null,
        thumbnail_hash_a: body.thumbnail_hash_a!,
        thumbnail_hash_b: body.thumbnail_hash_b!,
        source_mode: body.source_mode!,
        apprentice_predicted_verdict: body.apprentice_predicted_verdict ?? null,
        apprentice_was_wrong,
        labeled_by: auth.user.id,
        created_at: new Date().toISOString(),
      })
      .select("label_id")
      .single();

    if (insertErr) {
      console.error("[pair-label] insert error:", insertErr);
      return res.status(500).json({ error: "Failed to insert label", detail: insertErr.message });
    }

    // Check if we should trigger a retrain (every 10 labels)
    const { count } = await supabase
      .from("gen2_pair_labels")
      .select("label_id", { count: "exact", head: true })
      .eq("listing_id", body.listing_id!);

    const totalLabels = count ?? 0;
    if (await shouldRetrain(totalLabels)) {
      // Fire-and-forget retrain — don't block the response
      trainAndPersist(body.listing_id!).catch((err) =>
        console.error("[pair-label] picker retrain failed:", err)
      );
    }

    return res.status(201).json({ label_id: inserted!.label_id, total_labels: totalLabels });
  } catch (err) {
    console.error("[pair-label] error:", err);
    return res.status(500).json({ error: "Failed to save label", detail: String(err) });
  }
}
