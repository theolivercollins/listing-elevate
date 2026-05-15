import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Property, Scene } from "../../types.js";

// ── Hoisted mocks (must be defined before vi.mock factories run) ───────────────
const {
  mockGetProperty,
  mockGetScenesForProperty,
  mockGetUserVoiceClone,
  mockRecordCostEvent,
  mockLog,
  mockGetSupabase,
  mockTextToSpeech,
  mockGenerateVoiceoverScript,
} = vi.hoisted(() => ({
  mockGetProperty: vi.fn(),
  mockGetScenesForProperty: vi.fn(),
  mockGetUserVoiceClone: vi.fn(),
  mockRecordCostEvent: vi.fn(),
  mockLog: vi.fn(),
  mockGetSupabase: vi.fn(),
  mockTextToSpeech: vi.fn(),
  mockGenerateVoiceoverScript: vi.fn(),
}));

// ── Mock db ───────────────────────────────────────────────────────────────────
vi.mock("../../db.js", () => ({
  getProperty: mockGetProperty,
  getScenesForProperty: mockGetScenesForProperty,
  getUserVoiceClone: mockGetUserVoiceClone,
  recordCostEvent: mockRecordCostEvent,
  log: mockLog,
  getSupabase: mockGetSupabase,
}));

// ── Mock ElevenLabsProvider ───────────────────────────────────────────────────
vi.mock("../../providers/elevenlabs.js", () => ({
  ElevenLabsProvider: vi.fn().mockImplementation(() => ({
    textToSpeech: mockTextToSpeech,
  })),
}));

// ── Mock generateVoiceoverScript ──────────────────────────────────────────────
vi.mock("../script.js", () => ({
  generateVoiceoverScript: mockGenerateVoiceoverScript,
}));

import { runVoiceover } from "../generate.js";
import { ElevenLabsProvider } from "../../providers/elevenlabs.js";

// Set the static DEFAULT_VOICE_ID on the mock class
(ElevenLabsProvider as unknown as { DEFAULT_VOICE_ID: string }).DEFAULT_VOICE_ID =
  "EXAVITQu4vr4xnSDxMaL";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: "prop-1",
    created_at: new Date().toISOString(),
    updated_at: null,
    address: "123 Maple St",
    price: 500000,
    bedrooms: 3,
    bathrooms: 2,
    listing_agent: "John Doe",
    brokerage: null,
    status: "complete",
    photo_count: 10,
    selected_photo_count: 8,
    total_cost_cents: 0,
    processing_time_ms: null,
    horizontal_video_url: null,
    vertical_video_url: null,
    thumbnail_url: null,
    submitted_by: "user-1",
    selected_package: null,
    selected_duration: 60,
    selected_orientation: null,
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
    prompt: "push in",
    duration_seconds: 5,
    status: "qc_pass",
    provider: null,
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

// Supabase storage chain mock
function makeSupabaseMock() {
  const signedUrlResult = {
    data: { signedUrl: "https://cdn.example.com/voiceovers/user-1/prop-1.mp3" },
    error: null,
  };
  const storageMock = {
    upload: vi.fn().mockResolvedValue({ error: null }),
    createSignedUrl: vi.fn().mockResolvedValue(signedUrlResult),
  };
  return {
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    storage: {
      from: vi.fn().mockReturnValue(storageMock),
    },
  };
}

beforeEach(() => {
  mockGetProperty.mockReset();
  mockGetScenesForProperty.mockReset();
  mockGetUserVoiceClone.mockReset();
  mockRecordCostEvent.mockReset();
  mockLog.mockReset();
  mockGetSupabase.mockReset();
  mockTextToSpeech.mockReset();
  mockGenerateVoiceoverScript.mockReset();

  mockRecordCostEvent.mockResolvedValue(undefined);
  mockLog.mockResolvedValue(undefined);
  mockGetUserVoiceClone.mockResolvedValue({ voice_id: null, status: "none" });

  mockGetSupabase.mockReturnValue(makeSupabaseMock());
  process.env.ELEVENLABS_API_KEY = "test-key";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.ELEVENLABS_API_KEY;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runVoiceover — add_voiceover=false", () => {
  it("returns null without calling TTS or script generation", async () => {
    mockGetProperty.mockResolvedValue(makeProperty({ add_voiceover: false }));
    mockGetScenesForProperty.mockResolvedValue([makeScene(1)]);

    const result = await runVoiceover("prop-1");

    expect(result).toBeNull();
    expect(mockGenerateVoiceoverScript).not.toHaveBeenCalled();
    expect(mockTextToSpeech).not.toHaveBeenCalled();
  });
});

