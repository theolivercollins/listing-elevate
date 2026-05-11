import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../lib/portal/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  if (!orderId || !did) return res.status(400).json({ error: "ids required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  // Disallow delete if any version is uploaded — preserves audit trail.
  const { data: uploaded, error: vErr } = await supabase
    .from("portal_deliverable_versions")
    .select("id")
    .eq("deliverable_id", did)
    .eq("upload_status", "uploaded")
    .limit(1);
  if (vErr) return res.status(500).json({ error: vErr.message });
  if (uploaded && uploaded.length > 0) {
    return res.status(409).json({ error: "deliverable has uploaded versions; cannot delete" });
  }

  const { error: delErr } = await supabase
    .from("portal_deliverables")
    .delete()
    .eq("id", did)
    .eq("order_id", orderId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  return res.json({ ok: true });
}
