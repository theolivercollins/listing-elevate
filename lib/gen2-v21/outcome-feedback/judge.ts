/**
 * V2.1 outcome judge — rates a rendered paired clip using Gemini 2.5 Pro.
 *
 * Rubric (0–1 aggregate score):
 *   (a) structural_soundness — walls, lines, geometry intact
 *   (b) smooth_motion — gimbal-grade, no jitter
 *   (c) no_morphing — fixtures/materials don't change shape/count
 *
 * The clip is passed as fileData (Gemini video understanding). Source photos
 * A and B are passed as inline base64 for reference grounding.
 *
 * Always records a cost_event with provider='google', scope='v21_outcome_judge'.
 */

import { GoogleGenAI } from "@google/genai";
import { recordCostEvent } from "../../db.js";

// Gemini 2.5 Pro per-million-token pricing (USD). Used for cost estimation.
// Clip video tokens are billed as input tokens.
const PRICE_USD_PER_MTOK = { input: 1.25, output: 10.0 };

/** Compute cost in cents, minimum 1 cent. */
function costCents(promptTokens: number, outputTokens: number): number {
  if (promptTokens === 0 && outputTokens === 0) return 3; // conservative fallback
  return Math.max(
    1,
    Math.ceil(
      promptTokens * (PRICE_USD_PER_MTOK.input / 1_000_000) * 100 +
        outputTokens * (PRICE_USD_PER_MTOK.output / 1_000_000) * 100,
    ),
  );
}

const JUDGE_MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT = `You are a professional video quality judge for real-estate transition clips.
You evaluate rendered clips on three dimensions:
  (a) structural_soundness: walls, lines, geometry remain intact (no warping, bending, or collapsing)
  (b) smooth_motion: gimbal-grade movement with no jitter, shake, or stutter
  (c) no_morphing: fixtures and materials do not change shape, count, or appearance mid-clip
Return ONLY a JSON object with exactly two keys:
  "score": a float 0..1 (average of the three dimensions)
  "reasoning": a single sentence explaining the score`;

interface GeminiScoreResult {
  score: number;
  reasoning: string;
}

function parseJudgeResponse(rawText: string): GeminiScoreResult {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Judge returned non-JSON: ${rawText.slice(0, 200)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)["score"] !== "number" ||
    typeof (parsed as Record<string, unknown>)["reasoning"] !== "string"
  ) {
    throw new Error(`Judge JSON missing required fields: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  const result = parsed as GeminiScoreResult;
  if (result.score < 0 || result.score > 1) {
    throw new Error(`Judge score out of range [0,1]: ${result.score}`);
  }
  return result;
}

/**
 * Judge a rendered paired clip.
 *
 * @param videoUrl        Publicly accessible URL to the rendered mp4 clip
 * @param sourcePhotoA    URL of source photo A (start frame)
 * @param sourcePhotoB    URL of source photo B (end frame)
 */
export async function judgeRenderedClip(
  videoUrl: string,
  sourcePhotoA: string,
  sourcePhotoB: string,
): Promise<{ score: number; reasoning: string; costCents: number }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required for V2.1 outcome judge");

  const startedAt = Date.now();
  let computedCost = 3;

  try {
    const genai = new GoogleGenAI({ apiKey });

    const userText = [
      "You are given two source photos (start frame A, end frame B) and a rendered video transition.",
      "Judge the rendered clip against the rubric. Return only the JSON schema.",
    ].join("\n");

    const resp = await genai.models.generateContent({
      model: JUDGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: userText },
            // Source photo A — passed as URL reference in the prompt text since
            // inlineData requires bytes; callers supply URLs. Gemini can fetch
            // publicly accessible image URLs when passed via fileData.
            {
              fileData: {
                fileUri: sourcePhotoA,
                mimeType: "image/jpeg",
              },
            },
            {
              fileData: {
                fileUri: sourcePhotoB,
                mimeType: "image/jpeg",
              },
            },
            // The rendered clip — Gemini video understanding handles sampling.
            {
              fileData: {
                fileUri: videoUrl,
                mimeType: "video/mp4",
              },
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

    const rawText =
      resp.text ??
      (resp as unknown as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    if (!rawText) {
      const finishReason =
        (resp as unknown as { candidates?: Array<{ finishReason?: string }> })?.candidates?.[0]
          ?.finishReason ?? "unknown";
      throw new Error(`Judge returned no text (finishReason=${finishReason})`);
    }

    const usage = (
      resp as unknown as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }
    ).usageMetadata;

    const promptTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    computedCost = costCents(promptTokens, outputTokens);

    const result = parseJudgeResponse(rawText);
    const latencyMs = Date.now() - startedAt;

    try {
      await recordCostEvent({
        propertyId: null,
        sceneId: null,
        stage: "analysis",
        provider: "google",
        unitsConsumed: 1,
        unitType: "tokens",
        costCents: computedCost,
        metadata: {
          subtype: "v21_outcome_judge",
          scope: "v21_outcome_judge",
          judge_model: JUDGE_MODEL,
          latency_ms: latencyMs,
          prompt_tokens: promptTokens,
          output_tokens: outputTokens,
          video_url: videoUrl,
        },
      });
    } catch {
      // Non-fatal — cost tracking must not block judge result
    }

    return { score: result.score, reasoning: result.reasoning, costCents: computedCost };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    // Record failure cost event so we track partial API consumption
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
          subtype: "v21_outcome_judge",
          scope: "v21_outcome_judge",
          judge_model: JUDGE_MODEL,
          latency_ms: latencyMs,
          judge_error: err instanceof Error ? err.message : String(err),
          video_url: videoUrl,
        },
      });
    } catch {
      // Do not let cost-event failure mask the original judge error
    }
    throw err;
  }
}
