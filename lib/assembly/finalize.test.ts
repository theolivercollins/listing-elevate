/**
 * Tests for lib/assembly/finalize.ts
 *
 * TDD — written before the implementation. Tests cover:
 *   1. Kill switch: LE_ASSEMBLY_FINALIZE=off bypasses all work and returns
 *      the provider URL unchanged.
 *   2. Env guard: storage write is skipped when VERCEL_ENV and
 *      LE_ALLOW_NONPROD_WRITES are both absent — returns provider URL.
 *   3. Download failure: falls back to provider URL without throwing; emits
 *      a warn log.
 *   4. Storage upload failure: falls back to provider URL without throwing;
 *      emits a warn log.
 *   5. Happy path: returns the Supabase public URL, computed bitrateKbps, and
 *      outputBytes when everything succeeds.
 *   6. Bitrate warn fires when computed bitrate is below the pixel-scaled floor.
 *   7. Bitrate warn does NOT fire when computed bitrate is above the floor.
 *   8. ASSEMBLY_MIN_KBPS env var overrides the default floor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Import the unit under test AFTER any vi.mock() calls.
// ---------------------------------------------------------------------------
import { finalizeAssemblyRender } from "./finalize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Supabase storage mock that records calls. */
function makeStorageMock(opts: {
  uploadError?: { message: string } | null;
  publicUrl?: string;
}) {
  const uploadFn = vi.fn().mockResolvedValue({
    data: opts.uploadError ? null : { path: "some/path" },
    error: opts.uploadError ?? null,
  });
  const getPublicUrlFn = vi.fn().mockReturnValue({
    data: { publicUrl: opts.publicUrl ?? "https://storage.example.com/public.mp4" },
  });
  const storageMock = {
    from: vi.fn().mockReturnValue({
      upload: uploadFn,
      getPublicUrl: getPublicUrlFn,
    }),
  };
  return { storageMock, uploadFn, getPublicUrlFn };
}

function makeSupabase(storageMock: { from: ReturnType<typeof vi.fn> }) {
  return { storage: storageMock } as unknown as SupabaseClient;
}

const PROVIDER_URL = "https://creatomate.com/renders/abc123.mp4";
const SUPABASE_URL = "https://storage.example.com/public.mp4";

// 1 MB of fake video bytes — 30s video → 8000/30 ≈ 267 kbps (well below 9 Mbps floor)
const SMALL_BYTES = new Uint8Array(1_000_000);
// 40 MB of fake video bytes — 30s video → 320000/30 / 1000 * 8 ≈ ~10 667 kbps (above floor)
const LARGE_BYTES = new Uint8Array(40_000_000);

