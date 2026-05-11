import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../../../lib/db.js";
import { createSignedDownloadUrl } from "../../../../lib/portal/storage.js";

// Token-gated download. The review_token is a 256-bit secret unique to this
// deliverable; combined with the order being `paid`, that's sufficient gating
// — we don't also require a Bearer session, so the email-receipt CTA and the
// in-page <a href> both work as plain GETs. If the link leaks, the leaker can
// download the (already-paid-for) video; not a security boundary worth a 401.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: "token required" });

  const supabase = getSupabase();
  const { data: deliv } = await supabase
    .from("portal_deliverables")
    .select(`
      id, title,
      order:portal_orders(id, status),
      versions:portal_deliverable_versions(id, version, storage_path, file_name, upload_status)
    `)
    .eq("review_token", token)
    .maybeSingle();
  if (!deliv) return res.status(404).json({ error: "not found" });
  const order = deliv.order as { status: string };
  if (order.status !== "paid") return res.status(403).json({ error: "not paid" });

  const latest = (deliv.versions as { id: string; version: number; storage_path: string; file_name: string; upload_status: string }[])
    .filter((v) => v.upload_status === "uploaded")
    .sort((a, b) => b.version - a.version)[0];
  if (!latest) return res.status(404).json({ error: "no version" });

  const url = await createSignedDownloadUrl(supabase, latest.storage_path, latest.file_name);
  res.setHeader("Location", url);
  return res.status(302).end();
}
