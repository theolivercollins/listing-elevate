import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../../../lib/db.js";
import { requireOwner } from "../../../../../../../lib/portal/auth.js";
import { verifyObjectExists } from "../../../../../../../lib/portal/storage.js";
import { markVersionUploaded } from "../../../../../../../lib/portal/deliverables.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../../../../lib/portal/state.js";
import { notifyClient } from "../../../../../../../lib/portal/notifications.js";

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

  // Email the client. v1 = first upload (order was awaiting_delivery, now delivered).
  // v2+ = subsequent upload (order was already delivered / in_review / revision_requested).
  try {
    if (refreshed?.status === "delivered") {
      const wasFirst = (order.status as OrderStatus) === "awaiting_delivery";
      const { data: delivRow } = await supabase
        .from("portal_deliverables")
        .select("review_token")
        .eq("id", did)
        .single();
      const { data: orderRow } = await supabase
        .from("portal_orders")
        .select("title, customer_id")
        .eq("id", orderId)
        .single();
      if (delivRow?.review_token && orderRow?.customer_id) {
        const { data: cust } = await supabase
          .from("portal_customers")
          .select("email")
          .eq("id", orderRow.customer_id)
          .single();
        if (cust?.email) {
          const reviewUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/review/${delivRow.review_token}`;
          await notifyClient(
            supabase,
            cust.email,
            wasFirst ? "deliverable_ready_v1" : "deliverable_ready_vn",
            {
              review_url: reviewUrl,
              order_title: orderRow.title ?? "your video",
            },
          );
        }
      }
    }
  } catch (e) {
    console.error("[finalize] notify client failed", e);
  }

  return res.json({ status: "uploaded", order_status: refreshed?.status });
}