function makeFetchResponse(bytes: Uint8Array) {
  return {
    ok: true,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Base params for every call
// ---------------------------------------------------------------------------
const BASE_PARAMS = {
  propertyId: "prop-abc",
  aspectRatio: "16:9" as const,
  providerUrl: PROVIDER_URL,
  durationSeconds: 30,
  version: 1,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("finalizeAssemblyRender", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Restore env modifications between tests.
    delete process.env.LE_ASSEMBLY_FINALIZE;
    delete process.env.VERCEL_ENV;
    delete process.env.LE_ALLOW_NONPROD_WRITES;
    delete process.env.ASSEMBLY_MIN_KBPS;

    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 1. Kill switch ──────────────────────────────────────────────────────

  it("returns provider URL unchanged when LE_ASSEMBLY_FINALIZE=off", async () => {
    process.env.LE_ASSEMBLY_FINALIZE = "off";
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(result.url).toBe(PROVIDER_URL);
    expect(result.bitrateKbps).toBeNull();
    expect(storageMock.from).not.toHaveBeenCalled();
  });

  // ── 2. Env guard ────────────────────────────────────────────────────────

  it("skips storage write and returns provider URL when env guard is absent", async () => {
    // Neither VERCEL_ENV=production nor LE_ALLOW_NONPROD_WRITES=true
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    // Storage must not be touched.
    expect(storageMock.from).not.toHaveBeenCalled();
    // URL falls back to provider.
    expect(result.url).toBe(PROVIDER_URL);
    // Bitrate IS computed from downloaded bytes (we still download).
    expect(result.bitrateKbps).not.toBeNull();
  });

  // ── 3. Download failure ─────────────────────────────────────────────────

  it("falls back to provider URL on download failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network timeout")),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(result.url).toBe(PROVIDER_URL);
    expect(result.bitrateKbps).toBeNull();
    expect(storageMock.from).not.toHaveBeenCalled();
    // Must emit a warn — never throw.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  it("falls back to provider URL when fetch returns non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(result.url).toBe(PROVIDER_URL);
    expect(storageMock.from).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  // ── 4. Storage upload failure ────────────────────────────────────────────

  it("falls back to provider URL on storage upload failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock } = makeStorageMock({
      uploadError: { message: "bucket full" },
      publicUrl: SUPABASE_URL,
    });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(result.url).toBe(PROVIDER_URL);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize]"),
      expect.anything(),
    );
  });

  // ── 5. Happy path ────────────────────────────────────────────────────────

  it("returns Supabase public URL and correct metadata on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(result.url).toBe(SUPABASE_URL);
    expect(result.outputBytes).toBe(LARGE_BYTES.byteLength);
    // bitrateKbps = bytes * 8 / durationSeconds / 1000
    const expectedKbps = Math.round(
      (LARGE_BYTES.byteLength * 8) / BASE_PARAMS.durationSeconds / 1000,
    );
    expect(result.bitrateKbps).toBe(expectedKbps);
    // No warn because large bytes → high bitrate.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stores at correct path: property-videos/{propertyId}/final_horizontal_v{n}.mp4", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock, uploadFn } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(storageMock.from).toHaveBeenCalledWith("property-videos");
    expect(uploadFn).toHaveBeenCalledWith(
      "prop-abc/final_horizontal_v1.mp4",
      expect.any(Uint8Array),
      { contentType: "video/mp4", upsert: true },
    );
  });

  it("uses final_vertical path for 9:16 aspect ratio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock, uploadFn } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({
      ...BASE_PARAMS,
      aspectRatio: "9:16",
      supabase,
    });

    expect(uploadFn).toHaveBeenCalledWith(
      "prop-abc/final_vertical_v1.mp4",
      expect.any(Uint8Array),
      { contentType: "video/mp4", upsert: true },
    );
  });

  // ── 6. Bitrate warn below floor ──────────────────────────────────────────

  it("emits warn when bitrate is below the pixel-scaled floor", async () => {
    // 1 MB over 30 s → ~267 kbps — far below 9000 kbps floor
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(SMALL_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    // Should still succeed (URL is Supabase — upload happened).
    expect(result.url).toBe(SUPABASE_URL);
    // Must warn about low bitrate.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] low bitrate"),
      expect.anything(),
    );
  });

  // ── 7. No bitrate warn above floor ──────────────────────────────────────

  it("does NOT emit a bitrate warn when bitrate is above the floor", async () => {
    // 40 MB over 30 s → ~10 667 kbps — above 9000 kbps floor
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    const bitrateWarns = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("low bitrate"),
    );
    expect(bitrateWarns).toHaveLength(0);
  });

  // ── 8. ASSEMBLY_MIN_KBPS env override ───────────────────────────────────

  it("uses ASSEMBLY_MIN_KBPS env var as the bitrate floor", async () => {
    // 40 MB / 30 s → ~10 667 kbps; set floor to 20 000 kbps so it triggers
    process.env.ASSEMBLY_MIN_KBPS = "20000";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[assembly-finalize] low bitrate"),
      expect.anything(),
    );
  });

  it("allows ASSEMBLY_MIN_KBPS=0 to disable bitrate warn entirely", async () => {
    process.env.ASSEMBLY_MIN_KBPS = "0";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(SMALL_BYTES)),
    );
    const { storageMock } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);
    process.env.VERCEL_ENV = "production";

    await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    const bitrateWarns = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === "string" && msg.includes("low bitrate"),
    );
    expect(bitrateWarns).toHaveLength(0);
  });

  // ── LE_ALLOW_NONPROD_WRITES guard ────────────────────────────────────────

  it("allows storage write when LE_ALLOW_NONPROD_WRITES=true even without VERCEL_ENV", async () => {
    process.env.LE_ALLOW_NONPROD_WRITES = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeFetchResponse(LARGE_BYTES)),
    );
    const { storageMock, uploadFn } = makeStorageMock({ publicUrl: SUPABASE_URL });
    const supabase = makeSupabase(storageMock);

    const result = await finalizeAssemblyRender({ ...BASE_PARAMS, supabase });

    expect(storageMock.from).toHaveBeenCalledWith("property-videos");
    expect(uploadFn).toHaveBeenCalled();
    expect(result.url).toBe(SUPABASE_URL);
  });
});
