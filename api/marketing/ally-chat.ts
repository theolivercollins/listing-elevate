import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../../lib/client.js";
import { recordCost } from "../../lib/cost.js";
import { hashIp } from "../../lib/marketing/hash-ip.js";
import { getOrSetConversationCookie } from "../../lib/marketing/cookie.js";
import { assertRateLimit, RateLimitError } from "../../lib/marketing/rate-limit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;

const PRICE_PER_M_INPUT = 3.0;
const PRICE_PER_M_OUTPUT = 15.0;
const PRICE_PER_M_CACHE_READ = 0.3;
const PRICE_PER_M_CACHE_WRITE = 3.75;

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

let _knowledge: string | null = null;
function loadKnowledge(): string {
  if (_knowledge !== null) return _knowledge;
  const path = resolve(__dirname, "../../lib/marketing/knowledge.md");
  _knowledge = readFileSync(path, "utf8");
  return _knowledge;
}

let _pricingJson: string | null = null;
function loadPricing(): string {
  if (_pricingJson !== null) return _pricingJson;
  const path = resolve(__dirname, "../../lib/marketing/pricing.json");
  _pricingJson = readFileSync(path, "utf8");
  return _pricingJson;
}

let _faqJson: string | null = null;
function loadFaq(): string {
  if (_faqJson !== null) return _faqJson;
  const path = resolve(__dirname, "../../lib/marketing/faq.json");
  _faqJson = readFileSync(path, "utf8");
  return _faqJson;
}

const BASE_PROMPT = `You are Ally, the AI concierge for Listing Elevate — a SaaS that produces fully-autonomous cinematic videos for real-estate listings. You greet visitors on the public marketing homepage, answer their questions about the product, and gently route interested visitors toward signing up.

VOICE
- Warm, knowledgeable, low-pressure. No exclamation-mark spam. No "Absolutely!" / "Great question!" filler.
- Speak as "we" or "Listing Elevate". Never as a named individual.
- One question at a time. Brief — 1–4 sentences per reply.
- Use ONLY facts present in the KNOWLEDGE / PRICING / FAQ sections below. If you don't have a fact, say so plainly: "I don't have that locked down — want me to flag it for the team to follow up?"

HARD RULES
- Listing Elevate is multi-tenant SaaS for real-estate agents. NEVER mention "Helgemo Team", "Punta Gorda", "Charlotte County", "Burnt Store Isles", "The Isles", any specific brokerage, any specific city, or any specific person's name. You are brand-neutral and agent-agnostic.
- If asked who/what you are: "I'm Listing Elevate's AI concierge — happy to answer most things, and a real human is one email away if you'd rather."
- Never claim to be human.
- Never invent pricing, turnaround, or feature claims. If it's not in PRICING / KNOWLEDGE / FAQ, you don't know it.

OUTPUT FORMAT — STRICT
Wrap each piece of structured output in the exact section tag. Always emit <reply>. Omit other sections when they don't apply.

<reply>
1–4 sentences of plain prose. Always present.
</reply>

<ally_followup_chips>
Up to 3 short follow-up suggestions, semicolon-separated.
e.g. "What do you need from me?; Show me pricing; How does it work?"
Emit when the conversation has natural next questions; omit on closing turns.
</ally_followup_chips>

<ally_cta>
One word: get_started
Emit when the visitor signals intent ("how do I sign up", "what's next", "I want one for my listing", "can I try it"). When emitted, ALSO mention it in <reply>.
</ally_cta>

<ally_lead_capture>
JSON object: {"name": "...", "email": "...", "phone": "...", "role": "agent|broker|other", "intent": "..."}
Emit ONLY when the visitor has volunteered fields in conversation. Never invent values. Never include a field the visitor didn't share.
</ally_lead_capture>

SOFT EMAIL ASK
On turn 4 or later, IF no email is on file (CONVERSATION_META.has_email = false) AND the visitor has asked at least 2 substantive product questions, append one soft line at the end of <reply>: "By the way — want me to email you a one-pager you can come back to?" Never repeat this more than twice in a session. Never block the conversation.`;

