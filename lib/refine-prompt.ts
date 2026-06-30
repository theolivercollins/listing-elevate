import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "./client.js";
import { computeClaudeCost } from "./utils/claude-cost.js";
import { isNonProdEnv } from "./env.js";

const REWRITE_SYSTEM = `You are a Kling i2v prompt rewriter. You rewrite prompts concisely in the legacy pattern.
Pattern: [pace] cinematic [movement] [preposition] [subject + feature].
Single sentence. ≤120 chars for single-image, ≤250 for paired.
No filler: no "Motion is fluid", no "Emphasize", no "Camera moves" if the movement verb already says it.
Output ONLY the rewritten prompt — no commentary, no quotes, no explanation.`;

export interface RewriteResult {
  rewritten: string;
  costCents: number;
}

export async function rewritePromptWithDirectives(input: {
  basePrompt: string;
  directives: string;
  isPaired: boolean;
}): Promise<RewriteResult> {
  const limit = input.isPaired ? 250 : 120;
  const user = `Current prompt:\n${input.basePrompt}\n\nNew directives:\n${input.directives}\n\nRewrite as a single sentence ≤${limit} characters. Output ONLY the rewritten prompt.`;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: REWRITE_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  if (!text) throw new Error("rewritePrompt returned empty text");
  const cost = computeClaudeCost(response.usage as never, "claude-sonnet-4-6");

  // Record token cost for every rewrite pass (Sonnet 4.6).
  const supabase = getSupabase();
  const { error: costErr } = await supabase.from("cost_events").insert({
    property_id: null,
    scene_id: null,
    stage: "refine",
    provider: "anthropic",
    units_consumed: cost.totalTokens,
    unit_type: "tokens",
    cost_cents: Math.round(cost.costCents),
    metadata: { scope: "lab_listing_refine_rewrite", model: "claude-sonnet-4-6" },
    is_test: isNonProdEnv(),
  });
  if (costErr) console.error("[rewritePromptWithDirectives] cost_events insert failed:", costErr);

  return { rewritten: text, costCents: cost.costCents };
}
