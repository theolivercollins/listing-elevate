// api/blog/ai/chat.ts
//
// Multi-turn chat that builds a blog post conversationally. Each call accepts
// the running thread + (optionally) the current HTML draft + (optionally) a
// template, file attachments, and a flag to use recent posts as style reference.
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
const MAX_TEMPLATE_CHARS = 30_000;
const MAX_TEXT_ATTACHMENT = 100 * 1024;
const MAX_ATTACHMENT_BASE64 = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const RECENT_POSTS_LIMIT = 5;
const RECENT_POST_EXCERPT_CHARS = 800;

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface Attachment {
  kind: "pdf" | "image" | "text";
  filename: string;
  data: string;
  media_type?: string;
}

interface ChatResponse {
  reply: string;
  body_html: string;
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

const BASE_SYSTEM_PROMPT = `You are a senior real-estate blog editor working with The Helgemo Team in Punta Gorda, Florida.

Each turn you produce two parts in this exact format:

<reply>
1-3 sentences of plain prose acknowledging the request or asking back. No HTML here.
</reply>

<html>
Full post HTML using <h2>, <h3>, <p>, <ul>, <ol>, <table>, <strong>, <em>, <blockquote>. No <html>, <body>, <head>, <script>, <style>, <iframe>. No markdown — actual tags.
</html>

Rules:
- The <html> block always contains the COMPLETE current post, never a diff. If the user said hi or is still scoping, return a short placeholder like "<p>Tell me more about what this post should cover.</p>".
- Voice: warm, knowledgeable, locally grounded. Speak as "we" not "I". Reference Punta Gorda / Charlotte County / Burnt Store Isles / The Isles by name when relevant.
- Use ONLY numbers present in the references the user provides. Never fabricate stats. If a stat isn't in the references, omit it or write "data not available".
- Informative headings, not generic ones. End with a soft CTA inviting the reader to reach out for a tour or market consult.`;

function validateAttachments(raw: unknown): { ok: true; attachments: Attachment[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "attachments must be an array" };
  if (raw.length > MAX_ATTACHMENTS) return { ok: false, error: `max ${MAX_ATTACHMENTS} attachments` };
  const out: Attachment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] as any;
    if (!a || typeof a !== "object") return { ok: false, error: `attachment[${i}] invalid` };
    if (!["pdf", "image", "text"].includes(a.kind)) return { ok: false, error: `attachment[${i}].kind` };
    if (typeof a.data !== "string" || !a.data) return { ok: false, error: `attachment[${i}].data` };
    if (a.kind === "text" && a.data.length > MAX_TEXT_ATTACHMENT) return { ok: false, error: `attachment[${i}] text > 100KB` };
    if (a.kind !== "text" && a.data.length > MAX_ATTACHMENT_BASE64) return { ok: false, error: `attachment[${i}] base64 > 4MB` };
    out.push({
      kind: a.kind, filename: typeof a.filename === "string" ? a.filename : `attachment-${i}`,
      data: a.data, media_type: typeof a.media_type === "string" ? a.media_type : undefined,
    });
  }
  return { ok: true, attachments: out };
}

function parseSections(text: string): { reply: string; body_html: string } {
  const replyMatch = text.match(/<reply>([\s\S]*?)<\/reply>/i);
  const htmlMatch = text.match(/<html>([\s\S]*?)<\/html>/i);
  const reply = replyMatch?.[1]?.trim() ?? "";
  const body_html = htmlMatch?.[1]?.trim() ?? "";
  if (!htmlMatch && !replyMatch) return { reply: text.trim(), body_html: "" };
  return { reply, body_html };
}

