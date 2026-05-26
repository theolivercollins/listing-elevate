// GET /api/gen2/lab/audit-log?label_id=X
// Returns the label + hash_match flags via telemetry.fetchAuditTrail.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";

// TODO: import { fetchAuditTrail } from "../../../lib/gen2-v21/telemetry/index.js";
// Stub until telemetry subagent ships:
async function fetchAuditTrail(
  labelId: string,
  supabase: ReturnType<typeof getSupabase>
): Promise<{
  label: Record<string, unknown>;
  hash_match_a: boolean;
  hash_match_b: boolean;
  prediction_record: Record<string, unknown> | null;
  outcome_record: Record<string, unknown> | null;
}> {
  // Minimal stub: fetch label + cross-check against persisted predictions
  const { data: label, error } = await supabase
    .from("gen2_pair_labels")
    .select("*")
    .eq("label_id", labelId)
    .single();

  if (error || !label) {
    throw new Error(`Label ${labelId} not found`);
  }

  const { data: prediction } = await supabase
    .from("gen2_apprentice_predictions")
    .select("*")
    .eq("candidate_id", label.candidate_id ?? "")
    .maybeSingle();

  const { data: outcome } = await supabase
    .from("gen2_render_outcomes")
    .select("*")
    .eq("pair_label_id", labelId)
    .maybeSingle();

  // Hash match flags: compare stored thumbnail_hash against any later re-fetch
  // Full implementation in telemetry subagent — here we emit true as placeholder
  return {
    label: label as Record<string, unknown>,
    hash_match_a: true, // TODO: implement hash verification in telemetry/audit-log.ts
    hash_match_b: true,
    prediction_record: prediction as Record<string, unknown> | null,
    outcome_record: outcome as Record<string, unknown> | null,
  };
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

  const label_id = req.query.label_id as string | undefined;
  if (!label_id) {
    return res.status(400).json({ error: "label_id is required" });
  }

  const supabase = getSupabase();

  try {
    const trail = await fetchAuditTrail(label_id, supabase);
    return res.status(200).json(trail);
  } catch (err) {
    console.error("[audit-log] error:", err);
    const message = String(err);
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return res.status(500).json({ error: "Failed to fetch audit trail", detail: message });
  }
}
