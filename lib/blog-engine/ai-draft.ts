// lib/blog-engine/ai-draft.ts

export type AILength = "short" | "standard" | "long";
export type AITone = "professional" | "casual" | "data_driven";

export interface GenerateDraftInput {
  prompt: string;
  template_id?: string | null;
  template_html?: string | null;
  length: AILength;
  tone: AITone;
}

export interface GenerateDraftResult {
  html: string;
  cost_cents: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicLike {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_BY_LENGTH: Record<AILength, number> = {
  short: 1024, standard: 2048, long: 4096,
};
const WORDS_BY_LENGTH: Record<AILength, string> = {
  short: "around 300 words", standard: "around 600 words", long: "around 1000 words",
};
const TONE_TEXT: Record<AITone, string> = {
  professional: "warm and professional",
  casual: "warm and conversational, light and friendly",
  data_driven: "warm but data-led, leading with stats and trends",
};

const SYSTEM_PROMPT = `You write real-estate blog posts for The Helgemo Team in Punta Gorda, FL.

Output requirements:
- Return ONLY clean HTML, no markdown, no commentary, no <html>/<head>/<body> wrappers.
- Use these tags only: h2, h3, p, ul, ol, li, strong, em, a, blockquote,
  table, thead, tbody, tr, th, td, br.
- NEVER include <script>, <iframe>, <style>, inline event handlers, or javascript: URLs.
- No emojis unless asked.
- Use The Helgemo Team's voice: warm, knowledgeable, locally-grounded.
  Speak as "we" not "I". Mention Punta Gorda / Charlotte County by name when relevant.
- Always end with a soft CTA inviting the reader to reach out about a tour or market consult.

If a template is provided, treat it as the structural skeleton and fill it in.
Match its tone, headings, and section count unless the prompt explicitly asks otherwise.`;

function buildUserMessage(input: GenerateDraftInput): string {
  const parts: string[] = [];
  parts.push(`Topic / request: ${input.prompt.trim()}`);
  parts.push(`Target length: ${WORDS_BY_LENGTH[input.length]}.`);
  parts.push(`Tone: ${TONE_TEXT[input.tone]}.`);
  if (input.template_html?.trim()) {
    parts.push("");
    parts.push("Use this HTML as the structural template. Match its sections and headings:");
    parts.push("```html");
    parts.push(input.template_html.trim());
    parts.push("```");
  }
  parts.push("");
  parts.push("Return the post HTML now. No preamble.");
  return parts.join("\n");
}

function stripFences(text: string): string {
  return text.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function stripDangerousTags(html: string): string {
  // Remove <script>...</script> blocks and <iframe>...</iframe> blocks (and their content).
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    // Strip on* event handlers and javascript: URLs in attributes
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\sjavascript\s*:\s*[^"'\s>]*/gi, "");
}

// Sonnet 4.6 pricing (2026-05): $3/M input, $15/M output. Stored as integers
// in tenths of a cent for headroom against rounding, then rounded UP to whole cents.
function computeCostCents(inputTokens: number, outputTokens: number): number {
  // 300 = $3/M expressed as cents per token × 1e-4 (i.e. 3 cents / 10k tokens, scaled)
  // Equivalent direct math: cents = (input * 3 + output * 15) / 10000
  const cents = (inputTokens * 3 + outputTokens * 15) / 10000;
  return Math.max(1, Math.ceil(cents));
}

export async function generateDraft(
  input: GenerateDraftInput,
  deps: { anthropic: AnthropicLike },
): Promise<GenerateDraftResult> {
  const userMsg = buildUserMessage(input);
  const resp = await deps.anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_BY_LENGTH[input.length],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const cleaned = stripDangerousTags(stripFences(text));
  return {
    html: cleaned,
    cost_cents: computeCostCents(resp.usage.input_tokens, resp.usage.output_tokens),
    model: MODEL,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens },
  };
}

export const _testing = { computeCostCents, stripFences, stripDangerousTags, SYSTEM_PROMPT };
