// api/blog/ai/analyze-template.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const SYSTEM = `You analyze HTML blog-post templates for a real-estate team. Given the
HTML, output JSON with this exact shape (no commentary, no markdown fences):
{
  "suggested_name": "short title, max 60 chars",
  "suggested_description": "1-2 sentence summary of when to use this template",
  "notes": "markdown bullets describing what you see (sections, style cues, placeholders)",
  "detected_sections": ["heading", "intro paragraph", "data table", ...]
}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const html = (req.body?.body_html as string | undefined)?.trim();
  if (!html || html.length < 20) return res.status(400).json({ error: "body_html required (min 20 chars)" });
  if (html.length > 200_000) return res.status(400).json({ error: "body_html too large (max 200 KB)" });

  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) return res.status(500).json({ error: "no Sierra site" });

  try {
    const resp = await anthropic().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Analyze this template HTML:\n\n${html}` }],
    });
    const text = (resp.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("");
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch {
      return res.status(502).json({ error: "Could not parse Claude response as JSON", raw: cleaned.slice(0, 500) });
    }
    const cost_cents = Math.max(1, Math.ceil((resp.usage.input_tokens * 3 + resp.usage.output_tokens * 15) / 10000));
    await recordBlogCost(supabase, {
      stage: "blog_ai_draft",
      cost_cents,
      post_id: null,
      site_id: site.id,
      provider: "anthropic",
      metadata: { kind: "analyze_template", model: "claude-sonnet-4-6", usage: resp.usage },
    });
    return res.status(200).json({
      suggested_name: String(parsed.suggested_name ?? "").slice(0, 60),
      suggested_description: String(parsed.suggested_description ?? ""),
      notes: String(parsed.notes ?? ""),
      detected_sections: Array.isArray(parsed.detected_sections) ? parsed.detected_sections.map(String) : [],
      cost_cents,
      model: "claude-sonnet-4-6",
    });
  } catch (e: any) {
    return res.status(502).json({ error: `Analyze failed: ${e?.message ?? String(e)}` });
  }
}
