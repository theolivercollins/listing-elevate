// lib/blog-engine/ai-draft.ts
import { jsonrepair } from "jsonrepair";

export type AILength = "short" | "standard" | "long";
export type AITone = "professional" | "casual" | "data_driven";

export interface Attachment {
  kind: "pdf" | "image" | "text";
  filename: string;
  data: string;           // base64 for pdf/image; raw text for text
  media_type?: string;
}

export interface GenerateDraftInput {
  prompt: string;
  template_id?: string | null;
  template_html?: string | null;
  length: AILength;
  tone: AITone;
  attachments?: Attachment[];
  paste_data?: string | null;
}

export interface GenerateDraftResult {
  html: string;                   // KEEP for backwards compat — same as body_html
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string[];
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
      messages: { role: "user"; content: any }[];
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS_BY_LENGTH: Record<AILength, number> = {
  short: 2048, standard: 4096, long: 8192,
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

Return ONLY valid JSON in this exact shape, no markdown fences, no commentary:
{
  "body_html": "<the post HTML using only h2/h3/p/ul/ol/li/strong/em/a/blockquote/table/thead/tbody/tr/th/td/br>",
  "meta_title": "<60-character SEO title>",
  "meta_description": "<150-character SEO description>",
  "meta_tags": ["3", "to", "8", "keywords"]
}

HTML rules:
- NEVER include <script>, <iframe>, <style>, inline event handlers, or javascript: URLs.
- No emojis unless asked.
- Use The Helgemo Team's voice: warm, knowledgeable, locally-grounded.
  Speak as "we" not "I". Mention Punta Gorda / Charlotte County by name when relevant.
- Always end with a soft CTA inviting the reader to reach out about a tour or market consult.

When reference materials are provided (PDFs, images, pasted data, CSVs), use ONLY
statistics and facts present in them. Never fabricate numbers. If a stat isn't in
the references, omit it or note 'data not available'.

If a template is provided, treat it as the structural skeleton and fill it in.
Match its tone, headings, and section count unless the prompt explicitly asks otherwise.`;

function buildUserMessage(input: GenerateDraftInput): string {
  const parts: string[] = [];
  parts.push(`Topic / request: ${input.prompt.trim()}`);
  parts.push(`Target length: ${WORDS_BY_LENGTH[input.length]}.`);
  parts.push(`Tone: ${TONE_TEXT[input.tone]}.`);
  if (input.paste_data?.trim()) {
    parts.push("");
    parts.push("## Reference data (pasted)");
    parts.push(input.paste_data.trim());
  }
  if (input.template_html?.trim()) {
    parts.push("");
    parts.push("Use this HTML as the structural template. Match its sections and headings:");
    parts.push("```html");
    parts.push(input.template_html.trim());
    parts.push("```");
  }
  parts.push("");
  parts.push("Return the JSON now. No preamble.");
  return parts.join("\n");
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

function buildAttachmentBlocks(attachments: Attachment[]): any[] {
  const blocks: any[] = [];
  for (const att of attachments) {
    if (att.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: att.data },
      });
    } else if (att.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: att.media_type ?? "image/jpeg", data: att.data },
      });
    } else if (att.kind === "text") {
      blocks.push({
        type: "text",
        text: `## ${att.filename}\n\n${att.data}`,
      });
    }
  }
  return blocks;
}

interface ParsedDraft {
  body_html: string;
  meta_title: string;
  meta_description: string;
  meta_tags: string[];
}

function parseJsonResponse(text: string): ParsedDraft {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (firstErr: any) {
    // Truncated or otherwise broken JSON — try to repair it.
    try {
      parsed = JSON.parse(jsonrepair(cleaned));
    } catch (secondErr: any) {
      throw new Error(
        `generateDraft: response was not JSON: ${firstErr.message}; ` +
        `repair also failed: ${secondErr.message}; ` +
        `raw: ${cleaned.slice(0, 200)}`,
      );
    }
  }
  const body_html = stripDangerousTags(String(parsed.body_html ?? ""));
  return {
    body_html,
    meta_title: String(parsed.meta_title ?? "").slice(0, 200),
    meta_description: String(parsed.meta_description ?? "").slice(0, 500),
    meta_tags: Array.isArray(parsed.meta_tags) ? parsed.meta_tags.map(String).slice(0, 20) : [],
  };
}

export async function generateDraft(
  input: GenerateDraftInput,
  deps: { anthropic: AnthropicLike },
): Promise<GenerateDraftResult> {
  const userMsg = buildUserMessage(input);
  const attachmentBlocks = buildAttachmentBlocks(input.attachments ?? []);

  const content: any[] = [
    { type: "text", text: userMsg },
    ...attachmentBlocks,
  ];

  const resp = await deps.anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS_BY_LENGTH[input.length],
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const parsed = parseJsonResponse(text);
  return {
    html: parsed.body_html,
    body_html: parsed.body_html,
    meta_title: parsed.meta_title,
    meta_description: parsed.meta_description,
    meta_tags: parsed.meta_tags,
    cost_cents: computeCostCents(resp.usage.input_tokens, resp.usage.output_tokens),
    model: MODEL,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens },
  };
}

export const _testing = { computeCostCents, stripDangerousTags, SYSTEM_PROMPT };
