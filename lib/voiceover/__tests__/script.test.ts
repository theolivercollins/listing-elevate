import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// ── Mock db (recordCostEvent) ─────────────────────────────────────────────────
vi.mock("../../db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock claude-cost (lightweight) ───────────────────────────────────────────
vi.mock("../../utils/claude-cost.js", () => ({
  computeClaudeCost: vi.fn().mockReturnValue({
    costCents: 0.5,
    totalTokens: 100,
    model: "claude-sonnet-4-6",
    breakdown: { input: 80, output: 20, cacheRead: 0, cacheWrite: 0 },
  }),
}));

import { generateVoiceoverScript } from "../script.js";
import type { Property, Scene } from "../../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    created_at: new Date().toISOString(),
    updated_at: null,
    address: "123 Maple St, Austin TX 78701",
    price: 750000,
    bedrooms: 4,
    bathrooms: 3,
    listing_agent: "Jane Smith",
    brokerage: "Premier Realty",
    status: "complete",
    photo_count: 10,
    selected_photo_count: 8,
    total_cost_cents: 0,
    processing_time_ms: null,
    horizontal_video_url: null,
    vertical_video_url: null,
    thumbnail_url: null,
    submitted_by: "user-1",
    selected_package: "just_listed",
    selected_duration: 60,
    selected_orientation: "landscape",
    add_voiceover: true,
    add_voice_clone: false,
    add_custom_request: false,
    custom_request_text: null,
    days_on_market: null,
    sold_price: null,
    voiceover_script: null,
    voiceover_audio_url: null,
    voiceover_voice_id_used: null,
    voiceover_chars: null,
    voiceover_duration_seconds: null,
    ...overrides,
  };
}

function makeScene(n: number): Scene {
  return {
    id: `scene-${n}`,
    property_id: "prop-1",
    photo_id: `photo-${n}`,
    scene_number: n,
    camera_movement: "push_in",
    prompt: `push in on living room`,
    duration_seconds: 5,
    status: "qc_pass",
    provider: "kling",
    provider_task_id: null,
    generation_cost_cents: null,
    generation_time_ms: null,
    clip_url: null,
    attempt_count: 1,
    qc_verdict: null,
    qc_issues: null,
    qc_confidence: null,
    end_photo_id: null,
    end_image_url: null,
  };
}

function scriptWithWords(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

function mockClaudeResponse(text: string) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text }],
    usage: { input_tokens: 80, output_tokens: 20 },
  });
}

beforeEach(() => {
  mockCreate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateVoiceoverScript — word count fits duration budget", () => {
  it("15s: produces a script within ±20% of 38 words", async () => {
    // 38 words ±20% → [30, 46]
    const targetWords = 35;
    mockClaudeResponse(scriptWithWords(targetWords));

    const result = await generateVoiceoverScript({
      property: makeProperty({ selected_duration: 15 }),
      scenes: [makeScene(1), makeScene(2)],
      durationSeconds: 15,
    });

    const wordCount = result.script.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(30);
    expect(wordCount).toBeLessThanOrEqual(46);
  });

  it("30s: produces a script within ±20% of 77 words", async () => {
    // 77 words ±20% → [62, 92]
    const targetWords = 70;
    mockClaudeResponse(scriptWithWords(targetWords));

    const result = await generateVoiceoverScript({
      property: makeProperty({ selected_duration: 30 }),
      scenes: [makeScene(1), makeScene(2), makeScene(3)],
      durationSeconds: 30,
    });

    const wordCount = result.script.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(62);
    expect(wordCount).toBeLessThanOrEqual(92);
  });

  it("60s: produces a script within ±20% of 155 words", async () => {
    // 155 words ±20% → [124, 186]
    const targetWords = 142;
    mockClaudeResponse(scriptWithWords(targetWords));

    const result = await generateVoiceoverScript({
      property: makeProperty({ selected_duration: 60 }),
      scenes: [makeScene(1), makeScene(2), makeScene(3), makeScene(4)],
      durationSeconds: 60,
    });

    const wordCount = result.script.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(124);
    expect(wordCount).toBeLessThanOrEqual(186);
  });
});

describe("generateVoiceoverScript — estimatedSpokenSeconds", () => {
  it("computes estimatedSpokenSeconds from word count", async () => {
    // 155 words → 60 seconds exactly
    mockClaudeResponse(scriptWithWords(155));

    const result = await generateVoiceoverScript({
      property: makeProperty(),
      scenes: [makeScene(1)],
      durationSeconds: 60,
    });

    // 155 / (155/60) = 60
    expect(result.estimatedSpokenSeconds).toBe(60);
  });
});

describe("generateVoiceoverScript — usage returned", () => {
  it("returns usage with inputTokens, outputTokens, model", async () => {
    mockClaudeResponse("Welcome home to 123 Maple St. Schedule a tour with Jane Smith today.");

    const result = await generateVoiceoverScript({
      property: makeProperty(),
      scenes: [makeScene(1)],
      durationSeconds: 30,
    });

    expect(result.usage.model).toBe("claude-sonnet-4-6");
    expect(result.usage.inputTokens).toBe(80);
    expect(result.usage.outputTokens).toBe(20);
    expect(typeof result.usage.costCents).toBe("number");
  });
});
