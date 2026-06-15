// api/blog/ai/draft.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";
import { generateDraft, type Attachment } from "../../../lib/blog-engine/ai-draft.js";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

// ~4MB base64 = ~3MB raw bytes
const MAX_ATTACHMENT_BASE64 = 4 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT = 100 * 1024;   // 100KB
const MAX_PASTE_DATA = 50 * 1024;          // 50KB
const MAX_ATTACHMENTS = 5;

function validateAttachments(raw: unknown): { valid: true; attachments: Attachment[] } | { valid: false; error: string } {
  if (!Array.isArray(raw)) return { valid: false, error: "attachments must be an array" };
  if (raw.length > MAX_ATTACHMENTS) return { valid: false, error: `max ${MAX_ATTACHMENTS} attachments` };
  const attachments: Attachment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (!a || typeof a !== "object") return { valid: false, error: `attachment[${i}] invalid` };
    const { kind, filename, data, media_type } = a as Record<string, unknown>;
    if (!["pdf", "image", "text"].includes(kind as string)) {
      return { valid: false, error: `attachment[${i}].kind must be pdf|image|text` };
    }
    if (typeof data !== "string" || data.length === 0) {
      return { valid: false, error: `attachment[${i}].data must be a non-empty string` };
    }
    if (kind === "text") {
      if (data.length > MAX_TEXT_ATTACHMENT) {
        return { valid: false, error: `attachment[${i}] text exceeds 100KB` };
      }
    } else {
      // pdf or image — check base64 length
      if (data.length > MAX_ATTACHMENT_BASE64) {
        return { valid: false, error: `attachment[${i}] exceeds 4MB (base64)` };
      }
    }
    attachments.push({
      kind: kind as Attachment["kind"],
      filename: typeof filename === "string" ? filename : `attachment-${i}`,
      data,
      media_type: typeof media_type === "string" ? media_type : undefined,
    });
  }
  return { valid: true, attachments };
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

  // Validate attachments
  let attachments: Attachment[] | undefined;
  if (b.attachments !== undefined && b.attachments !== null) {
    const result = validateAttachments(b.attachments);
    if (result.valid === false) return res.status(400).json({ error: result.error });
    attachments = result.attachments;
  }

  // Validate paste_data
  let paste_data: string | null = null;
  if (b.paste_data !== undefined && b.paste_data !== null) {
    if (typeof b.paste_data !== "string") return res.status(400).json({ error: "paste_data must be a string" });
    if (b.paste_data.length > MAX_PASTE_DATA) return res.status(400).json({ error: "paste_data exceeds 50KB" });
    paste_data = b.paste_data;
  }

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
      {
        prompt: b.prompt,
        template_id: b.template_id ?? null,
        template_html: templateHtml,
        length,
        tone,
        attachments,
        paste_data,
      },
      { anthropic: anthropic() as any },
    );

    const attachments_kinds = (attachments ?? []).map((a) => a.kind);

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
        attachments_count: (attachments ?? []).length,
        attachments_kinds,
        paste_data_present: !!paste_data,
      },
    });

    return res.status(200).json(result);
  } catch (e: any) {
    return res.status(502).json({ error: `AI draft failed: ${e?.message ?? String(e)}` });
  }
}
