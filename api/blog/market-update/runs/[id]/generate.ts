// POST /api/blog/market-update/runs/:id/generate
// Fill templates, rewrite FAQ, strip images, create the 4 drafts. Refuses if any
// region still has an error-severity issue.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../../lib/auth.js";
import { getSupabase } from "../../../../../lib/client.js";
import { generateDrafts } from "../../../../../lib/blog-engine/market-update/run.js";

export const maxDuration = 120;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  try {
    const result = await generateDrafts({
      supabase,
      siteId: site.id,
      runId: id,
      acknowledgeWarnings: req.body?.acknowledge_warnings === true,
    });
    return res.status(200).json({
      status: result.status,
      post_ids: result.postIds,
      email_ids: result.emailIds,
      cost_usd_cents: result.costCents,
    });
  } catch (e: any) {
    return res.status(409).json({ error: e?.message ?? String(e) });
  }
}
