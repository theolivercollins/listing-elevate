// api/blog/ai/email-chat.ts
//
// Multi-turn chat that builds an email conversationally. Each call accepts
// the running thread + (optionally) the current email body HTML + (optionally)
// a source post to convert, file attachments, and research controls.
//
// Architecture is a direct mirror of api/blog/ai/chat.ts — same model, same
// memory/archive/allowlist/research plumbing, same cost-recording shape —
// with section tags and response fields renamed for email output.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordBlogCost } from "../../../lib/blog-engine/cost.js";
import { researchTopic, type ResearchSource } from "../../../lib/blog-engine/gemini-research.js";
import { listMemories, addMemory, memoriesAsPromptBlock, type AllyMemory } from "../../../lib/blog-engine/ally-memory.js";
import { buildEmailSystemPrompt } from "../../../lib/blog-engine/ally-email-prompt.js";

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
const MAX_TEXT_ATTACHMENT = 100 * 1024;
const MAX_ATTACHMENT_BASE64 = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const ARCHIVE_CATALOG_LIMIT = 50;
const ARCHIVE_TOP_EXCERPTS = 8;
const ARCHIVE_EXCERPT_CHARS = 1100;

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface Attachment {
  kind: "pdf" | "image" | "text";
  filename: string;
  data: string;
  media_type?: string;
}

