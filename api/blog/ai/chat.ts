// api/blog/ai/chat.ts
//
// Multi-turn chat that builds a blog post conversationally. Each call accepts
// the running thread + (optionally) the current HTML draft, and returns the
// assistant's next message plus a fresh `body_html` proposal. Caller decides
// when to "Use this" and commit the HTML to the editor.
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

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 8000;
const MAX_DRAFT_CHARS = 60_000;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  reply: string;            // assistant's prose response
  body_html: string;        // the latest proposed post HTML (may be unchanged)
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

const SYSTEM_PROMPT = `You are a senior real-estate blog editor working with an agent on a single post.

Your job each turn:
1. Acknowledge or ask back briefly in plain prose (1-3 sentences max).
2. Then produce the FULL current draft of the post as clean, semantic HTML.

OUTPUT FORMAT — strict:

Respond with exactly one assistant message containing two parts in this order:

<reply>
Plain prose response to the user. Keep it short. No HTML here.
</reply>

<html>
Full post HTML. Use <h2>, <h3>, <p>, <ul>, <ol>, <table>, <strong>, <em>, <blockquote>. No <html>, <body>, or <head>. No <script> or <style>. No markdown — actual HTML tags.
</html>

Rules:
- The <html> block always contains the COMPLETE current post, not a diff.
- If the user just said hi or asked a clarifying question, return a short empty-ish placeholder in <html> like "<p>Tell me more about what this post should cover.</p>".
- If the user pasted data, only use those numbers. Don't invent stats.
- Use the warm-but-professional voice of a top-producing US real-estate team. No fluff, no clickbait, no emoji.
- Headings should be informative (e.g. "Punta Gorda Median Price Up 4.2% in May") not generic ("Introduction").
- Tables are great for monthly stat comparisons.`;

function parseSections(text: string): { reply: string; body_html: string } {
  const replyMatch = text.match(/<reply>([\s\S]*?)<\/reply>/i);
  const htmlMatch = text.match(/<html>([\s\S]*?)<\/html>/i);
  const reply = replyMatch?.[1]?.trim() ?? "";
  const body_html = htmlMatch?.[1]?.trim() ?? "";
  if (!htmlMatch && !replyMatch) {
    // Model didn't follow the schema — treat the whole thing as reply.
    return { reply: text.trim(), body_html: "" };
  }
  return { reply, body_html };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const b = (req.body ?? {}) as {
    messages?: ChatMessage[];
    current_html?: string;
  };

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return res.status(400).json({ error: "messages[] required" });
  }
  if (b.messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `max ${MAX_MESSAGES} messages per request` });
  }
  for (let i = 0; i < b.messages.length; i++) {
    const m = b.messages[i];
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return res.status(400).json({ error: `messages[${i}] invalid` });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return res.status(400).json({ error: `messages[${i}] exceeds ${MAX_MESSAGE_CHARS} chars` });
    }
  }
  const currentHtml = typeof b.current_html === "string" ? b.current_html.slice(0, MAX_DRAFT_CHARS) : "";

  // Stitch the current draft into the trailing user turn so the model always sees
  // the latest source of truth without our needing to inject a system turn.
  const messages = b.messages.map((m) => ({ role: m.role, content: m.content }));
  if (currentHtml) {
    const last = messages[messages.length - 1];
    last.content = `CURRENT DRAFT (your reference; rewrite as needed):\n\n<html>\n${currentHtml}\n</html>\n\nUSER MESSAGE:\n${last.content}`;
  }

  let result;
  try {
    result = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    });
  } catch (e: any) {
    return res.status(502).json({ error: `AI chat failed: ${e?.message ?? String(e)}` });
  }

  const text = result.content
    .filter((c) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  const parsed = parseSections(text);

  // Cost: Sonnet 4.6 is $3/MTok input, $15/MTok output. Round up to whole cents.
  const inTok = result.usage.input_tokens;
  const outTok = result.usage.output_tokens;
  const costCents = Math.ceil((inTok / 1_000_000) * 300 + (outTok / 1_000_000) * 1500);

  // Find the site row (single-site for v1)
  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (site) {
    await recordBlogCost(supabase, {
      stage: "blog_ai_draft",
      cost_cents: costCents,
      post_id: null,
      site_id: site.id,
      provider: "anthropic",
      metadata: {
        model: MODEL,
        flavor: "chat",
        turn: b.messages.length,
        usage: { input_tokens: inTok, output_tokens: outTok },
        current_html_chars: currentHtml.length,
      },
    });
  }

  const response: ChatResponse = {
    reply: parsed.reply || "Updated draft below.",
    body_html: parsed.body_html || currentHtml,
    cost_cents: costCents,
    usage: { input_tokens: inTok, output_tokens: outTok },
    model: MODEL,
  };
  return res.status(200).json(response);
}
