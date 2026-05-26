// GET /api/gen2/lab/audit-log?label_id=X
// Returns the label + hash_match flags via telemetry.fetchAuditTrail.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/db.js";
import { fetchAuditTrail } from "../../../lib/gen2-v21/telemetry/index.js";

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
    const trail = await fetchAuditTrail(supabase, label_id);
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
