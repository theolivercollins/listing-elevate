import { describe, it, expect, vi, beforeEach } from "vitest";
import { trimToWordBudget, countWords } from "./generate-script.js";

// ── Pure helpers (no mocking needed) ──────────────────────────────────────────

describe("countWords", () => {
  it("counts single words", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("counts multi-word strings", () => {
    expect(countWords("hello world foo")).toBe(3);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(countWords("  hello world  ")).toBe(2);
  });

  it("handles extra internal spaces", () => {
    expect(countWords("one  two   three")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("trimToWordBudget", () => {
  it("returns the string unchanged when under budget", () => {
    const text = "The view is exceptional.";
    expect(trimToWordBudget(text, 10)).toBe(text.trim());
  });

  it("trims exactly to budget when over", () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const trimmed = trimToWordBudget(words, 37);
    expect(countWords(trimmed)).toBe(37);
  });

  it("returns exactly N words for a 37-word budget (15s)", () => {
    // 15-second budget
    const script = Array.from({ length: 50 }, () => "light").join(" ");
    const trimmed = trimToWordBudget(script, 37);
    expect(countWords(trimmed)).toBe(37);
  });

  it("returns exactly N words for a 75-word budget (30s)", () => {
    const script = Array.from({ length: 100 }, () => "space").join(" ");
    const trimmed = trimToWordBudget(script, 75);
    expect(countWords(trimmed)).toBe(75);
  });

  it("returns exactly N words for a 150-word budget (60s)", () => {
    const script = Array.from({ length: 200 }, () => "view").join(" ");
    const trimmed = trimToWordBudget(script, 150);
    expect(countWords(trimmed)).toBe(150);
  });

  it("handles already-budgeted text without modifying it", () => {
    const text = "a b c d e";
    expect(trimToWordBudget(text, 5)).toBe("a b c d e");
    expect(trimToWordBudget(text, 10)).toBe("a b c d e");
  });

  it("trims a realistic script that exceeds the 15s budget", () => {
    // 42 words — 5 over the 37-word 15s budget
    const overBudget =
      "This rare corner unit offers floor-to-ceiling windows with panoramic views " +
      "of the city skyline, a chef kitchen, and direct access to the private roof terrace — " +
      "all in a full-service building steps from the park.";
    const result = trimToWordBudget(overBudget, 37);
    expect(countWords(result)).toBeLessThanOrEqual(37);
  });

  // ── Sentence-aware trimming (prod failure: 15s script cut mid-sentence) ────


  it("cuts at the last complete sentence boundary within the budget", () => {
    // Real-world shape: budget lands mid-way through the final sentence.
    const script =
      "Soaring ceilings and a chef's kitchen anchor this waterfront retreat. " + // 10 words
      "Outside, the heated pool overlooks the canal with direct Gulf access. " + // 11 words
      "Just listed at $599,900 — your Florida dream home is waiting for you today."; // 14 words
    // Budget of 25 words falls inside sentence 3 → trim back to end of sentence 2.
    const result = trimToWordBudget(script, 25);
    expect(result).toBe(
      "Soaring ceilings and a chef's kitchen anchor this waterfront retreat. " +
        "Outside, the heated pool overlooks the canal with direct Gulf access.",
    );
    expect(result.endsWith(".")).toBe(true);
  });

  it("never ends mid-sentence", () => {
    const script =
      "First sentence here ends now. Second sentence runs much longer than the remaining budget allows for sure.";
    const result = trimToWordBudget(script, 8);
    expect(result).toBe("First sentence here ends now.");
  });

  it("handles ! and ? sentence boundaries", () => {
    const script = "What a view! The sunsets here are unforgettable every single evening of the year.";
    expect(trimToWordBudget(script, 7)).toBe("What a view!");
  });

  it("appends a period when no sentence boundary exists in the slice", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const result = trimToWordBudget(words, 37);
    expect(countWords(result)).toBe(37);
    expect(result.endsWith(".")).toBe(true);
  });

  it("does not treat decimals like $1.2 as sentence boundaries", () => {
    const script =
      "Priced at $1.2 million this estate spans three lush acres with mature oaks and a private gated drive plus a guest house";
    const result = trimToWordBudget(script, 10);
    // The "." inside $1.2 must not count as a boundary → fallback applies.
    expect(countWords(result)).toBe(10);
    expect(result.endsWith(".")).toBe(true);
    expect(result.startsWith("Priced at $1.2 million")).toBe(true);
  });
});

// ── generateVoiceoverScript (mocked Anthropic) ────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: Array(40).fill("word").join(" ") }],
          usage: { input_tokens: 500, output_tokens: 40 },
        }),
      },
    })),
  };
});

vi.mock("../db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("generateVoiceoverScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enforces the 37-word budget for 15s even when model returns more", async () => {
    const { generateVoiceoverScript } = await import("./generate-script.js");
    const result = await generateVoiceoverScript({
      description: "A beautiful property in the heart of the city.",
      durationSec: 15,
      address: "123 Main St, New York",
      packageLabel: "Just Listed",
      propertyId: null,
    });
    // Model mock returns 40 words; budget for 15s is 37
    expect(result.wordCount).toBeLessThanOrEqual(37);
    expect(result.script.length).toBeGreaterThan(0);
  });

  it("returns wordCount matching the trimmed script", async () => {
    const { generateVoiceoverScript } = await import("./generate-script.js");
    const result = await generateVoiceoverScript({
      description: "Bright open plan living, double garage, landscaped garden.",
      durationSec: 30,
      address: "456 Oak Ave, Austin TX",
      packageLabel: "Just Listed",
      propertyId: null,
    });
    expect(result.wordCount).toBe(countWords(result.script));
  });
});
