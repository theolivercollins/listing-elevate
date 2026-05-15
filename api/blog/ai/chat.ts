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
import { researchTopic, type ResearchSource } from "../../../lib/blog-engine/gemini-research.js";

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
  title: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_tags: string[] | null;
  author: string | null;
  category: string | null;
  action: "publish" | "save_draft" | null;
  /** Sources found via Gemini-grounded research, if research:true was requested. */
  research_sources: ResearchSource[];
  /**
   * Ally's hint that the user's request would benefit from web research and
   * research is currently off. Client renders a "Search the web?" button when
   * true so the user can opt in with one click.
   */
  suggest_research: boolean;
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

const BASE_SYSTEM_PROMPT = `You are a senior real-estate blog editor working with The Helgemo Team in Punta Gorda, Florida. You manage every part of the post (title, body, meta, author, category) on behalf of the user — they may also edit fields directly, in which case respect what's there.

OUTPUT FORMAT — STRICT.

Wrap each piece of structured output in the exact section tag below. Section tags are deliberately prefixed (post_*, seo_*) so they never collide with real HTML elements inside the post body. NEVER use <html>, <body>, <head>, <article> as section tags — use the exact names below.

Always emit <reply> and <post_body>. Omit other sections only if they haven't changed since the previous turn AND the user didn't ask for them.

<reply>
1-3 sentences of plain prose acknowledging the request or asking back. No HTML.
</reply>

<post_title>
The proposed post title. Single line, informative, specific (e.g. "Punta Gorda Median Price Up 4.2% in May").
</post_title>

<post_body>
The COMPLETE current post HTML using <h2>, <h3>, <p>, <ul>, <ol>, <table>, <strong>, <em>, <blockquote>. No outer <html>, <body>, <head>, <article>. No <script>, <style>, <iframe>. No markdown fences. No code blocks. Actual HTML tags. This block is required on every turn.
</post_body>

<seo_title>
Single line, ≤60 chars.
</seo_title>

<seo_description>
Single line, ≤155 chars.
</seo_description>

<seo_tags>
Comma-separated, 3-8 keywords.
</seo_tags>

<post_author>
Single line, e.g. "The Helgemo Team".
</post_author>

<post_category>
Single line, e.g. "Market Reports".
</post_category>

<post_action>
One word: publish | save_draft. Emit ONLY when the user has clearly asked to publish or save (e.g. "publish it", "save this draft", "go live"). Otherwise omit. Never publish or save without an explicit user request.
</post_action>

<ally_suggest_research>
One word: true. Emit this ONLY when ALL of the following are true:
  1. Research is currently OFF (no RESEARCH BRIEF is present above), AND
  2. The user's request would clearly benefit from current real-world facts you don't have (market stats, recent news, comparable sales, current mortgage rates, etc.), AND
  3. You would otherwise have to fabricate or guess numbers.
When you emit this, ALSO mention it in your <reply> — for example: "Want me to pull current numbers from Google first? Toggle the Research switch above the input, or click the suggestion below." Omit this tag when research is already on or when fabrication isn't a risk (e.g. tone tweaks, structural edits, generic advice).
</ally_suggest_research>

Rules:
- <post_body> is REQUIRED on every turn and must be the full current draft, never a diff. If the user said hi or is still scoping, put a placeholder like "<p>Tell me more about what this post should cover.</p>" inside <post_body>.
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

function extractTag(text: string, ...tags: string[]): string | null {
  // Tolerant: matches <tag> or <tag attr="...">, case-insensitive, takes first.
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function stripCodeFences(s: string): string {
  // Sometimes the model wraps HTML in ```html ... ``` even when told not to.
  const m = s.match(/^```(?:html|HTML)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : s;
}

function extractFromFences(text: string): string | null {
  // Last-resort: pull any ```html ... ``` block.
  const m = text.match(/```(?:html|HTML)\s*\n([\s\S]*?)\n?```/);
  return m ? m[1].trim() : null;
}

function looksLikeHtml(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (!t.startsWith("<")) return false;
  // Has at least one of these block-level tags
  return /<\s*(h[1-6]|p|ul|ol|table|blockquote|div|section)\b/i.test(t);
}

