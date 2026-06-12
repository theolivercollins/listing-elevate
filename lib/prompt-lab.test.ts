// Tests for Task 8: submitLabRender SKU threading + AtlasProvider ctor arg.
// We mock the Atlas network call so no real credentials are required.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { V1_DEFAULT_SKU, V1_ATLAS_SKUS } from "./providers/atlas.js";

// ─── Mock AtlasProvider so no real HTTP calls are made ────────────────────────
// Capture constructor calls so we can assert on the sku that was passed.
const atlasConstructorCalls: Array<string | undefined> = [];

vi.mock("./providers/atlas.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/atlas.js")>();

  // Use a real class so `new AtlasProvider(...)` works correctly.
  class MockAtlasProvider {
    name = "atlas" as const;
    _resolvedModel: string;
    constructor(modelOverride?: string) {
      atlasConstructorCalls.push(modelOverride);
      this._resolvedModel = modelOverride ?? process.env.ATLAS_VIDEO_MODEL ?? "kling-v2-6-pro";
    }
    async generateClip() {
      return { jobId: "mock-job-id", estimatedSeconds: 90 };
    }
    async checkStatus() { return { status: "processing" as const }; }
    async downloadClip() { return Buffer.from(""); }
  }

  return {
    ...actual,
    AtlasProvider: MockAtlasProvider,
  };
});

// Mock fetch (used to download the source image in submitLabRender).
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
} as Response);

import { submitLabRender } from "./prompt-lab.js";

const baseScene = {
  scene_number: 1,
  photo_id: "test-photo",
  room_type: "living_room" as const,
  camera_movement: "push_in" as const,
  prompt: "slow cinematic push in toward the fireplace",
  duration_seconds: 5,
  provider_preference: null,
};

describe("submitLabRender — SKU threading", () => {
  beforeEach(() => {
    // Ensure the env default is predictable for these tests.
    process.env.ATLASCLOUD_API_KEY = "test-key";
    delete process.env.ATLAS_VIDEO_MODEL;
    atlasConstructorCalls.length = 0;
    // Reset fetch mock.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response);
  });

  it("returns the resolved SKU in the result shape", async () => {
    const result = await submitLabRender({
      imageUrl: "https://cdn.example.com/photo.jpg",
      scene: baseScene,
      roomType: "living_room",
    });
    expect(result).toHaveProperty("jobId");
    expect(result).toHaveProperty("provider");
    expect(result).toHaveProperty("sku");
    expect(result).toHaveProperty("staticSku");
    expect(typeof result.sku).toBe("string");
    expect(typeof result.staticSku).toBe("string");
  });

  it("defaults to kling-v2-6-pro when no sku override is provided", async () => {
    const result = await submitLabRender({
      imageUrl: "https://cdn.example.com/photo.jpg",
      scene: baseScene,
      roomType: "living_room",
      sku: null,
    });
    expect(result.sku).toBe(V1_DEFAULT_SKU);
    expect(result.sku).toBe("kling-v2-6-pro");
  });

  it("threads the provided sku through to AtlasProvider constructor", async () => {
    const result = await submitLabRender({
      imageUrl: "https://cdn.example.com/photo.jpg",
      scene: baseScene,
      roomType: "living_room",
      sku: "kling-v2-master",
    });
    expect(result.sku).toBe("kling-v2-master");
    // AtlasProvider should have been instantiated with the sku.
    expect(atlasConstructorCalls).toContain("kling-v2-master");
  });

  it("ignores an invalid sku override and falls back to default", async () => {
    // Cast through unknown to simulate a runtime invalid value slipping through.
    const result = await submitLabRender({
      imageUrl: "https://cdn.example.com/photo.jpg",
      scene: baseScene,
      roomType: "living_room",
      sku: "kling-v3-pro" as unknown as (typeof V1_ATLAS_SKUS)[number],
    });
    // kling-v3-pro is NOT in V1_ATLAS_SKUS, resolveDecision should fall back.
    expect(result.sku).toBe(V1_DEFAULT_SKU);
  });

  it("uses kling-v3-pro for paired scenes (endImageUrl set) — upgraded from kling-v2-1-pair 2026-06-10", async () => {
    const result = await submitLabRender({
      imageUrl: "https://cdn.example.com/photo.jpg",
      scene: baseScene,
      roomType: "living_room",
      endImageUrl: "https://cdn.example.com/end.jpg",
    });
    expect(result.sku).toBe("kling-v3-pro");
    expect(atlasConstructorCalls).toContain("kling-v3-pro");
  });
});

describe("AtlasProvider constructor — modelOverride arg (mock)", () => {
  beforeEach(() => {
    process.env.ATLASCLOUD_API_KEY = "test-key";
    delete process.env.ATLAS_VIDEO_MODEL;
    atlasConstructorCalls.length = 0;
  });

  it("accepts a modelOverride and stores it as _resolvedModel", async () => {
    // Import MockAtlasProvider via the mocked module.
    const { AtlasProvider: MockClass } = await import("./providers/atlas.js");
    const provider = new MockClass("kling-v3-std");
    expect((provider as unknown as { _resolvedModel: string })._resolvedModel).toBe("kling-v3-std");
  });

  it("defaults to kling-v2-6-pro when no override and no env var", async () => {
    const { AtlasProvider: MockClass } = await import("./providers/atlas.js");
    const provider = new MockClass();
    expect((provider as unknown as { _resolvedModel: string })._resolvedModel).toBe("kling-v2-6-pro");
  });
});