interface EmailChatResponse {
  reply: string;
  subject: string | null;
  preheader: string | null;
  body_html: string;
  from_name: string | null;
  from_email: string | null;
  audience: string | null;
  action: "send" | "save_draft" | "test_send" | null;
  suggest_research: boolean;
  changes_summary: string | null;
  new_memory: { id: string; content: string } | null;
  research_sources: ResearchSource[];
  cost_cents: number;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

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

function looksLikeHtml(s: string): boolean {
  if (!s) return false;
  const t = s.trim();
  if (!t.startsWith("<")) return false;
  return /<\s*(table|tr|td|h[1-6]|p|ul|ol|blockquote|div)\b/i.test(t);
}

function parseEmailSections(text: string) {
  const reply = extractTag(text, "reply") ?? "";

  // email_body is canonical; fall back to fenced code block if model regresses.
  let body_html = extractTag(text, "email_body");
  if (body_html) body_html = stripCodeFences(body_html);
  if (!body_html) body_html = extractFromFences(text);

  const subject = extractTag(text, "email_subject");
  const preheader = extractTag(text, "email_preheader");
  const from_name = extractTag(text, "email_from_name");
  const from_email = extractTag(text, "email_from_email");
  const audience = extractTag(text, "email_audience");

  const actionRaw = extractTag(text, "email_action");
  const action: "send" | "save_draft" | "test_send" | null =
    actionRaw === "send" || actionRaw === "save_draft" || actionRaw === "test_send"
      ? actionRaw
      : null;

  const suggestResearchRaw = extractTag(text, "ally_suggest_research");
  const suggest_research = suggestResearchRaw?.toLowerCase().trim() === "true";
  const changes_summary = extractTag(text, "changes_summary");
  const remember_fact = extractTag(text, "ally_remember");

  // Last resort — if we still have no body but the message contains an
  // HTML-looking blob, promote it.
  if (!body_html) {
    const stripped = text
      .replace(/<reply>[\s\S]*?<\/reply>/i, "")
      .replace(/<email_[a-z_]+>[\s\S]*?<\/email_[a-z_]+>/gi, "")
      .replace(/<ally_[a-z_]+>[\s\S]*?<\/ally_[a-z_]+>/gi, "")
      .trim();
    if (looksLikeHtml(stripped)) body_html = stripped;
  }

  // If everything is blank, dump the whole text into reply.
  if (!body_html && !subject && !reply) {
    return {
      reply: text.trim(), body_html: "",
      subject: null, preheader: null, from_name: null, from_email: null,
      audience: null, action: null, suggest_research: false,
      changes_summary: null, remember_fact: null,
    };
  }

  return {
    reply, body_html: body_html ?? "",
    subject, preheader, from_name, from_email, audience, action,
    suggest_research, changes_summary, remember_fact,
  };
}

function scorePostForQuery(p: any, userWords: Set<string>): number {
  const tokenise = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let score = 0;
  for (const w of tokenise(String(p.title ?? ""))) if (userWords.has(w)) score += 3;
  for (const w of tokenise(String(p.category_label ?? ""))) if (userWords.has(w)) score += 2;
  for (const w of tokenise(String(p.meta_title ?? ""))) if (userWords.has(w)) score += 1;
  if (Array.isArray(p.meta_tags)) {
    for (const tag of p.meta_tags) {
      for (const w of tokenise(String(tag))) if (userWords.has(w)) score += 1;
    }
  }
  const t = p.updated_at ? new Date(p.updated_at).getTime() : 0;
  if (t) {
    const ageDays = (Date.now() - t) / 86_400_000;
    score += Math.max(0, 5 - Math.min(5, ageDays / 30));
  }
  return score;
}

async function buildSystemPrompt(opts: {
  supabase: any;
  includeRecentPosts: boolean;
  latestUserMessage: string;
  siteId: string;
  sourcePost?: { title: string; body_html: string; external_post_url: string | null } | null;
}): Promise<string> {
  let prompt = buildEmailSystemPrompt();

  // Persistent memories — always first, before archive / source post.
  const memories = await listMemories(opts.supabase, opts.siteId);
  const memoryBlock = memoriesAsPromptBlock(memories);
  if (memoryBlock) prompt += `\n\n${memoryBlock}`;

  // If a source blog post was provided, inject it so the model can convert it.
  if (opts.sourcePost) {
    const url = opts.sourcePost.external_post_url
      ? `Published URL: ${opts.sourcePost.external_post_url}`
      : "(not yet published externally)";
    prompt += `\n\n=== SOURCE POST (for email conversion) ===

Convert this blog post into an email format if the user asks to. Use its content as the authoritative source — don't fabricate additional stats or claims beyond what's in the post. ${url}

TITLE: ${opts.sourcePost.title}

BODY:
${opts.sourcePost.body_html.slice(0, 40_000)}`;
  }

  // Archive injection — same logic as blog chat, useful for tone consistency
  // and cross-linking in emails.
  if (opts.includeRecentPosts) {
    const { data: posts } = await opts.supabase
      .from("blog_posts")
      .select("title, body_html, external_post_url, category_label, updated_at, meta_tags, meta_title")
      .eq("active", true).eq("state", "live")
      .order("updated_at", { ascending: false })
      .limit(ARCHIVE_CATALOG_LIMIT);

    if (Array.isArray(posts) && posts.length > 0) {
      const userWords = new Set(opts.latestUserMessage.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const ranked = posts
        .map((p: any) => ({ p, score: scorePostForQuery(p, userWords) }))
        .sort((a, b) => b.score - a.score);
      const topExcerpts = ranked.slice(0, ARCHIVE_TOP_EXCERPTS).map((x) => x.p);

      const catalog = posts.map((p: any, i: number) => {
        const url = p.external_post_url || "(not yet published)";
        const cat = p.category_label || "Uncategorized";
        const date = String(p.updated_at ?? "").slice(0, 10);
        return `[${i + 1}] "${p.title}" · ${cat} · ${date} · ${url}`;
      }).join("\n");

      const excerpts = topExcerpts.map((p: any) => {
        const html = String(p.body_html ?? "").slice(0, ARCHIVE_EXCERPT_CHARS);
        const url = p.external_post_url ? `URL: ${p.external_post_url}` : "URL: (not yet published)";
        const cat = p.category_label ? `Category: ${p.category_label}` : "";
        return `### "${p.title}"\n${url} · ${cat}\n\n${html}`;
      }).join("\n\n---\n\n");

      prompt += `

=== THE HELGEMO TEAM'S BLOG ARCHIVE — YOU HAVE FULL ACCESS ===

The posts below ARE the URLs. When linking to relevant team content inside the email body, use the exact URL from this list.

ARCHIVE CATALOG (${posts.length} live posts):
${catalog}

DETAILED EXCERPTS — ranked by relevance to this turn's request:

${excerpts}
`;
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
    current_body_html?: string;
    include_recent_posts?: boolean;
    /**
     * "auto"   — Ally decides via keyword intent (default)
     * "always" — run Gemini grounding every turn
     * "never"  — never run grounding
     */
    research_mode?: "auto" | "always" | "never";
    research?: boolean;
    attachments?: unknown;
    /** When set, fetch this blog post and inject it as a SOURCE POST for conversion. */
    source_post_id?: string | null;
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

  const currentBodyHtml = typeof b.current_body_html === "string"
    ? b.current_body_html.slice(0, MAX_DRAFT_CHARS)
    : "";

  // Resolve the single Sierra site — used for memory, research cost, and
  // chat cost recording. Single-site for v1.
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  const siteId = (site?.id ?? "") as string;

  // Optionally fetch the source blog post for the "create email from post" flow.
  let sourcePost: { title: string; body_html: string; external_post_url: string | null } | null = null;
  if (b.source_post_id) {
    const { data: post } = await supabase
      .from("blog_posts")
      .select("title, body_html, external_post_url")
      .eq("id", b.source_post_id)
      .single();
    if (post) {
      sourcePost = {
        title: String(post.title ?? ""),
        body_html: String(post.body_html ?? ""),
        external_post_url: post.external_post_url ?? null,
      };
    }
  }

  // Resolve research mode. Legacy `research:boolean` preserved for compat.
  const researchMode: "auto" | "always" | "never" =
    b.research_mode ??
    (b.research === true ? "always" : b.research === false ? "never" : "auto");

  function shouldAutoResearch(userMessage: string): boolean {
    const t = userMessage.toLowerCase();
    if (/\b(research|look ?up|find out|google|web ?search|search (for|the web|online))\b/.test(t)) return true;
    if (/\b(current(ly)?|latest|today'?s?|right now|this (month|week|quarter|year)|2026|recent(ly)?)\b/.test(t)) return true;
    if (/\b(median (price|sale|sold)|mortgage rate|interest rate|days on market|price per (sq ?ft|square foot)|inventory|absorption rate|months of inventory|closed sales|pending sales|new listings|sold[\/ ]list ratio)\b/.test(t)) return true;
    if (/\b(market (update|report|stats?|statistics|conditions)|housing (data|stats?|market)|trend(s|ing)?|comps?|comparable sales)\b/.test(t)) return true;
    return false;
  }

  const latestUserContent = b.messages.filter((m) => m.role === "user").slice(-1)[0]?.content?.trim() ?? "";
  const doResearch =
    researchMode === "always" ||
    (researchMode === "auto" && latestUserContent.length > 0 && shouldAutoResearch(latestUserContent));

  let research: { summary: string; sources: ResearchSource[]; cost_cents: number } | null = null;
  if (doResearch) {
    const latestUser = b.messages.filter((m) => m.role === "user").slice(-1)[0];
    if (latestUser?.content?.trim()) {
      try {
        const r = await researchTopic(latestUser.content);
        research = { summary: r.summary, sources: r.sources, cost_cents: r.cost_cents };
        if (siteId) {
          await recordBlogCost(supabase, {
            stage: "blog_research",
            cost_cents: r.cost_cents,
            post_id: null,
            site_id: siteId,
            provider: "gemini",
            metadata: {
              model: r.model,
              usage: r.usage,
              sources_count: r.sources.length,
              query_chars: latestUser.content.length,
              research_mode: researchMode,
              auto_triggered: researchMode === "auto",
              context: "email_chat",
            },
          });
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn("[email-chat] research failed, continuing without:", e?.message ?? e);
      }
    }
  }

  let system = await buildSystemPrompt({
    supabase,
    includeRecentPosts: b.include_recent_posts === true,
    latestUserMessage: latestUserContent,
    siteId,
    sourcePost,
  });

  if (research) {
    const sourcesText = research.sources.length
      ? research.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n")
      : "(no sources captured)";
    system += `\n\nRESEARCH BRIEF (Gemini, googleSearch-grounded). Use these facts and quote numbers verbatim. You may reference sources inline in the email body but keep it subtle — a brief parenthetical or a linked phrase is fine; don't dump a full bibliography in an email.\n\n${research.summary}\n\nSOURCES:\n${sourcesText}`;
  }

  // Build messages array. Stitch the current email body draft into the
  // trailing user turn, and attach files (if any) as content blocks.
  const lastIndex = b.messages.length - 1;
  const messages: any[] = b.messages.map((m, i) => {
    const isLast = i === lastIndex;
    let text = m.content;
    if (isLast && m.role === "user" && currentBodyHtml) {
      text = `CURRENT EMAIL BODY (rewrite as needed):\n<current_email_body>\n${currentBodyHtml}\n</current_email_body>\n\nUSER MESSAGE:\n${m.content}`;
    }
    if (!isLast || m.role !== "user" || attachments.length === 0) {
      return { role: m.role, content: text };
    }
    // Last user turn + files → multi-part content blocks
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
    return res.status(502).json({ error: `AI email chat failed: ${e?.message ?? String(e)}` });
  }

  const text = result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  const parsed = parseEmailSections(text);

  const inTok = result.usage.input_tokens;
  const outTok = result.usage.output_tokens;
  // claude-sonnet-4-6: $3/MTok input, $15/MTok output
  const costCents = Math.ceil((inTok / 1_000_000) * 300 + (outTok / 1_000_000) * 1500);

  if (siteId) {
    await recordBlogCost(supabase, {
      stage: "blog_email_ai",
      cost_cents: costCents,
      post_id: null,
      site_id: siteId,
      provider: "anthropic",
      metadata: {
        model: MODEL,
        flavor: "email_chat",
        turn: b.messages.length,
        usage: { input_tokens: inTok, output_tokens: outTok },
        current_body_html_chars: currentBodyHtml.length,
        include_recent_posts: b.include_recent_posts === true,
        attachments_count: attachments.length,
        attachments_kinds: attachments.map((a) => a.kind),
        research_mode: researchMode,
        auto_research_triggered: !!research && researchMode === "auto",
        source_post_id: b.source_post_id ?? null,
      },
    });
  }

  // Persist any memory the model asked to store.
  let stored: AllyMemory | null = null;
  if (siteId && parsed.remember_fact) {
    stored = await addMemory(supabase, siteId, parsed.remember_fact);
  }

  const response: EmailChatResponse = {
    reply: parsed.reply || "Updated email below.",
    subject: parsed.subject,
    preheader: parsed.preheader,
    body_html: parsed.body_html || currentBodyHtml,
    from_name: parsed.from_name,
    from_email: parsed.from_email,
    audience: parsed.audience,
    action: parsed.action,
    suggest_research: parsed.suggest_research && !research,
    changes_summary: parsed.changes_summary,
    new_memory: stored ? { id: stored.id, content: stored.content } : null,
    research_sources: research?.sources ?? [],
    cost_cents: costCents + (research?.cost_cents ?? 0),
    usage: { input_tokens: inTok, output_tokens: outTok },
    model: MODEL,
  };
  return res.status(200).json(response);
}
