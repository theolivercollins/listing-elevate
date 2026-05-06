/**
 * P3 — image-embedding provider wrapper.
 *
 * Provider: Gemini `gemini-embedding-2` via @google/genai SDK (same dep as
 * lib/providers/gemini-analyzer.ts). outputDimensionality=768.
 *
 * Kill-switch: ENABLE_IMAGE_EMBEDDINGS env (default "false"). When disabled,
 * embedImage throws EmbeddingsDisabledError before any API call.
 */

import { GoogleGenAI } from "@google/genai";
import { recordCostEvent } from "./db.js";

export const IMAGE_EMBEDDING_MODEL = "gemini-embedding-2" as const;
export const IMAGE_EMBEDDING_DIM = 768 as const;

export interface ImageEmbedding {
  vector: number[]; // length 768
  model: typeof IMAGE_EMBEDDING_MODEL;
  dim: typeof IMAGE_EMBEDDING_DIM;
}

export interface EmbedImageInput {
  imageUrl: string;
  imageBytes?: Buffer;
  photoId?: string;
  sessionId?: string;
  surface: "lab" | "prod" | "backfill";
}

export class EmbeddingsDisabledError extends Error {
  constructor() {
    super("ENABLE_IMAGE_EMBEDDINGS !== 'true'; image embedding skipped. See docs/state/P3-IMPLEMENTATION-STATUS.md.");
    this.name = "EmbeddingsDisabledError";
  }
}

export function isEnabled(): boolean {
  return process.env.ENABLE_IMAGE_EMBEDDINGS === "true";
}

/**
 * Embed a single image via Gemini. Returns { vector, model, dim }.
 *
 * Cost: ~$0.00012 per image at 2026-04-22 Gemini pricing. Logs cost_event
 * with stage='analysis', provider='google', metadata.subtype='image_embedding',
 * metadata.surface (lab|prod|backfill), metadata.photo_id | session_id.
 *
 * IMPLEMENTATION DEFERRED to P3 S1: see TODO(p3-s1) block below. The
 * skeleton exists so backfill + test infrastructure can land before
 * binding-verification (per Oliver Q2: defer billing check to first call).
 */
export async function embedImage(input: EmbedImageInput): Promise<ImageEmbedding> {
  if (!isEnabled()) {
    throw new EmbeddingsDisabledError();
  }

  const startedAt = Date.now();

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required for image embeddings");

    // Fetch image bytes if not supplied.
    let bytes = input.imageBytes;
    if (!bytes) {
      const res = await fetch(input.imageUrl);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
    }
    const mimeType = input.imageUrl.toLowerCase().endsWith(".png")
      ? "image/png"
      : input.imageUrl.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

    const genai = new GoogleGenAI({ apiKey });

    const resp = await genai.models.embedContent({
      model: IMAGE_EMBEDDING_MODEL,
      contents: [
        {
          parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }],
        },
      ],
      config: { outputDimensionality: IMAGE_EMBEDDING_DIM },
    });

    // Handle both response shapes: embeddings[].values and embedding.values
    const vector =
      (resp as any)?.embeddings?.[0]?.values ??
      (resp as any)?.embedding?.values ??
      null;
    if (!vector || vector.length !== IMAGE_EMBEDDING_DIM) {
      throw new Error(
        `Unexpected embedding shape: got ${vector?.length ?? 0}, expected ${IMAGE_EMBEDDING_DIM}`,
      );
    }

    const latency_ms = Date.now() - startedAt;

    // Audit B C3: gemini-embedding-2 flat per-call pricing ~$0.00012/image.
    // Math.ceil so sub-cent amounts round UP to 1¢ for dashboard visibility.
    // $0.00012 = 0.012¢ → rounds up to 1¢.
    const cost_cents = Math.ceil(0.00012 * 100); // = 1¢

    try {
      await recordCostEvent({
        propertyId: null,
        sceneId: null,
        stage: "analysis",
        provider: "google",
        unitsConsumed: 1,
        unitType: "tokens",
        costCents: cost_cents,
        metadata: {
          subtype: "image_embedding",
          surface: input.surface,
          photo_id: input.photoId ?? null,
          session_id: input.sessionId ?? null,
          model: IMAGE_EMBEDDING_MODEL,
          dim: IMAGE_EMBEDDING_DIM,
          latency_ms,
          // Flat per-image pricing at 2026-04-22 Gemini rates ($0.00012/image).
          // costCents rounded up to 1¢ for dashboard visibility.
          pricing_note: "gemini-embedding-2 flat $0.00012/image; ceiled to 1¢",
        },
      });
    } catch { /* non-fatal */ }

    return { vector, model: IMAGE_EMBEDDING_MODEL, dim: IMAGE_EMBEDDING_DIM };
  } catch (err) {
    const latency_ms = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    try {
      await recordCostEvent({
        propertyId: null,
        sceneId: null,
        stage: "analysis",
        provider: "google",
        unitsConsumed: 1,
        unitType: "tokens",
        costCents: 0,
        metadata: {
          subtype: "image_embedding",
          surface: input.surface,
          photo_id: input.photoId ?? null,
          session_id: input.sessionId ?? null,
          model: IMAGE_EMBEDDING_MODEL,
          dim: IMAGE_EMBEDDING_DIM,
          latency_ms,
          error: message,
        },
      });
    } catch {
      // Never mask the original error with a cost-event failure.
    }
    throw err;
  }
}
