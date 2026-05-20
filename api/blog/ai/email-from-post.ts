// api/blog/ai/email-from-post.ts
//
// One-shot endpoint: given a blog post ID, runs a single Claude call to
// convert the post into a beautifully formatted marketing email.
//
// No multi-turn — intended as a "quick convert" that the UI can present as
// the starting point for the email composer. The user then refines via
// /api/blog/ai/email-chat with source_post_id set.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";
import { BASE_EMAIL_SYSTEM_PROMPT } from "../../../lib/blog-engine/ally-email-prompt.js";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const MAX_BODY_CHARS = 60_000;

interface EmailFromPostResponse {
  subject: string;
  preheader: string;
  body_html: string;
  from_name: string;
  from_email: string;
  audience: string;
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

function extractTag(text: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function stripCodeFences(s: string): string {
  const m = s.match(/^```(?:html|HTML)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : s;
}

function extractFromFences(text: string): string | null {
  const m = text.match(/```(?:html|HTML)\s*\n([\s\S]*?)\n?```/);
  return m ? m[1].trim() : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const b = (req.body ?? {}) as { post_id?: string };
  if (!b.post_id || typeof b.post_id !== "string") {
    return res.status(400).json({ error: "post_id required" });
  }

  // Fetch the blog post
  const { data: post, error: postErr } = await supabase
    .from("blog_posts")
    .select("title, body_html, external_post_url, category_label")
    .eq("id", b.post_id)
    .single();

  if (postErr || !post) {
    return res.status(404).json({ error: "post not found" });
  }

  const title = String(post.title ?? "");
  const bodyHtml = String(post.body_html ?? "").slice(0, MAX_BODY_CHARS);
  const externalUrl = post.external_post_url ? String(post.external_post_url) : null;

  // Resolve site ID for cost recording
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  const siteId = (site?.id ?? "") as string;

  const conversionInstruction = `Convert the following blog post into a beautifully formatted HTML marketing email for The Helgemo Team's subscriber list.

Guidelines for the conversion:
- Use the post title as inspiration for the email subject — make it punchy and specific, not a copy-paste.
- Rewrite the content for email readers: shorter paragraphs, scannable structure, benefit-led headings.
- Do NOT include the full blog post verbatim — distill to the most important 3-4 points.
- If the post has an external URL, include a CTA button at the end inviting readers to read the full post: "Read the Full Story →" (or similar). Use that URL as {{CTA_URL}}.
- Keep the warm, locally grounded Helgemo Team voice.
- Default audience: sphere.
- Default from: "The Helgemo Team" / hello@helgemoteam.com.

BLOG POST TO CONVERT:
TITLE: ${title}
${externalUrl ? `PUBLISHED URL: ${externalUrl}` : "STATUS: Not yet published externally"}
CATEGORY: ${post.category_label || "General"}

BODY HTML:
${bodyHtml}`;

  const messages: any[] = [{ role: "user", content: conversionInstruction }];

  let result;
  try {
    result = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: BASE_EMAIL_SYSTEM_PROMPT,
      messages,
    });
  } catch (e: any) {
    return res.status(502).json({ error: `AI email conversion failed: ${e?.message ?? String(e)}` });
  }

  const text = result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");

  // Parse the output using the same tag extractors
  let body_html = extractTag(text, "email_body");
  if (body_html) body_html = stripCodeFences(body_html);
  if (!body_html) body_html = extractFromFences(text);
  body_html = body_html ?? "";

  const subject = extractTag(text, "email_subject") ?? title;
  const preheader = extractTag(text, "email_preheader") ?? "";
  const from_name = extractTag(text, "email_from_name") ?? "The Helgemo Team";
  const from_email = extractTag(text, "email_from_email") ?? "hello@helgemoteam.com";
  const audience = extractTag(text, "email_audience") ?? "sphere";

  const inTok = result.usage.input_tokens;
  const outTok = result.usage.output_tokens;
  // claude-sonnet-4-6: $3/MTok input, $15/MTok output
  const costCents = Math.ceil((inTok / 1_000_000) * 300 + (outTok / 1_000_000) * 1500);

  if (siteId) {
    await recordBlogCost(supabase, {
      stage: "blog_email_from_post",
      cost_cents: costCents,
      post_id: b.post_id,
      site_id: siteId,
      provider: "anthropic",
      metadata: {
        model: MODEL,
        flavor: "email_from_post",
        usage: { input_tokens: inTok, output_tokens: outTok },
        source_post_id: b.post_id,
        source_post_title: title,
        source_body_chars: bodyHtml.length,
      },
    });
  }

  const response: EmailFromPostResponse = {
    subject,
    preheader,
    body_html,
    from_name,
    from_email,
    audience,
    cost_cents: costCents,
    model: MODEL,
    usage: { input_tokens: inTok, output_tokens: outTok },
  };
  return res.status(200).json(response);
}
