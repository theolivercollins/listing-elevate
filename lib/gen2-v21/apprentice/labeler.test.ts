/**
 * Tests for apprentice labeler.
 * Gemini client is mocked — no real API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PairCandidate, PairLabel } from "../types.js";

// Mock @google/genai before importing labeler
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn(),
      },
    })),
  };
});

// Mock db recordCostEvent
vi.mock("../../db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

import { GoogleGenAI } from "@google/genai";
import { predictLabel } from "./labeler.js";

const makeMockGenAI = (responseText: string, usageMeta?: object) => {
  const mockGenerateContent = vi.fn().mockResolvedValue({
    text: responseText,
    usageMetadata: usageMeta ?? { promptTokenCount: 100, candidatesTokenCount: 50 },
  });
  (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  }));
  return mockGenerateContent;
};

const candidate: PairCandidate = {
  candidate_id: "cand-001",
  listing_id: "listing-abc",
  photo_a_id: "photo-a",
  photo_b_id: "photo-b",
  candidate_type: "walkthrough_via_portal",
  heuristic_score: 0.8,
  reasoning: "Portal open path connects kitchen to living room",
  portal_id: "portal-1",
};

const photoA = { url: "https://example.com/photo-a.jpg" };
const photoB = { url: "https://example.com/photo-b.jpg" };

const fewShotLabel: PairLabel = {
  label_id: "label-001",
  listing_id: "listing-abc",
  photo_a_id: "photo-x",
  photo_b_id: "photo-y",
  scene_graph_version: "v1",
  model_version_at_prediction: null,
  model_prediction_at_time: null,
  operator_verdict: "good",
  transition_tag: "walk_through",
  thumbnail_hash_a: "hash-a",
  thumbnail_hash_b: "hash-b",
  source_mode: "directors_cut",
  apprentice_predicted_verdict: null,
  apprentice_was_wrong: null,
  created_at: "2026-05-23T10:00:00Z",
};

const fewShotExamples = [
  {
    candidate: { ...candidate, candidate_id: "cand-000" },
    photoA: { url: "https://example.com/photo-x.jpg" },
    photoB: { url: "https://example.com/photo-y.jpg" },
    label: fewShotLabel,
  },
];

describe("predictLabel — happy path", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-api-key";
  });

  it("returns a valid ApprenticePrediction on successful Gemini response", async () => {
    makeMockGenAI(
      JSON.stringify({
        predicted_verdict: "good",
        predicted_transition_tag: "walk_through",
        confidence: 0.87,
        reasoning: "Strong portal alignment matches Oliver's prior examples.",
      }),
    );

    const result = await predictLabel(candidate, photoA, photoB, fewShotExamples);

    expect(result.candidate_id).toBe("cand-001");
    expect(result.predicted_verdict).toBe("good");
    expect(result.predicted_transition_tag).toBe("walk_through");
    expect(result.confidence).toBeCloseTo(0.87);
    expect(result.reasoning).toContain("portal");
    expect(result.model_version).toBe("gemini-2.5-pro");
    expect(result.few_shot_label_ids).toEqual(["label-001"]);
  });

  it("records few_shot_label_ids from the examples passed", async () => {
    makeMockGenAI(
      JSON.stringify({
        predicted_verdict: "bad",
        predicted_transition_tag: null,
        confidence: 0.6,
        reasoning: "No clear transition.",
      }),
    );

    const multiExamples = [
      fewShotExamples[0],
      {
        ...fewShotExamples[0],
        label: { ...fewShotLabel, label_id: "label-002" },
      },
    ];

    const result = await predictLabel(candidate, photoA, photoB, multiExamples);
    expect(result.few_shot_label_ids).toEqual(["label-001", "label-002"]);
  });
});

describe("predictLabel — Gemini failure non-throwing", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-api-key";
  });

  it("returns safe fallback when Gemini throws", async () => {
    const mockGenerateContent = vi.fn().mockRejectedValue(new Error("API quota exceeded"));
    (GoogleGenAI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      models: { generateContent: mockGenerateContent },
    }));

    const result = await predictLabel(candidate, photoA, photoB, []);

    expect(result.predicted_verdict).toBe("tie");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("apprentice unavailable");
    expect(result.candidate_id).toBe("cand-001");
  });

  it("returns safe fallback when GEMINI_API_KEY is missing", async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    const savedAlt = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await predictLabel(candidate, photoA, photoB, []);

    expect(result.predicted_verdict).toBe("tie");
    expect(result.confidence).toBe(0);

    process.env.GEMINI_API_KEY = savedKey;
    if (savedAlt) process.env.GOOGLE_API_KEY = savedAlt;
  });

  it("returns safe fallback when Gemini returns non-JSON", async () => {
    makeMockGenAI("This is not JSON at all, sorry");

    const result = await predictLabel(candidate, photoA, photoB, []);

    expect(result.predicted_verdict).toBe("tie");
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("apprentice unavailable");
  });
});
