import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();
  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select("id, order_id, order:portal_orders(id, status, customer_id, owner_id)")
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  if (req.method === "GET") {
    const { data: comments } = await supabase
      .from("portal_comments")
      .select("id, version_id, kind, body, video_timestamp_seconds, author_first_name, author_last_name, created_at")
      .eq("deliverable_id", deliv.id)
      .order("created_at", { ascending: true });
    return res.json({ comments: comments ?? [] });
  }

  if (req.method === "POST") {
    // Session required for writes
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
    const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
    if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

    // Authorize: user must be the order owner OR the customer.user_id
    const order = deliv.order as { id: string; status: OrderStatus; customer_id: string; owner_id: string };
    const { data: cust } = await supabase
      .from("portal_customers").select("user_id, first_name, last_name, email").eq("id", order.customer_id).single();
    const isOwner = order.owner_id === userData.user.id;
    const isCustomer = cust?.user_id === userData.user.id;
    if (!isOwner && !isCustomer) return res.status(403).json({ error: "not authorized" });

    const body = (req.body ?? {}) as { body?: string; video_timestamp_seconds?: number; kind?: "comment" | "revision_request"; version_id?: string };
    const kind = body.kind ?? "comment";
    if (!body.body || !body.body.trim()) return res.status(400).json({ error: "body required" });
    if (!body.version_id) return res.status(400).json({ error: "version_id required" });

    // Author name: use the customer's name if customer; the user's email-derived name if owner.
    const author_first_name = isCustomer ? cust!.first_name : "Owner";
    const author_last_name = isCustomer ? cust!.last_name : "";
    const author_email = isCustomer ? cust!.email : (userData.user.email ?? "");

    const { data: inserted, error: insErr } = await supabase
      .from("portal_comments")
      .insert({
        deliverable_id: deliv.id,
        version_id: body.version_id,
        author_user_id: userData.user.id,
        author_first_name, author_last_name, author_email,
        kind, body: body.body.trim(),
        video_timestamp_seconds: typeof body.video_timestamp_seconds === "number" ? body.video_timestamp_seconds : null,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return res.status(500).json({ error: insErr?.message ?? "insert failed" });

    // If revision_request: advance order state
    if (kind === "revision_request") {
      try {
        const next = computeNextOrderStatus(order.status, "revision_requested");
        await supabase.from("portal_orders").update({ status: next }).eq("id", order.id);
      } catch (e) {
        // Illegal transition (e.g. revision requested twice without an upload in between). Leave state as-is.
        console.warn("[comments POST] revision transition skipped", e);
      }
    }

    // (Notification wiring is added in Task 22 once lib/portal/notifications.ts lands.
    //  The endpoint must not block on notifications — they fire-and-forget.)

    return res.status(201).json({ comment_id: inserted.id });
  }

  return res.status(405).json({ error: "method not allowed" });
}
