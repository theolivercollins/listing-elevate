import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { createSignedStreamUrl } from "../../../../lib/portal/storage.js";
import { computeNextOrderStatus, type OrderStatus } from "../../../../lib/portal/state.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();

  // Resolve deliverable → its order + versions + comments
  const { data: deliv, error: dErr } = await supabase
    .from("portal_deliverables")
    .select(`
      id, order_id, title, description, status, review_token, created_at,
      order:portal_orders(id, title, amount_cents, currency, status, customer_id),
      versions:portal_deliverable_versions(id, version, file_name, storage_path, upload_status, created_at),
      comments:portal_comments(id, version_id, kind, body, video_timestamp_seconds, author_first_name, author_last_name, created_at)
    `)
    .eq("review_token", token)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!deliv) return res.status(404).json({ error: "invalid link" });

  const uploadedVersions = (deliv.versions ?? [])
    .filter((v: { upload_status: string }) => v.upload_status === "uploaded")
    .sort((a: { version: number }, b: { version: number }) => a.version - b.version);
  if (uploadedVersions.length === 0) {
    return res.status(409).json({ error: "no uploaded versions yet" });
  }

  const latest = uploadedVersions[uploadedVersions.length - 1] as { id: string; version: number; storage_path: string };
  const stream_url = await createSignedStreamUrl(supabase, latest.storage_path);

  // First-view side effect: if order is `delivered`, flip to `in_review`.
  const order = deliv.order as { id: string; status: OrderStatus; title: string; amount_cents: number; currency: string };
  if (order.status === "delivered") {
    try {
      const next = computeNextOrderStatus("delivered", "client_opened");
      await supabase.from("portal_orders").update({ status: next }).eq("id", order.id);
    } catch { /* idempotent — ignore */ }
  }

  return res.json({
    deliverable: { id: deliv.id, title: deliv.title, description: deliv.description, status: deliv.status },
    order: { id: order.id, title: order.title, status: order.status, amount_cents: order.amount_cents, currency: order.currency },
    versions: uploadedVersions.map((v: { id: string; version: number; file_name: string; created_at: string }) => ({
      id: v.id, version: v.version, file_name: v.file_name, created_at: v.created_at,
    })),
    latest_version_id: latest.id,
    stream_url,
    comments: (deliv.comments ?? []).map((c: { id: string; version_id: string; kind: string; body: string | null; video_timestamp_seconds: number | null; author_first_name: string; author_last_name: string; created_at: string }) => ({
      id: c.id, version_id: c.version_id, kind: c.kind, body: c.body,
      video_timestamp_seconds: c.video_timestamp_seconds,
      author: `${c.author_first_name} ${c.author_last_name}`,
      created_at: c.created_at,
    })),
  });
}
