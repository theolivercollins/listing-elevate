import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @google/genai before importing module under test
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

vi.mock("../../db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

import { judgeRenderedClip } from "./judge.js";
import { recordCostEvent } from "../../db.js";

const VALID_RESPONSE = JSON.stringify({ score: 0.85, reasoning: "Smooth gimbal movement, geometry intact." });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-api-key";
  mockGenerateContent.mockResolvedValue({
    text: VALID_RESPONSE,
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50 },
  });
});

describe("judgeRenderedClip", () => {
  it("returns score and reasoning on success", async () => {
    const result = await judgeRenderedClip(
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/photo_a.jpg",
      "https://cdn.example.com/photo_b.jpg",
    );
    expect(result.score).toBe(0.85);
    expect(result.reasoning).toBe("Smooth gimbal movement, geometry intact.");
    expect(result.costCents).toBeGreaterThan(0);
  });

  it("records a cost event on success", async () => {
    await judgeRenderedClip(
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/photo_a.jpg",
      "https://cdn.example.com/photo_b.jpg",
    );
    expect(recordCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        metadata: expect.objectContaining({ scope: "v21_outcome_judge" }),
      }),
    );
  });

  it("throws when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await expect(
      judgeRenderedClip("https://cdn.example.com/clip.mp4", "a", "b"),
    ).rejects.toThrow("GEMINI_API_KEY or GOOGLE_API_KEY required");
  });

  it("throws when Gemini returns non-JSON", async () => {
    process.env.GEMINI_API_KEY = "test-api-key";
    mockGenerateContent.mockResolvedValue({ text: "not json at all" });
    await expect(
      judgeRenderedClip("https://cdn.example.com/clip.mp4", "a", "b"),
    ).rejects.toThrow("non-JSON");
  });

  it("throws when score is out of range", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ score: 1.5, reasoning: "test" }),
    });
    await expect(
      judgeRenderedClip("https://cdn.example.com/clip.mp4", "a", "b"),
    ).rejects.toThrow("score out of range");
  });

  it("records failure cost event when Gemini throws", async () => {
    process.env.GEMINI_API_KEY = "test-api-key";
    mockGenerateContent.mockRejectedValue(new Error("Gemini network error"));
    await expect(
      judgeRenderedClip("https://cdn.example.com/clip.mp4", "a", "b"),
    ).rejects.toThrow("Gemini network error");
    // Failure cost event should still be recorded
    expect(recordCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        costCents: 0,
        metadata: expect.objectContaining({ judge_error: "Gemini network error" }),
      }),
    );
  });

  it("accepts GOOGLE_API_KEY as fallback when GEMINI_API_KEY absent", async () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "fallback-key";
    const result = await judgeRenderedClip(
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/photo_a.jpg",
      "https://cdn.example.com/photo_b.jpg",
    );
    expect(result.score).toBe(0.85);
  });

  it("throws when judge response missing required fields", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ score: 0.8 }), // missing reasoning
    });
    await expect(
      judgeRenderedClip("https://cdn.example.com/clip.mp4", "a", "b"),
    ).rejects.toThrow("missing required fields");
  });
});