function parseSections(text: string) {
  const reply = extractTag(text, "reply") ?? "";

  // post_body is the canonical name; fall back to <html> (legacy) or
  // a fenced ```html ... ``` block if the model regresses.
  let body_html = extractTag(text, "post_body", "html", "body", "article");
  if (body_html) body_html = stripCodeFences(body_html);
  if (!body_html) body_html = extractFromFences(text);

  // Field tags — accept both new (post_*/seo_*) and legacy names for now so
  // a deploy gap can't silently lose data.
  const title = extractTag(text, "post_title", "title");
  const meta_title = extractTag(text, "seo_title", "meta_title");
  const meta_description = extractTag(text, "seo_description", "meta_description");
  const tagsRaw = extractTag(text, "seo_tags", "meta_tags");
  const meta_tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : null;
  const author = extractTag(text, "post_author", "author");
  const category = extractTag(text, "post_category", "category");
  const actionRaw = extractTag(text, "post_action", "action");
  const action: "publish" | "save_draft" | null =
    actionRaw === "publish" || actionRaw === "save_draft" ? actionRaw : null;
  const suggestResearchRaw = extractTag(text, "ally_suggest_research");
  const suggest_research = suggestResearchRaw?.toLowerCase().trim() === "true";

  // Last resort — if we still have no body but the message contains an
  // HTML-looking blob (e.g. the model emitted raw HTML next to the prose
  // and forgot the wrapper), promote whatever's in the text that looks
  // like a post.
  if (!body_html) {
    // Strip any tag pairs we recognise, then see if the remainder is HTML.
    const stripped = text
      .replace(/<reply>[\s\S]*?<\/reply>/i, "")
      .replace(/<post_title>[\s\S]*?<\/post_title>/i, "")
      .replace(/<seo_[a-z_]+>[\s\S]*?<\/seo_[a-z_]+>/gi, "")
      .replace(/<post_[a-z_]+>[\s\S]*?<\/post_[a-z_]+>/gi, "")
      .replace(/<ally_[a-z_]+>[\s\S]*?<\/ally_[a-z_]+>/gi, "")
      .trim();
    if (looksLikeHtml(stripped)) body_html = stripped;
  }

  // If we got everything blank, dump the whole text into reply.
  if (!body_html && !title && !meta_title && !reply) {
    return {
      reply: text.trim(), body_html: "",
      title: null, meta_title: null, meta_description: null, meta_tags: null,
      author: null, category: null, action: null, suggest_research: false,
    };
  }

  return {
    reply, body_html: body_html ?? "",
    title, meta_title, meta_description, meta_tags, author, category, action,
    suggest_research,
  };
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
      .select("title, body_html, external_post_url, category_label, updated_at")
      .eq("active", true).eq("state", "live")
      .order("updated_at", { ascending: false })
      .limit(RECENT_POSTS_LIMIT);
    if (Array.isArray(posts) && posts.length > 0) {
      const examples = posts.map((p: any, i: number) => {
        const html = String(p.body_html ?? "").slice(0, RECENT_POST_EXCERPT_CHARS);
        const url = p.external_post_url ? `URL: ${p.external_post_url}` : "URL: (not yet published)";
        const cat = p.category_label ? `Category: ${p.category_label}` : "";
        const meta = [url, cat].filter(Boolean).join(" · ");
        return `### Recent post ${i + 1} — "${p.title}"\n${meta}\nExcerpt:\n${html}`;
      }).join("\n\n");
      prompt += `\n\nTHE HELGEMO TEAM'S RECENT PUBLISHED POSTS — match this voice, depth, and structural rhythm. When relevant, LINK TO these posts inline using their URL (e.g. <a href="URL">our latest market update</a>) and reference their data instead of inventing your own. For example, a neighborhood spotlight should cite the most recent Market Update post if one exists. Don't link to posts whose URL is "(not yet published)".\n\n${examples}`;
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
    research?: boolean;
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

  // Optional Gemini-grounded research, run BEFORE the Claude call so its
  // findings + sources can be included in the system prompt. Failure is
  // non-fatal: log + continue without research rather than blocking the chat.
  let research: { summary: string; sources: ResearchSource[]; cost_cents: number } | null = null;
  if (b.research === true) {
    const latestUser = b.messages.filter((m) => m.role === "user").slice(-1)[0];
    if (latestUser?.content?.trim()) {
      try {
        const r = await researchTopic(latestUser.content);
        research = { summary: r.summary, sources: r.sources, cost_cents: r.cost_cents };
        const { data: siteForCost } = await supabase
          .from("blog_sites").select("id").eq("host_kind", "sierra").single();
        if (siteForCost) {
          await recordBlogCost(supabase, {
            stage: "blog_research",
            cost_cents: r.cost_cents,
            post_id: null,
            site_id: siteForCost.id,
            provider: "gemini",
            metadata: {
              model: r.model,
              usage: r.usage,
              sources_count: r.sources.length,
              query_chars: latestUser.content.length,
            },
          });
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn("[chat] research failed, continuing without:", e?.message ?? e);
      }
    }
  }

  let system = await buildSystemPrompt({
    supabase,
    templateId: b.template_id ?? null,
    includeRecentPosts: b.include_recent_posts === true,
  });
  if (research) {
    const sourcesText = research.sources.length
      ? research.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n")
      : "(no sources captured)";
    system += `\n\nRESEARCH BRIEF (Gemini, googleSearch-grounded). Use these facts and quote numbers verbatim. Cite sources inline using the [n] notation, then list a "Sources" section at the end of the post HTML as <h3>Sources</h3><ol><li><a href="URL">Title</a></li></ol>.\n\n${research.summary}\n\nSOURCES:\n${sourcesText}`;
  }

  // Build messages array. Stitch the current draft into the trailing user turn,
  // and attach files (if any) as Anthropic content blocks on that same turn.
  const lastIndex = b.messages.length - 1;
  const messages: any[] = b.messages.map((m, i) => {
    const isLast = i === lastIndex;
    let text = m.content;
    if (isLast && m.role === "user" && currentHtml) {
      text = `CURRENT DRAFT (rewrite as needed):\n<current_draft>\n${currentHtml}\n</current_draft>\n\nUSER MESSAGE:\n${m.content}`;
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
    title: parsed.title,
    meta_title: parsed.meta_title,
    meta_description: parsed.meta_description,
    meta_tags: parsed.meta_tags,
    author: parsed.author,
    category: parsed.category,
    action: parsed.action,
    // Only surface the suggestion when research isn't already on — otherwise it'd be noise.
    suggest_research: parsed.suggest_research && !research,
    research_sources: research?.sources ?? [],
    cost_cents: costCents + (research?.cost_cents ?? 0),
    usage: { input_tokens: inTok, output_tokens: outTok },
    model: MODEL,
  };
  return res.status(200).json(response);
}
