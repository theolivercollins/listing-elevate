import { jsonrepair } from "jsonrepair";
import { getSupabase } from "../client.js";
import { recordCostEvent } from "../db.js";
import { anthropic, MU_MODEL } from "../blog-engine/market-update/client.js";
import { computeClaudeCost } from "../utils/claude-cost.js";
import { buildListingSeoArtifact, buildListingSeoMarkdown, buildListingSeoSchema } from "./artifact.js";
import {
  canStoreListingSeoArtifacts,
  defaultSeoBaseUrl,
  fetchListingSeoArtifactByPropertyId,
  fetchListingSeoSource,
  materializeListingSeoArtifactRow,
  upsertListingSeoArtifact,
} from "./repository.js";
import type { ListingSeoArtifact, ListingSeoArtifactRow, ListingSeoFaq, ListingSeoSource } from "./types.js";

export interface GenerateListingSeoInput {
  propertyId: string;
  baseUrl?: string;
  useAi?: boolean;
  force?: boolean;
}

interface AnthropicLike {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }) => Promise<{
      content: Array<{ type: string; text?: string }>;
      usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      };
    }>;
  };
}

interface ListingSeoAiResponse {
  meta_description?: string;
  summary?: string;
  long_description?: string;
  highlights?: string[];
  faqs?: ListingSeoFaq[];
}

function stripDangerousText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampText(value: unknown, maxLength: number): string | null {
  const text = stripDangerousText(String(value ?? ""));
  if (!text) return null;
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : cut.length).replace(/[.,;:]+$/g, "")}.`;
}

function parseJsonObject(text: string): ListingSeoAiResponse {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned) as ListingSeoAiResponse;
  } catch {
    return JSON.parse(jsonrepair(cleaned)) as ListingSeoAiResponse;
  }
}

function buildAiPrompt(source: ListingSeoSource, artifact: ListingSeoArtifact): string {
  return JSON.stringify({
    instructions: [
      "Improve this real estate listing SEO artifact for search snippets and AI answer engines.",
      "Use only the supplied facts. Do not invent HOA, waterfront, school, neighborhood, or MLS facts.",
      "Return only JSON with meta_description, summary, long_description, highlights, and faqs.",
      "Keep faqs useful for buyers and exactly 3 to 5 items.",
      "No HTML, markdown fences, emojis, or scripts.",
    ],
    facts: {
      address: source.property.address,
      price: source.property.price,
      bedrooms: source.property.bedrooms,
      bathrooms: source.property.bathrooms,
      square_footage: source.property.square_footage,
      listing_agent: source.client?.agent_name ?? source.property.listing_agent,
      brokerage: source.client?.brokerage ?? source.property.brokerage,
      photo_features: source.photos.flatMap((photo) => photo.key_features ?? []).slice(0, 20),
      room_types: source.photos.map((photo) => photo.room_type).filter(Boolean).slice(0, 12),
      has_horizontal_video: Boolean(source.property.horizontal_video_url),
      has_vertical_video: Boolean(source.property.vertical_video_url),
      canonical_url: source.canonical_url,
    },
    current_artifact: {
      title: artifact.title,
      meta_description: artifact.meta_description,
      summary: artifact.summary,
      long_description: artifact.long_description,
      highlights: artifact.highlights,
      faqs: artifact.faqs,
    },
  });
}

async function enhanceWithAi(
  source: ListingSeoSource,
  baseArtifact: ListingSeoArtifact,
  deps: { anthropicClient?: AnthropicLike } = {},
): Promise<ListingSeoArtifact> {
  const client = deps.anthropicClient ?? anthropic();
  const resp = await client.messages.create({
    model: MU_MODEL,
    max_tokens: 1800,
    system: "You write accurate, concise real estate SEO content. You never invent facts.",
    messages: [{ role: "user", content: buildAiPrompt(source, baseArtifact) }],
  });
  const text = (resp.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  const parsed = parseJsonObject(text);
  const cost = computeClaudeCost(resp.usage, MU_MODEL);
  const next: ListingSeoArtifact = {
    ...baseArtifact,
    generated_by: "anthropic",
    model: MU_MODEL,
    cost_cents: Math.max(1, Math.ceil(cost.costCents)),
    error: null,
  };
  next.meta_description = clampText(parsed.meta_description, 155) ?? next.meta_description;
  next.summary = clampText(parsed.summary, 240) ?? next.summary;
  next.long_description = clampText(parsed.long_description, 700) ?? next.long_description;
  if (Array.isArray(parsed.highlights)) {
    next.highlights = parsed.highlights.map((value) => clampText(value, 80)).filter((value): value is string => Boolean(value)).slice(0, 8);
  }
  if (Array.isArray(parsed.faqs)) {
    const faqs = parsed.faqs
      .map((faq) => ({
        question: clampText(faq?.question, 120) ?? "",
        answer: clampText(faq?.answer, 240) ?? "",
      }))
      .filter((faq) => faq.question && faq.answer)
      .slice(0, 5);
    if (faqs.length >= 3) next.faqs = faqs;
  }
  next.schema_json = buildListingSeoSchema(source, next);
  next.llms_markdown = buildListingSeoMarkdown(source, next);
  try {
    await recordCostEvent({
      propertyId: source.property.id,
      stage: "scripting",
      provider: "anthropic",
      unitsConsumed: cost.totalTokens,
      unitType: "tokens",
      costCents: next.cost_cents,
      metadata: {
        feature: "ai_seo",
        preview_id: source.preview.id,
        model: MU_MODEL,
        source_fingerprint: baseArtifact.source_fingerprint,
      },
    });
  } catch (err) {
    throw new Error(`ai_seo_cost_ledger_failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return next;
}

export async function generateListingSeoForProperty(
  input: GenerateListingSeoInput,
  deps: { anthropicClient?: AnthropicLike } = {},
): Promise<ListingSeoArtifactRow> {
  const db = getSupabase();
  const source = await fetchListingSeoSource(db, input.propertyId, input.baseUrl ?? defaultSeoBaseUrl());
  if (!source) throw new Error("public_preview_required");

  let artifact = buildListingSeoArtifact(source);
  const canStore = await canStoreListingSeoArtifacts(db);
  const existing = canStore ? await fetchListingSeoArtifactByPropertyId(db, input.propertyId) : null;
  if (!input.force && existing?.source_fingerprint === artifact.source_fingerprint) {
    return existing;
  }

  if (canStore && input.useAi !== false && process.env.ANTHROPIC_API_KEY) {
    try {
      artifact = await enhanceWithAi(source, artifact, deps);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("ai_seo_cost_ledger_failed:")) throw err;
      artifact = {
        ...artifact,
        error: `AI enhancement failed: ${message}`,
      };
    }
  }
  if (!canStore) return materializeListingSeoArtifactRow(source, artifact);
  return upsertListingSeoArtifact(db, source, artifact);
}
