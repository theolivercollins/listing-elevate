// GET  /api/blog/market-update/runs        — list runs for the site
// POST /api/blog/market-update/runs         — analyze: create a run, extract +
//                                              validate every region's PDF.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";
import { analyzeRun, type RegionInput } from "../../../../lib/blog-engine/market-update/run.js";
import { reapStuckRuns } from "../../../../lib/blog-engine/market-update/reaper.js";

export const maxDuration = 120;

const MAX_PDF_BASE64 = 5 * 1024 * 1024; // ~3.75MB decoded; Stellar reports are ~150KB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  if (req.method === "GET") {
    const limit = Math.min(Number(req.query.limit ?? 30), 100);
    // Lazily reap any runs stuck in a transient status (e.g. "extracting")
    // before returning data so the list never shows permanently-stuck rows.
    await reapStuckRuns(supabase, site.id);

    const { data, error } = await supabase
      .from("market_update_runs")
      .select("id, period_month, period_year, status, created_post_ids, created_email_ids, cost_usd_cents, created_at, updated_at")
      .eq("site_id", site.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ runs: data ?? [] });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};
    const periodMonth = Number(b.period_month);
    const periodYear = Number(b.period_year);
    if (!(periodMonth >= 1 && periodMonth <= 12) || !(periodYear >= 2000 && periodYear <= 2100)) {
      return res.status(400).json({ error: "valid period_month (1-12) and period_year required" });
    }
    if (!b.blog_template_id) return res.status(400).json({ error: "blog_template_id required" });
    if (!Array.isArray(b.regions) || b.regions.length === 0) {
      return res.status(400).json({ error: "regions[] required" });
    }

    // Merge uploaded PDFs with the seeded region config (strip_images / emits_email).
    const { data: regionConfig, error: rcErr } = await supabase
      .from("mu_regions")
      .select("slug, display_name, strip_images, emits_email")
      .eq("site_id", site.id).eq("active", true);
    if (rcErr) return res.status(500).json({ error: rcErr.message });
    const bySlug = new Map((regionConfig ?? []).map((r: any) => [r.slug, r]));

    const regions: RegionInput[] = [];
    for (const r of b.regions) {
      const cfg = bySlug.get(r.slug);
      if (!cfg) return res.status(400).json({ error: `unknown region slug: ${r.slug}` });
      if (typeof r.pdf_base64 !== "string" || r.pdf_base64.length === 0) {
        return res.status(400).json({ error: `region ${r.slug} missing pdf_base64` });
      }
      if (r.pdf_base64.length > MAX_PDF_BASE64) {
        return res.status(400).json({ error: `region ${r.slug} PDF too large` });
      }
      regions.push({
        slug: cfg.slug,
        display_name: cfg.display_name,
        pdf_base64: r.pdf_base64,
        filename: r.filename,
        strip_images: cfg.strip_images,
        emits_email: cfg.emits_email,
      });
    }

    try {
      const result = await analyzeRun({
        supabase,
        siteId: site.id,
        periodMonth,
        periodYear,
        blogTemplateId: b.blog_template_id,
        emailTemplateId: b.email_template_id ?? null,
        regions,
      });
      return res.status(201).json({
        run_id: result.runId,
        status: result.status,
        region_results: result.results,
        cost_usd_cents: result.costCents,
      });
    } catch (e: any) {
      return res.status(502).json({ error: `analyze failed: ${e?.message ?? String(e)}` });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
