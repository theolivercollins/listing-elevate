import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../../lib/db.js";
import { createDeliverable } from "../../../../../lib/portal/deliverables.js";
import { requireOwner } from "../../../../../lib/portal/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const orderId = req.query.id as string;
  if (!orderId) return res.status(400).json({ error: "order id required" });

  const supabase = getSupabase();
  const ownerCheck = await requireOwner(req, supabase, orderId);
  if (!ownerCheck.ok) return res.status(ownerCheck.status).json({ error: ownerCheck.error });

  const { title } = (req.body ?? {}) as { title?: string };
  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "title required" });
  }

  try {
    const { id } = await createDeliverable(supabase, { orderId, title: title.trim() });
    return res.status(201).json({ deliverable_id: id });
  } catch (e) {
    console.error("[deliverables/create]", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