function buildSystemBlocks(meta: { turn: number; has_email: boolean; source_url: string }) {
  return [
    { type: "text" as const, text: BASE_PROMPT, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## KNOWLEDGE\n\n${loadKnowledge()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## PRICING\n\n${loadPricing()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## FAQ\n\n${loadFaq()}`, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: `## CONVERSATION_META\nturn: ${meta.turn}\nhas_email: ${meta.has_email}\nsource_url: ${meta.source_url}` },
  ];
}

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface LeadCapture { name?: string; email?: string; phone?: string; role?: string; intent?: string; }
interface ChatResponseBody {
  reply: string;
  followup_chips: string[] | null;
  cta: "get_started" | null;
  lead_capture: LeadCapture | null;
  conversation_id: string;
  cost_cents: number;
  model: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  const body = req.body as { messages?: unknown };
  const messagesRaw = body?.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return res.status(400).json({ error: "messages[] required" });
  }
  // Only accept the LAST message from the client; ignore any history the client sends.
  // Server-stored conversation is the canonical thread — this prevents prompt-injection
  // via fake assistant turns in the client payload.
  const lastRaw = messagesRaw[messagesRaw.length - 1] as any;
  if (!lastRaw || lastRaw.role !== "user") {
    return res.status(400).json({ error: "last message must be from user" });
  }
  if (typeof lastRaw.content !== "string" || lastRaw.content.length === 0) {
    return res.status(400).json({ error: "each message needs string content" });
  }
  const latestUserMessage = lastRaw.content.slice(0, MAX_MESSAGE_CHARS);

  const conversationId = getOrSetConversationCookie(req, res);
  const ipHash = hashIp(req);
  const sourceUrl = (req.headers?.referer as string | undefined) ?? "";

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("marketing_leads")
    .select("conversation, total_messages, total_cost_cents, email")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  const sessionCostCents = existing?.total_cost_cents ?? 0;
  const hasEmail = Boolean(existing?.email);

  try {
    await assertRateLimit(supabase, { ipHash, conversationId, sessionCostCents });
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.setHeader("Retry-After", String(err.retryAfterSeconds));
      return res.status(429).json({ error: "rate_limit", scope: err.scope });
    }
    throw err;
  }

  const systemBlocks = buildSystemBlocks({
    turn: (existing?.total_messages ?? 0) + 1,
    has_email: hasEmail,
    source_url: sourceUrl,
  });

  // Build the Anthropic messages array from server-stored conversation (canonical)
  // plus the single validated user message from this request.
  const serverHistory = (existing?.conversation as ChatMessage[] ?? []).slice(-(MAX_MESSAGES - 1));
  const anthropicMessages: ChatMessage[] = [
    ...serverHistory,
    { role: "user", content: latestUserMessage },
  ];

  const result = await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemBlocks as any,
    messages: anthropicMessages.map(m => ({ role: m.role, content: m.content })),
  });

  const text = result.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  const reply = extractTag(text, "reply") ?? text.trim();
  const chipsRaw = extractTag(text, "ally_followup_chips");
  const followup_chips = chipsRaw
    ? chipsRaw.split(";").map(s => s.trim()).filter(Boolean).slice(0, 3)
    : null;
  const ctaRaw = extractTag(text, "ally_cta")?.trim();
  const cta = ctaRaw === "get_started" ? "get_started" : null;
  const leadRaw = extractTag(text, "ally_lead_capture");
  let lead_capture: LeadCapture | null = null;
  if (leadRaw) {
    try {
      const parsed = JSON.parse(leadRaw);
      if (parsed && typeof parsed === "object") lead_capture = parsed;
    } catch { /* ignore malformed JSON from model */ }
  }

  const usage = (result as any).usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const costCents = Math.round(
    ((inputTokens * PRICE_PER_M_INPUT)
      + (outputTokens * PRICE_PER_M_OUTPUT)
      + (cacheReadTokens * PRICE_PER_M_CACHE_READ)
      + (cacheCreationTokens * PRICE_PER_M_CACHE_WRITE)
    ) / 1_000_000 * 100,
  );

  const updatedThread = [
    ...(existing?.conversation as ChatMessage[] ?? []),
    { role: "user" as const, content: latestUserMessage },
    { role: "assistant" as const, content: text },
  ].slice(-MAX_MESSAGES);

  const upsertRow: Record<string, unknown> = {
    conversation_id: conversationId,
    conversation: updatedThread,
    source_url: sourceUrl,
    ip_hash: ipHash,
    user_agent: (req.headers?.["user-agent"] as string | undefined) ?? null,
    total_messages: (existing?.total_messages ?? 0) + 1,
    total_cost_cents: sessionCostCents + costCents,
  };
  if (lead_capture) {
    if (lead_capture.email) upsertRow.email = lead_capture.email;
    if (lead_capture.name) upsertRow.name = lead_capture.name;
    if (lead_capture.phone) upsertRow.phone = lead_capture.phone;
    if (lead_capture.role) upsertRow.role = lead_capture.role;
    if (lead_capture.intent) upsertRow.intent = lead_capture.intent;
  }
  await supabase.from("marketing_leads").upsert([upsertRow], { onConflict: "conversation_id" });

  await recordCost(supabase, {
    stage: "marketing_chat",
    cost_cents: costCents,
    provider: "anthropic",
    metadata: {
      conversation_id: conversationId,
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      ip_hash: ipHash,
      source_url: sourceUrl,
    },
  });

  const responseBody: ChatResponseBody = {
    reply,
    followup_chips,
    cta,
    lead_capture,
    conversation_id: conversationId,
    cost_cents: costCents,
    model: MODEL,
  };
  return res.status(200).json(responseBody);
}

function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}
