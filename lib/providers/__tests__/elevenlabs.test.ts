import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElevenLabsProvider } from "../elevenlabs.js";

// Helpers
const mockFetch = vi.fn();
const FAKE_KEY = "test-xi-key";

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  process.env.ELEVENLABS_API_KEY = FAKE_KEY;
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ELEVENLABS_API_KEY;
});

describe("ElevenLabsProvider constructor", () => {
  it("throws when ELEVENLABS_API_KEY is not set", () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => new ElevenLabsProvider()).toThrow("ELEVENLABS_API_KEY is not set");
  });

  it("constructs successfully when key is set", () => {
    expect(() => new ElevenLabsProvider()).not.toThrow();
  });
});

describe("ElevenLabsProvider.textToSpeech", () => {
  it("happy path: returns audioBuffer, chars, costCents, modelId", async () => {
    const fakeAudio = Buffer.from("fake-mp3-data");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeAudio.buffer,
    });

    const provider = new ElevenLabsProvider();
    const result = await provider.textToSpeech({
      voiceId: "test-voice",
      text: "Hello world",
    });

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.chars).toBe(11); // "Hello world".length
    expect(result.modelId).toBe("eleven_turbo_v2_5");
    // cost: ceil(11 * 0.000050 * 100) = ceil(0.055) = 1
    expect(result.costCents).toBe(1);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/text-to-speech/test-voice");
    expect((opts.headers as Record<string, string>)["xi-api-key"]).toBe(FAKE_KEY);
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const provider = new ElevenLabsProvider();
    await expect(
      provider.textToSpeech({ voiceId: "v", text: "hi" }),
    ).rejects.toThrow("ElevenLabs TTS error 401: Unauthorized");
  });

  it("cost calculation: 1000 chars at eleven_multilingual_v2 rate", async () => {
    const fakeAudio = Buffer.from("x");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeAudio.buffer,
    });

    const provider = new ElevenLabsProvider();
    const text = "a".repeat(1000);
    const result = await provider.textToSpeech({
      voiceId: "v",
      text,
      modelId: "eleven_multilingual_v2",
    });

    // Math.ceil(1000 * 0.000180 * 100) — floating point yields 18.000...004 → 19
    expect(result.costCents).toBe(Math.ceil(1000 * 0.000180 * 100));
    expect(result.chars).toBe(1000);
    expect(result.modelId).toBe("eleven_multilingual_v2");
  });
});

describe("ElevenLabsProvider.cloneVoice", () => {
  it("happy path: returns voiceId from JSON response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ voice_id: "cloned-voice-123" }),
    });

    const provider = new ElevenLabsProvider();
    const result = await provider.cloneVoice({
      name: "Test Agent",
      description: "Test voice",
      samples: [
        { filename: "sample.mp3", mimeType: "audio/mpeg", data: Buffer.from("audio") },
      ],
    });

    expect(result.voiceId).toBe("cloned-voice-123");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/voices/add");
    expect((opts.headers as Record<string, string>)["xi-api-key"]).toBe(FAKE_KEY);
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "Unprocessable Entity",
    });

    const provider = new ElevenLabsProvider();
    await expect(
      provider.cloneVoice({
        name: "x",
        samples: [{ filename: "s.mp3", mimeType: "audio/mpeg", data: Buffer.from("") }],
      }),
    ).rejects.toThrow("ElevenLabs IVC error 422: Unprocessable Entity");
  });
});

describe("ElevenLabsProvider.DEFAULT_VOICE_ID", () => {
  it("is the Sarah voice id", () => {
    expect(ElevenLabsProvider.DEFAULT_VOICE_ID).toBe("EXAVITQu4vr4xnSDxMaL");
  });
});
