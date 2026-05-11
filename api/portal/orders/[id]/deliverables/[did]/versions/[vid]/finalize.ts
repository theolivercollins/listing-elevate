import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../../lib/portal/auth.js";
import { verifyObjectExists } from "../../../../../../../lib/portal/storage.js";
import { markVersionUploaded } from "../../../../../../../lib/portal/deliverables.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../../../../lib/portal/state.js";

const STATES_THAT_FLIP_ON_UPLOAD: OrderStatus[] = ["awaiting_delivery", "delivered", "in_review", "revision_requested"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  const did = req.query.did as string;
  const vid = req.query.vid as string;
  if (!orderId || !did || !vid) return res.status(400).json({ error: "ids required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  // Resolve version + verify it belongs to this deliverable + order
  const { data: ver, error: verErr } = await supabase
    .from("portal_deliverable_versions")
    .select("id, deliverable_id, storage_path, upload_status")
    .eq("id", vid)
    .maybeSingle();
  if (verErr) return res.status(500).json({ error: verErr.message });
  if (!ver || ver.deliverable_id !== did) return res.status(404).json({ error: "version not found" });
  if (ver.upload_status === "uploaded") return res.status(409).json({ error: "already finalized" });

  // Verify the object actually landed
  const exists = await verifyObjectExists(supabase, ver.storage_path);
  if (!exists) return res.status(409).json({ error: "object not found in storage" });

  await markVersionUploaded(supabase, vid);

  // Advance order state
  const { data: order, error: ordErr } = await supabase
    .from("portal_orders")
    .select("status")
    .eq("id", orderId)
    .single();
  if (ordErr || !order) return res.status(500).json({ error: ordErr?.message ?? "order missing" });

  if (STATES_THAT_FLIP_ON_UPLOAD.includes(order.status as OrderStatus)) {
    try {
      const next = computeNextOrderStatus(order.status as OrderStatus, "version_uploaded");
      if (next !== order.status) {
        const { error: updErr } = await supabase
          .from("portal_orders")
          .update({ status: next })
          .eq("id", orderId);
        if (updErr) return res.status(500).json({ error: updErr.message });
      }
    } catch (e) {
      // illegal transition — leave state as-is and log
      console.warn("[finalize] state transition skipped", e);
    }
  }

  const { data: refreshed } = await supabase
    .from("portal_orders").select("status").eq("id", orderId).single();

  return res.json({ status: "uploaded", order_status: refreshed?.status });
}
