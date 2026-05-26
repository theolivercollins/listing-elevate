/**
 * Apprentice Labeler — Gemini 2.5 Pro few-shot wrapper.
 *
 * Mimics Oliver's pair-picking verdict by passing his most recent operator
 * labels as few-shot examples to Gemini 2.5 Pro.  Up to 10 examples.
 *
 * On Gemini failure: non-throwing — returns a safe fallback prediction
 * with confidence=0 and predicted_verdict='tie'.
 */

import { GoogleGenAI } from "@google/genai";
import type { ApprenticePrediction, PairCandidate, PairLabel, Verdict, TransitionTag } from "../types.js";
import { recordCostEvent } from "../../db.js";

const APPRENTICE_MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT =
  "You are predicting Oliver's verdict for a real-estate-video pair-picking task. " +
  "He has labeled the following examples. Predict his verdict for the new pair.";

const GEMINI_PRICE_USD_PER_MTOK = {
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
} as const;

function apprenticeCostCents(promptTokens: number, outputTokens: number): number {
  if (promptTokens === 0 && outputTokens === 0) return 3;
  const rate = GEMINI_PRICE_USD_PER_MTOK["gemini-2.5-pro"];
  return Math.max(
    1,
    Math.ceil(
      promptTokens * (rate.input / 1_000_000) * 100 +
        outputTokens * (rate.output / 1_000_000) * 100,
    ),
  );
}

interface PhotoRef {
  url: string;
}

interface FewShotExample {
  candidate: PairCandidate;
  photoA: PhotoRef;
  photoB: PhotoRef;
  label: PairLabel;
}

interface GeminiApprenticeResponse {
  predicted_verdict: Verdict;
  predicted_transition_tag: TransitionTag;
  confidence: number;
  reasoning: string;
}

function buildFewShotText(examples: FewShotExample[]): string {
  return examples
    .slice(0, 10)
    .map(
      (ex, i) =>
        `Example ${i + 1}:\n` +
        `  Candidate type: ${ex.candidate.candidate_type}\n` +
        `  Heuristic score: ${ex.candidate.heuristic_score}\n` +
        `  Reasoning: ${ex.candidate.reasoning}\n` +
        `  Photo A URL: ${ex.photoA.url}\n` +
        `  Photo B URL: ${ex.photoB.url}\n` +
        `  Oliver's verdict: ${ex.label.operator_verdict}\n` +
        `  Oliver's transition tag: ${ex.label.transition_tag ?? "none"}`,
    )
    .join("\n\n");
}

function buildUserPrompt(
  candidate: PairCandidate,
  photoA: PhotoRef,
  photoB: PhotoRef,
  fewShotText: string,
): string {
  const parts: string[] = [];
  if (fewShotText) {
    parts.push(`EXAMPLES FROM OLIVER'S LABELS:\n${fewShotText}\n\n---`);
  }
  parts.push(
    `NEW PAIR TO LABEL:\n` +
      `  Candidate type: ${candidate.candidate_type}\n` +
      `  Heuristic score: ${candidate.heuristic_score}\n` +
      `  Reasoning: ${candidate.reasoning}\n` +
      `  Photo A URL: ${photoA.url}\n` +
      `  Photo B URL: ${photoB.url}\n` +
      `\nReturn JSON only: { "predicted_verdict": "good"|"bad"|"tie", "predicted_transition_tag": "push_in"|"walk_through"|"reveal"|"orbit"|"drone_descent"|null, "confidence": 0..1, "reasoning": "..." }`,
  );
  return parts.join("\n");
}

/**
 * Predict Oliver's verdict for a new candidate pair using few-shot examples.
 *
 * @param candidate       The pair to predict
 * @param photoA          Photo A with URL for Gemini vision
 * @param photoB          Photo B with URL for Gemini vision
 * @param fewShotExamples Up to 10 of Oliver's most recent labels (most recent first)
 * @returns               ApprenticePrediction — never throws
 */
export async function predictLabel(
  candidate: PairCandidate,
  photoA: PhotoRef,
  photoB: PhotoRef,
  fewShotExamples: FewShotExample[],
): Promise<ApprenticePrediction> {
  const startedAt = Date.now();
  const cappedExamples = fewShotExamples.slice(0, 10);
  const fewShotLabelIds = cappedExamples.map((ex) => ex.label.label_id);

  const fallback: ApprenticePrediction = {
    candidate_id: candidate.candidate_id,
    predicted_verdict: "tie",
    predicted_transition_tag: null,
    confidence: 0,
    reasoning: "apprentice unavailable",
    model_version: APPRENTICE_MODEL,
    few_shot_label_ids: fewShotLabelIds,
  };

  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return fallback;
    }

    const fewShotText = buildFewShotText(cappedExamples);
    const userText = buildUserPrompt(candidate, photoA, photoB, fewShotText);

    const genai = new GoogleGenAI({ apiKey });

    const resp = await genai.models.generateContent({
      model: APPRENTICE_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: userText }],
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
      (
        resp as unknown as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        }
      )?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    if (!rawText) {
      return fallback;
    }

    let parsed: GeminiApprenticeResponse;
    try {
      const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
      parsed = JSON.parse(cleaned) as GeminiApprenticeResponse;
    } catch {
      return fallback;
    }

    // Validate fields
    const validVerdicts: Verdict[] = ["good", "bad", "tie"];
    const validTags: Array<TransitionTag> = [
      "push_in",
      "walk_through",
      "reveal",
      "orbit",
      "drone_descent",
      null,
    ];
    const predicted_verdict: Verdict = validVerdicts.includes(parsed.predicted_verdict)
      ? parsed.predicted_verdict
      : "tie";
    const predicted_transition_tag: TransitionTag = validTags.includes(
      parsed.predicted_transition_tag,
    )
      ? parsed.predicted_transition_tag
      : null;
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

    const latency_ms = Date.now() - startedAt;

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
    const cost_cents = apprenticeCostCents(promptTokens, outputTokens);

    try {
      await recordCostEvent({
        propertyId: null,
        sceneId: null,
        stage: "analysis",
        provider: "google",
        unitsConsumed: promptTokens + outputTokens,
        unitType: "tokens",
        costCents: cost_cents,
        metadata: {
          subtype: "v21_apprentice",
          scope: "v21_apprentice",
          candidate_id: candidate.candidate_id,
          listing_id: candidate.listing_id,
          model: APPRENTICE_MODEL,
          few_shot_count: cappedExamples.length,
          latency_ms,
          prompt_tokens: promptTokens,
          output_tokens: outputTokens,
        },
      });
    } catch {
      /* non-fatal */
    }

    return {
      candidate_id: candidate.candidate_id,
      predicted_verdict,
      predicted_transition_tag,
      confidence,
      reasoning,
      model_version: APPRENTICE_MODEL,
      few_shot_label_ids: fewShotLabelIds,
    };
  } catch {
    // Non-throwing fallback
    return fallback;
  }
}
