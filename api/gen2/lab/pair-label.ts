// POST /api/gen2/lab/pair-label
// Inserts a gen2_pair_labels row with FK validation.
// Triggers picker retrain at every-10-label boundary.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import type { Verdict, TransitionTag, PickerFeatures } from "../../../lib/gen2-v21/types.js";
import { shouldRetrain, trainAndPersist } from "../../../lib/gen2-v21/picker/index.js";

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
  /** Pre-computed PickerFeatures captured by the UI at label time. If provided,
   *  persisted to features_blob so retrain-trigger can use it immediately. */
  features_blob?: PickerFeatures | null;
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

    // Derive picker training target from verdict: good→1, bad→0, tie→null (excluded from training)
    const target: 0 | 1 | null =
      body.operator_verdict === "good" ? 1
      : body.operator_verdict === "bad" ? 0
      : null;

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
        features_blob: body.features_blob ?? null,
        target,
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

    // Fetch the label count at the time of the last trained model
    const { data: lastModel } = await supabase
      .from("gen2_picker_models")
      .select("label_count_at_train")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastTrainedAtCount = (lastModel?.label_count_at_train as number | null) ?? 0;

    if (shouldRetrain(totalLabels, lastTrainedAtCount)) {
      // Fire-and-forget retrain — don't block the response
      // trainAndPersist expects (supabase, labelsQuery) where labelsQuery returns LabelRow[]
      const capturedSupabase = supabase;
      trainAndPersist(capturedSupabase as Parameters<typeof trainAndPersist>[0], async () => {
        const { data } = await capturedSupabase
          .from("gen2_pair_labels")
          .select("label_id, listing_id, features_blob, target")
          // Exclude tie verdicts (target=null) and labels inserted before migration 074
          // that have no features_blob — both would corrupt the training gradient.
          .not("target", "is", null)
          .not("features_blob", "is", null);
        return (data ?? []) as Array<{
          label_id: string;
          listing_id: string;
          features_blob: PickerFeatures;
          target: 0 | 1;
        }>;
      }).catch((err) =>
        console.error("[pair-label] picker retrain failed:", err)
      );
    }

    return res.status(201).json({ label_id: inserted!.label_id, total_labels: totalLabels });
  } catch (err) {
    console.error("[pair-label] error:", err);
    return res.status(500).json({ error: "Failed to save label", detail: String(err) });
  }
}