async function buildSystemPrompt(opts: {
  supabase: any;
  templateId: string | null;
  includeRecentPosts: boolean;
}): Promise<string> {
  let prompt = BASE_SYSTEM_PROMPT;

  if (opts.templateId) {
    const { data: tpl } = await opts.supabase
      .from("blog_templates").select("body_html").eq("id", opts.templateId).single();
    if (tpl?.body_html) {
      const tplHtml = (tpl.body_html as string).slice(0, MAX_TEMPLATE_CHARS);
      prompt += `\n\nUse the following as the STRUCTURAL TEMPLATE — match its sections, heading hierarchy, and overall shape unless the user explicitly asks for changes:\n\n<template>\n${tplHtml}\n</template>`;
    }
  }

  if (opts.includeRecentPosts) {
    const { data: posts } = await opts.supabase
      .from("blog_posts")
      .select("title, body_html")
      .eq("active", true).eq("state", "live")
      .order("updated_at", { ascending: false })
      .limit(RECENT_POSTS_LIMIT);
    if (Array.isArray(posts) && posts.length > 0) {
      const examples = posts.map((p: any, i: number) => {
        const html = String(p.body_html ?? "").slice(0, RECENT_POST_EXCERPT_CHARS);
        return `### Example ${i + 1}: "${p.title}"\n${html}`;
      }).join("\n\n");
      prompt += `\n\nThe Helgemo Team's RECENT PUBLISHED POSTS — match this voice, depth, and structural rhythm:\n\n${examples}`;
    }
  }

  return prompt;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  const b = (req.body ?? {}) as {
    messages?: ChatMessage[];
    current_html?: string;
    template_id?: string | null;
    include_recent_posts?: boolean;
    attachments?: unknown;
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
      return res.status(400).json({ error: `messages[${i}] > ${MAX_MESSAGE_CHARS} chars` });
    }
  }

  const attResult = validateAttachments(b.attachments);
  if (!attResult.ok) return res.status(400).json({ error: attResult.error });
  const attachments = attResult.attachments;

  const currentHtml = typeof b.current_html === "string" ? b.current_html.slice(0, MAX_DRAFT_CHARS) : "";

  const system = await buildSystemPrompt({
    supabase,
    templateId: b.template_id ?? null,
    includeRecentPosts: b.include_recent_posts === true,
  });

  // Build messages array. Stitch the current draft into the trailing user turn,
  // and attach files (if any) as Anthropic content blocks on that same turn.
  const lastIndex = b.messages.length - 1;
  const messages: any[] = b.messages.map((m, i) => {
    const isLast = i === lastIndex;
    let text = m.content;
    if (isLast && m.role === "user" && currentHtml) {
      text = `CURRENT DRAFT (rewrite as needed):\n<html>\n${currentHtml}\n</html>\n\nUSER MESSAGE:\n${m.content}`;
    }
    if (!isLast || m.role !== "user" || attachments.length === 0) {
      return { role: m.role, content: text };
    }
    // Last user turn + files → assemble multi-part content
    const blocks: any[] = [];
    for (const a of attachments) {
      if (a.kind === "pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: a.media_type ?? "application/pdf", data: a.data },
        });
      } else if (a.kind === "image") {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: a.media_type ?? "image/jpeg", data: a.data },
        });
      } else {
        blocks.push({ type: "text", text: `Attached text file "${a.filename}":\n${a.data}` });
      }
    }
    blocks.push({ type: "text", text });
    return { role: m.role, content: blocks };
  });

  let result;
  try {
    result = await anthropic().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    });
  } catch (e: any) {
    return res.status(502).json({ error: `AI chat failed: ${e?.message ?? String(e)}` });
  }

  const text = result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  const parsed = parseSections(text);

  const inTok = result.usage.input_tokens;
  const outTok = result.usage.output_tokens;
  const costCents = Math.ceil((inTok / 1_000_000) * 300 + (outTok / 1_000_000) * 1500);

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
        template_id: b.template_id ?? null,
        include_recent_posts: b.include_recent_posts === true,
        attachments_count: attachments.length,
        attachments_kinds: attachments.map((a) => a.kind),
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