describe("runVoiceover — voice clone fallback", () => {
  it("uses default voice when add_voice_clone=true but clone status is not 'ready'", async () => {
    mockGetProperty.mockResolvedValue(
      makeProperty({ add_voiceover: true, add_voice_clone: true, submitted_by: "user-1" }),
    );
    mockGetScenesForProperty.mockResolvedValue([makeScene(1)]);
    // Clone enrolling — not ready
    mockGetUserVoiceClone.mockResolvedValue({ voice_id: null, status: "enrolling" });

    mockGenerateVoiceoverScript.mockResolvedValue({
      script: "Welcome home. Schedule a tour with John Doe today.",
      estimatedSpokenSeconds: 5,
      usage: { inputTokens: 100, outputTokens: 50, costCents: 0.5, model: "claude-sonnet-4-6" },
    });

    mockTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from("mp3"),
      chars: 50,
      costCents: 1,
      modelId: "eleven_turbo_v2_5",
    });

    const result = await runVoiceover("prop-1");

    expect(result).not.toBeNull();
    expect(result?.voiceIdUsed).toBe("EXAVITQu4vr4xnSDxMaL");
    // A warn log should have been issued
    const warnCall = mockLog.mock.calls.find(
      (c: unknown[]) => c[2] === "warn" && String(c[3]).includes("not ready"),
    );
    expect(warnCall).toBeDefined();
  });

  it("uses default voice when clone is ready but voice_id is null", async () => {
    mockGetProperty.mockResolvedValue(
      makeProperty({ add_voiceover: true, add_voice_clone: true, submitted_by: "user-1" }),
    );
    mockGetScenesForProperty.mockResolvedValue([makeScene(1)]);
    mockGetUserVoiceClone.mockResolvedValue({ voice_id: null, status: "ready" });

    mockGenerateVoiceoverScript.mockResolvedValue({
      script: "Welcome home.",
      estimatedSpokenSeconds: 3,
      usage: { inputTokens: 50, outputTokens: 10, costCents: 0.1, model: "claude-sonnet-4-6" },
    });

    mockTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from("mp3"),
      chars: 12,
      costCents: 1,
      modelId: "eleven_turbo_v2_5",
    });

    const result = await runVoiceover("prop-1");
    expect(result?.voiceIdUsed).toBe("EXAVITQu4vr4xnSDxMaL");
  });
});

describe("runVoiceover — success path", () => {
  it("returns audioUrl and voiceIdUsed on success", async () => {
    mockGetProperty.mockResolvedValue(makeProperty({ add_voiceover: true, add_voice_clone: false }));
    mockGetScenesForProperty.mockResolvedValue([makeScene(1), makeScene(2)]);

    mockGenerateVoiceoverScript.mockResolvedValue({
      script: "Welcome home to 123 Maple St. Schedule a tour with John Doe today.",
      estimatedSpokenSeconds: 8,
      usage: { inputTokens: 100, outputTokens: 50, costCents: 0.5, model: "claude-sonnet-4-6" },
    });

    mockTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from("mp3-content"),
      chars: 65,
      costCents: 1,
      modelId: "eleven_turbo_v2_5",
    });

    const result = await runVoiceover("prop-1");

    expect(result).not.toBeNull();
    expect(result?.audioUrl).toContain("voiceovers");
    expect(result?.voiceIdUsed).toBe("EXAVITQu4vr4xnSDxMaL");
    expect(mockRecordCostEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "voiceover",
        provider: "elevenlabs",
        unitsConsumed: 65,
      }),
    );
  });
});

describe("runVoiceover — error handling", () => {
  it("returns null (does not throw) when TTS fails", async () => {
    mockGetProperty.mockResolvedValue(makeProperty({ add_voiceover: true }));
    mockGetScenesForProperty.mockResolvedValue([makeScene(1)]);

    mockGenerateVoiceoverScript.mockResolvedValue({
      script: "Welcome home.",
      estimatedSpokenSeconds: 3,
      usage: { inputTokens: 50, outputTokens: 10, costCents: 0.1, model: "claude-sonnet-4-6" },
    });

    mockTextToSpeech.mockRejectedValue(new Error("TTS API down"));

    const result = await runVoiceover("prop-1");
    expect(result).toBeNull();
  });
});

describe("runVoiceover — TTS cost calculation", () => {
  it("passes chars and costCents from TTS to recordCostEvent correctly", async () => {
    mockGetProperty.mockResolvedValue(makeProperty({ add_voiceover: true }));
    mockGetScenesForProperty.mockResolvedValue([makeScene(1)]);

    mockGenerateVoiceoverScript.mockResolvedValue({
      script: "x".repeat(500),
      estimatedSpokenSeconds: 10,
      usage: { inputTokens: 100, outputTokens: 20, costCents: 0.2, model: "claude-sonnet-4-6" },
    });

    // eleven_turbo_v2_5: Math.ceil(500 * 0.000050 * 100) = Math.ceil(2.5) = 3
    mockTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from("mp3"),
      chars: 500,
      costCents: 3,
      modelId: "eleven_turbo_v2_5",
    });

    await runVoiceover("prop-1");

    const elevenlabsCostCall = mockRecordCostEvent.mock.calls.find(
      (c: unknown[]) => (c[0] as { provider: string }).provider === "elevenlabs",
    );
    expect(elevenlabsCostCall).toBeDefined();
    expect((elevenlabsCostCall![0] as { costCents: number }).costCents).toBe(3);
    expect((elevenlabsCostCall![0] as { unitsConsumed: number }).unitsConsumed).toBe(500);
  });
});
