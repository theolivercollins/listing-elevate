/**
 * Scene graph extractor — single Gemini 2.5 Pro call across all listing photos.
 * Returns a validated PropertySceneGraph. Retries once on validation failure.
 * Records a cost_event with scope='v21_scene_graph'.
 */

import { GoogleGenAI } from "@google/genai";
import type { PropertySceneGraph } from "../types.js";
import { validateSceneGraph } from "./schema.js";
import { recordCostEvent } from "../../db.js";

const SCENE_GRAPH_MODEL = process.env.SCENE_GRAPH_MODEL ?? "gemini-2.5-pro";

const GEMINI_PRICE_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.075, output: 0.3 },
};

function geminiCostCents(model: string, promptTokens: number, outputTokens: number): number {
  if (promptTokens === 0 && outputTokens === 0) return 3;
  const rate = GEMINI_PRICE_USD_PER_MTOK[model] ?? GEMINI_PRICE_USD_PER_MTOK["gemini-2.5-pro"];
  return Math.max(
    1,
    Math.ceil(
      promptTokens * (rate.input / 1_000_000) * 100 +
        outputTokens * (rate.output / 1_000_000) * 100,
    ),
  );
}

const SYSTEM_PROMPT = `You are a real-estate scene-graph extraction specialist.
Given a set of property listing photos, analyze each one and produce a complete PropertySceneGraph JSON object.

For each photo you must determine:
- The room it depicts (assign a stable room_id like "kitchen_1", "primary_bedroom_1", etc.)
- room_confidence (0..1) — how certain you are this is the correct room
- camera_bearing_vector — the direction the camera is pointing relative to the room
- shot_type — wide, medium, close, aerial, or detail
- focal_subject — the main subject or null
- visible_features — observable features (countertops, island, fireplace, etc.)
- visible_portals — doorways/openings visible in the frame with precise screen coordinates

Also determine:
- rooms[] — aggregate all rooms seen across photos, each with a unique room_id, room_type, features list, and which photo_ids contain it
- front_orientation — compass direction the property faces (N/E/S/W/unknown)
- exterior_shots — any exterior/aerial photos with their type

IMPORTANT:
- portal screen_position x/y should be 0..1 normalized (0=left/top, 1=right/bottom)
- bbox fields (x1,y1,x2,y2) should also be 0..1 normalized
- is_open_path=true only for actual walkable openings (doors/archways), false for windows/mirrors
- Assign consistent room_ids across photos showing the same room
- Output ONLY the JSON object matching the PropertySceneGraph schema, no markdown fences or other text`;

/**
 * Fetch a photo URL and return it as a base64 inlineData part.
 * Falls back to fileData only for gs:// URIs (Google Cloud Storage).
 * HTTPS URLs from Supabase (or any CDN) require inlineData — Gemini's
 * fileData.fileUri only accepts gs:// or Gemini Files API URIs.
 */
async function photoToInlinePart(url: string): Promise<object> {
  if (url.startsWith("gs://")) {
    // Google Cloud Storage URI — use fileData directly
    return { fileData: { fileUri: url, mimeType: "image/jpeg" } };
  }
  // Fetch and base64-encode for all other URLs
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch photo ${url}: HTTP ${resp.status}`);
  }
  const buf = await resp.arrayBuffer();
  const b64 = Buffer.from(buf).toString("base64");
  // Detect mime from Content-Type or fall back to jpeg
  const ct = resp.headers.get("content-type") ?? "image/jpeg";
  const mimeType = ct.split(";")[0].trim();
  return { inlineData: { data: b64, mimeType } };
}

async function buildUserMessage(
  listingId: string,
  photos: Array<{ id: string; url: string }>,
  now: string,
  model: string,
): Promise<object> {
  const photoIntro = photos
    .map((p, i) => `Photo ${i + 1} (photo_id="${p.id}")`)
    .join(", ");

  const textPart = {
    text: `Analyze these ${photos.length} photos for listing "${listingId}": ${photoIntro}.

Return a PropertySceneGraph JSON with:
- listing_id: "${listingId}"
- extracted_at: "${now}"
- model_version: "${model}@${now.slice(0, 10)}"
- photos[]: one entry per photo in the same order
- rooms[]: deduplicated room list
- front_orientation
- exterior_shots[]`,
  };

  const imageParts = await Promise.all(photos.map((p) => photoToInlinePart(p.url)));

  return {
    role: "user",
    parts: [textPart, ...imageParts],
  };
}

function extractText(resp: unknown): string {
  const r = resp as {
    text?: string;
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  return (
    r.text ??
    r.candidates?.[0]?.content?.parts?.[0]?.text ??
    ""
  );
}

function extractUsage(resp: unknown): { promptTokens: number; outputTokens: number } {
  const r = resp as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  return {
    promptTokens: r.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

function parseAndValidate(rawText: string): PropertySceneGraph {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 300)}`);
  }
  return validateSceneGraph(parsed);
}

