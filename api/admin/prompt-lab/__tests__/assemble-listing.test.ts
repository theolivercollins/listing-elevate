/**
 * assemble-listing.test.ts
 *
 * Unit tests for POST /api/admin/prompt-lab/assemble-listing.
 *
 * All external deps are mocked:
 *   - lib/auth  (requireAdmin)
 *   - lib/client (getSupabase)
 *   - lib/utils/ffmpeg (applySpeedRamp, concatClips)
 *   - node fetch (global fetch) for clip downloads
 *   - fs/promises (writeFile / readFile / unlink — lightweight stubs)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as os from "os";

// ── Auth mock ────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── ffmpeg mock ───────────────────────────────────────────────────────────────
const mockApplySpeedRamp = vi.fn();
const mockConcatClips = vi.fn();
vi.mock("../../../../lib/utils/ffmpeg", () => ({
  applySpeedRamp: (...args: unknown[]) => mockApplySpeedRamp(...args),
  concatClips: (...args: unknown[]) => mockConcatClips(...args),
}));

// ── fs/promises mock ──────────────────────────────────────────────────────────
vi.mock("fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("fs/promises")>();
  return {
    ...real,
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("fake-mp4-data")),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let supabaseMockConfig: {
  listingRow: unknown | null;
  scenes: Array<{ id: string; scene_number: number; room_type: string }>;
  iterations: Array<{ id: string; clip_url: string | null; scene_id: string }>;
  assemblyInsertResult: { id: string } | null;
  insertErr: { message: string } | null;
  uploadErr: { message: string } | null;
};

function resetSupabaseMockConfig() {
  supabaseMockConfig = {
    listingRow: { id: "listing-1", model_name: "kling-v2-6-pro" },
    scenes: [
      { id: "scene-1", scene_number: 1, room_type: "kitchen" },
      { id: "scene-2", scene_number: 2, room_type: "living_room" },
    ],
    iterations: [
      { id: "iter-1", clip_url: "https://storage.example.com/clip1.mp4", scene_id: "scene-1" },
      { id: "iter-2", clip_url: "https://storage.example.com/clip2.mp4", scene_id: "scene-1" },
      { id: "iter-3", clip_url: "https://storage.example.com/clip3.mp4", scene_id: "scene-2" },
    ],
    assemblyInsertResult: { id: "asm-uuid-1" },
    insertErr: null,
    uploadErr: null,
  };
}

// Track captured updates and inserts
let assemblyUpdates: Array<Record<string, unknown>> = [];
let assemblyInsertPayloads: Array<Record<string, unknown>> = [];

function buildSupabaseMock() {
  assemblyUpdates = [];
  assemblyInsertPayloads = [];

  return {
    from(table: string) {
      if (table === "prompt_lab_listings") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  supabaseMockConfig.listingRow
                    ? { data: supabaseMockConfig.listingRow, error: null }
                    : { data: null, error: { message: "not found" } },
                ),
            }),
          }),
        };
      }

      if (table === "prompt_lab_listing_scenes") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: supabaseMockConfig.scenes,
                error: null,
              }),
          }),
        };
      }

      if (table === "prompt_lab_listing_scene_iterations") {
        return {
          select: () => ({
            in: () => ({
              in: () =>
                Promise.resolve({
                  data: supabaseMockConfig.iterations,
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === "prompt_lab_listing_assemblies") {
        return {
          insert: (payload: Record<string, unknown>) => {
            assemblyInsertPayloads.push(payload);
            return {
              select: () => ({
                single: () =>
                  supabaseMockConfig.insertErr
                    ? Promise.resolve({ data: null, error: supabaseMockConfig.insertErr })
                    : Promise.resolve({
                        data: supabaseMockConfig.assemblyInsertResult,
                        error: null,
                      }),
              }),
            };
          },
          update: (payload: Record<string, unknown>) => {
            assemblyUpdates.push({ ...payload });
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
          },
        };
      }

      // Fallback
      return {
        select: () => ({
          eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
    },
    storage: {
      from: () => ({
        upload: (_path: string, _buf: Buffer, _opts: unknown) =>
          Promise.resolve({ error: supabaseMockConfig.uploadErr ?? null }),
        getPublicUrl: (storagePath: string) => ({
          data: { publicUrl: `https://storage.example.com/${storagePath}` },
        }),
      }),
    },
  };
}

const mockGetSupabase = vi.fn();
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => mockGetSupabase(),
}));

// ── Global fetch mock ─────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────
const adminUser = { user: { id: "u1", email: "admin@test.com" }, profile: { role: "admin" } };

function makeRes() {
  const r = { _status: 0, _body: {} as unknown };
  return Object.assign(r, {
    status(code: number) {
      r._status = code;
      return this;
    },
    json(body: unknown) {
      r._body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  });
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: "POST",
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

function makeFakeClipResponse() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let importedHandler: (req: VercelRequest, res: VercelResponse) => Promise<VercelResponse | void>;

beforeEach(async () => {
  vi.resetModules();

  vi.mock("../../../../lib/auth", () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock("../../../../lib/utils/ffmpeg", () => ({
    applySpeedRamp: (...args: unknown[]) => mockApplySpeedRamp(...args),
    concatClips: (...args: unknown[]) => mockConcatClips(...args),
  }));
  vi.mock("../../../../lib/client", () => ({
    getSupabase: () => mockGetSupabase(),
  }));
  vi.mock("fs/promises", async (importOriginal) => {
    const real = await importOriginal<typeof import("fs/promises")>();
    return {
      ...real,
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from("fake-mp4-data")),
      unlink: vi.fn().mockResolvedValue(undefined),
    };
  });

  mockRequireAdmin.mockReset();
  mockApplySpeedRamp.mockReset();
  mockConcatClips.mockReset();
  mockFetch.mockReset();
  mockGetSupabase.mockReset();

  resetSupabaseMockConfig();
  mockGetSupabase.mockReturnValue(buildSupabaseMock());

  // Default: admin auth passes
  mockRequireAdmin.mockResolvedValue(adminUser);
  // Default: speed-ramp succeeds (no-op)
  mockApplySpeedRamp.mockResolvedValue(undefined);
  // Default: concat succeeds with 15s duration
  mockConcatClips.mockResolvedValue({ durationSeconds: 15 });
  // Default: fetch succeeds for every clip URL
  mockFetch.mockResolvedValue(makeFakeClipResponse());

  const mod = await import("../assemble-listing.js");
  importedHandler = mod.default;
});

describe("POST /api/admin/prompt-lab/assemble-listing", () => {
  describe("happy path", () => {
    it("returns 200 with assembled_url and duration_seconds", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body.id).toBe("asm-uuid-1");
      expect(typeof body.assembled_url).toBe("string");
      expect((body.assembled_url as string).length).toBeGreaterThan(0);
      expect(typeof body.duration_seconds).toBe("number");
    });

    it("inserts assembly row with correct iteration_order, listing_id, and status='assembling'", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(assemblyInsertPayloads).toHaveLength(1);
      const inserted = assemblyInsertPayloads[0];
      expect(inserted.status).toBe("assembling");
      expect(inserted.iteration_order).toEqual(["iter-1", "iter-2", "iter-3"]);
      expect(inserted.listing_id).toBe("listing-1");
      expect(inserted.pipeline_version).toBe("v1.1");
    });

    it("updates assembly row to status='complete' with duration and url", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      const completeUpdate = assemblyUpdates.find((u) => u.status === "complete");
      expect(completeUpdate).toBeDefined();
      expect(completeUpdate?.duration_seconds).toBe(15);
      expect(typeof completeUpdate?.assembled_url).toBe("string");
      expect(completeUpdate?.completed_at).toBeDefined();
    });

    it("calls applySpeedRamp for each iteration", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockApplySpeedRamp).toHaveBeenCalledTimes(3);
    });

    it("calls concatClips once with 3 ramped segment paths", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockConcatClips).toHaveBeenCalledTimes(1);
      const [paths, outPath] = mockConcatClips.mock.calls[0] as [string[], string];
      expect(paths).toHaveLength(3);
      for (const p of paths) {
        expect(p.startsWith(os.tmpdir())).toBe(true);
      }
      expect(outPath.startsWith(os.tmpdir())).toBe(true);
    });

    it("allows duplicate iteration_ids (same clip can appear twice)", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      expect(mockApplySpeedRamp).toHaveBeenCalledTimes(3);
    });

    it("storage path uses lab-listing/<listing_id>/assembled/<assemblyId>", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body.assembled_url as string).toMatch(/lab-listing\/listing-1\/assembled\//);
    });
  });

  describe("validation — 400 errors", () => {
    it("returns 400 when listing_id is missing", async () => {
      const req = makeReq({ body: { iteration_ids: ["iter-1"] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      expect((res._body as Record<string, unknown>).error).toMatch(/listing_id required/i);
    });

    it("returns 400 when iteration_ids is empty", async () => {
      const req = makeReq({ body: { listing_id: "listing-1", iteration_ids: [] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
    });

    it("returns 400 when listing is not found", async () => {
      supabaseMockConfig.listingRow = null;
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({ body: { listing_id: "nonexistent", iteration_ids: ["iter-1"] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      expect((res._body as Record<string, unknown>).error).toMatch(/listing not found/i);
    });

    it("returns 400 when iteration does not belong to this listing", async () => {
      // Return empty iterations — as if the iteration is from a different listing
      supabaseMockConfig.iterations = [];
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-foreign"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/does not belong to listing/i);
    });

    it("returns 400 when an iteration has no clip_url", async () => {
      supabaseMockConfig.iterations = [
        { id: "iter-1", clip_url: null, scene_id: "scene-1" },
        { id: "iter-2", clip_url: "https://storage.example.com/clip2.mp4", scene_id: "scene-1" },
      ];
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/no clip_url/i);
    });
  });

  describe("failure path", () => {
    it("returns 500 and updates assembly to status='failed' when concatClips throws", async () => {
      mockConcatClips.mockRejectedValue(new Error("ffmpeg concat exploded"));

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(500);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/ffmpeg concat exploded/i);
      expect(body.assembly_id).toBe("asm-uuid-1");

      const failedUpdate = assemblyUpdates.find((u) => u.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect(String(failedUpdate?.error)).toMatch(/ffmpeg concat exploded/i);
    });

    it("falls back to raw clip when applySpeedRamp throws, still returns 200", async () => {
      mockApplySpeedRamp.mockRejectedValue(new Error("clip too short for speed ramp"));

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      // Should still succeed — raw clip is used as fallback
      expect(res._status).toBe(200);
      expect(mockConcatClips).toHaveBeenCalledTimes(1);
      const [paths] = mockConcatClips.mock.calls[0] as [string[]];
      expect(paths).toHaveLength(1);
      // Segment path should be the *raw* path (ends in -raw.mp4, not -ramp.mp4)
      expect(paths[0]).toMatch(/-raw\.mp4$/);
    });

    it("returns 500 and assembly_id when storage upload fails", async () => {
      supabaseMockConfig.uploadErr = { message: "storage quota exceeded" };
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(500);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/storage upload failed/i);
      expect(body.assembly_id).toBe("asm-uuid-1");
    });
  });

  describe("auth", () => {
    it("returns whatever requireAdmin returns when auth fails (non-admin gets 403)", async () => {
      mockRequireAdmin.mockImplementation((_req: unknown, res: unknown) => {
        (res as ReturnType<typeof makeRes>).status(403).json({ error: "Forbidden" });
        return null;
      });

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(403);
      // No assembly should have been inserted
      expect(assemblyInsertPayloads).toHaveLength(0);
    });
  });
});
