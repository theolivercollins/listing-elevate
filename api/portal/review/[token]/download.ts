import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { createSignedDownloadUrl } from "../../../../lib/portal/storage.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "session required" });
  const supabase = getSupabase();
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.slice(7));
  if (userErr || !userData.user) return res.status(401).json({ error: "invalid session" });

  const { data: deliv } = await supabase
    .from("portal_deliverables")
    .select(`
      id, title,
      order:portal_orders(id, status, customer_id),
      versions:portal_deliverable_versions(id, version, storage_path, file_name, upload_status)
    `)
    .eq("review_token", token)
    .maybeSingle();
  if (!deliv) return res.status(404).json({ error: "not found" });
  const order = deliv.order as { status: string; customer_id: string };
  if (order.status !== "paid") return res.status(403).json({ error: "not paid" });

  const { data: cust } = await supabase
    .from("portal_customers").select("user_id").eq("id", order.customer_id).single();
  if (cust?.user_id !== userData.user.id) return res.status(403).json({ error: "not customer" });

  const latest = (deliv.versions as { id: string; version: number; storage_path: string; file_name: string; upload_status: string }[])
    .filter((v) => v.upload_status === "uploaded")
    .sort((a, b) => b.version - a.version)[0];
  if (!latest) return res.status(404).json({ error: "no version" });

  const url = await createSignedDownloadUrl(supabase, latest.storage_path, latest.file_name);
  res.setHeader("Location", url);
  return res.status(302).end();
}