/**
 * Extract a full scene graph for a listing by sending all photos to Gemini 2.5 Pro.
 * Retries once with an error-correction message on validation failure.
 * Always records a cost_event.
 */
export async function extractSceneGraph(
  listingId: string,
  photos: Array<{ id: string; url: string }>,
): Promise<PropertySceneGraph> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required for scene graph extraction");

  const model = SCENE_GRAPH_MODEL;
  const genai = new GoogleGenAI({ apiKey });
  const now = new Date().toISOString();

  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  const startedAt = Date.now();

  try {
    // ── First attempt ──
    const firstMessage = await buildUserMessage(listingId, photos, now, model);

    const firstResp = await genai.models.generateContent({
      model,
      contents: [firstMessage],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const firstUsage = extractUsage(firstResp);
    totalPromptTokens += firstUsage.promptTokens;
    totalOutputTokens += firstUsage.outputTokens;

    const firstText = extractText(firstResp);
    if (!firstText) {
      throw new Error(
        `Gemini returned no text (finishReason=${
          (firstResp as { candidates?: Array<{ finishReason?: string }> })
            ?.candidates?.[0]?.finishReason ?? "unknown"
        })`,
      );
    }

    let graph: PropertySceneGraph;
    let validationError: string | null = null;

    try {
      graph = parseAndValidate(firstText);
    } catch (err) {
      validationError = err instanceof Error ? err.message : String(err);
      graph = null as unknown as PropertySceneGraph;
    }

    // ── Retry on validation failure ──
    if (validationError !== null) {
      const retryResp = await genai.models.generateContent({
        model,
        contents: [
          firstMessage,
          { role: "model", parts: [{ text: firstText }] },
          {
            role: "user",
            parts: [
              {
                text: `Your previous response failed validation: ${validationError}\n\nRespond again following the PropertySceneGraph schema strictly. Output only valid JSON, no markdown.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const retryUsage = extractUsage(retryResp);
      totalPromptTokens += retryUsage.promptTokens;
      totalOutputTokens += retryUsage.outputTokens;

      const retryText = extractText(retryResp);
      if (!retryText) {
        throw new Error("Gemini retry returned no text");
      }

      // If retry also fails, let the error propagate
      graph = parseAndValidate(retryText);
    }

    const latency_ms = Date.now() - startedAt;
    const cost_cents = geminiCostCents(model, totalPromptTokens, totalOutputTokens);

    try {
      await recordCostEvent({
        propertyId: listingId,
        stage: "analysis",
        provider: "google",
        unitsConsumed: totalPromptTokens + totalOutputTokens,
        unitType: "tokens",
        costCents: cost_cents,
        metadata: {
          scope: "v21_scene_graph",
          model,
          photo_count: photos.length,
          retry: validationError !== null,
          prompt_tokens: totalPromptTokens,
          output_tokens: totalOutputTokens,
          latency_ms,
        },
      });
    } catch {
      // non-fatal — cost tracking must never block graph extraction
    }

    return graph;
  } catch (err) {
    const latency_ms = Date.now() - startedAt;
    const cost_cents = geminiCostCents(model, totalPromptTokens, totalOutputTokens);

    try {
      await recordCostEvent({
        propertyId: listingId,
        stage: "analysis",
        provider: "google",
        unitsConsumed: totalPromptTokens + totalOutputTokens,
        unitType: "tokens",
        costCents: cost_cents,
        metadata: {
          scope: "v21_scene_graph",
          model,
          photo_count: photos.length,
          error: err instanceof Error ? err.message : String(err),
          latency_ms,
        },
      });
    } catch {
      // Do not mask original error
    }

    throw err;
  }
}
