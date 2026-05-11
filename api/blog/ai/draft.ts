// api/blog/ai/draft.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";
import { generateDraft } from "../../../lib/blog-engine/ai-draft.js";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const b = req.body ?? {};
  if (!b.prompt || typeof b.prompt !== "string" || b.prompt.length < 3) {
    return res.status(400).json({ error: "prompt required (min 3 chars)" });
  }
  const length = (b.length as "short" | "standard" | "long" | undefined) ?? "standard";
  const tone = (b.tone as "professional" | "casual" | "data_driven" | undefined) ?? "professional";
  if (!["short", "standard", "long"].includes(length)) return res.status(400).json({ error: "bad length" });
  if (!["professional", "casual", "data_driven"].includes(tone)) return res.status(400).json({ error: "bad tone" });

  // Load template if provided
  let templateHtml: string | null = null;
  if (b.template_id) {
    const { data: tpl } = await supabase.from("blog_templates").select("body_html").eq("id", b.template_id).single();
    templateHtml = tpl?.body_html ?? null;
  }

  // Find the site row (single-site for v1)
  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  try {
    const result = await generateDraft(
      { prompt: b.prompt, template_id: b.template_id ?? null, template_html: templateHtml, length, tone },
      { anthropic: anthropic() as any },
    );

    await recordBlogCost(supabase, {
      stage: "blog_ai_draft",
      cost_cents: result.cost_cents,
      post_id: null,
      site_id: site.id,
      provider: "anthropic",
      metadata: {
        model: result.model,
        prompt_snippet: b.prompt.slice(0, 200),
        template_id: b.template_id ?? null,
        length, tone,
        usage: result.usage,
      },
    });

    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(502).json({ error: `AI draft failed: ${e?.message ?? String(e)}` });
  }
}
