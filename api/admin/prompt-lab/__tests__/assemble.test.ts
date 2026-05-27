/**
 * assemble.test.ts
 *
 * Unit tests for POST /api/admin/prompt-lab/assemble.
 *
 * All external deps are mocked:
 *   - lib/auth  (requireAdmin)
 *   - lib/client (getSupabase)
 *   - lib/utils/ffmpeg (applySpeedRamp, concatClips)
 *   - node fetch (global fetch) for clip downloads
 *   - fs/promises (writeFile / readFile / unlink — lightweight stubs)
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as path from "path";
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
// We need to mock writeFile and readFile (for the final mp4 read) and unlink.
// Keep the real implementations for everything else (os, path are not affected).
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
// We build a configurable supabase mock that tracks calls to .insert(), .update().
let supabaseMockConfig: {
  sessionRow: unknown | null;
  iterations: Array<{ id: string; clip_url: string | null; session_id: string }>;
  assemblyInsertResult: { id: string } | null;
  insertErr: { message: string } | null;
  uploadErr: { message: string } | null;
};

function resetSupabaseMockConfig() {
  supabaseMockConfig = {
    sessionRow: { id: "sess-1" },
    iterations: [
      { id: "iter-1", clip_url: "https://storage.example.com/clip1.mp4", session_id: "sess-1" },
      { id: "iter-2", clip_url: "https://storage.example.com/clip2.mp4", session_id: "sess-1" },
      { id: "iter-3", clip_url: "https://storage.example.com/clip3.mp4", session_id: "sess-1" },
    ],
    assemblyInsertResult: { id: "asm-uuid-1" },
    insertErr: null,
    uploadErr: null,
  };
}

// Track captured updates to the assembly row across tests
let assemblyUpdates: Array<Record<string, unknown>> = [];
let assemblyInsertPayloads: Array<Record<string, unknown>> = [];

function buildSupabaseMock() {
  assemblyUpdates = [];
  assemblyInsertPayloads = [];

  return {
    from(table: string) {
      if (table === "prompt_lab_sessions") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  supabaseMockConfig.sessionRow
                    ? { data: supabaseMockConfig.sessionRow, error: null }
                    : { data: null, error: { message: "not found" } },
                ),
            }),
          }),
        };
      }

      if (table === "prompt_lab_iterations") {
        return {
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: supabaseMockConfig.iterations,
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === "prompt_lab_assemblies") {
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
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) };
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

// Build a successful fake fetch response for a clip download
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

  // Re-register mocks so fresh import picks them up
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

  const mod = await import("../assemble.js");
  importedHandler = mod.default;
});

describe("POST /api/admin/prompt-lab/assemble", () => {
  describe("happy path", () => {
    it("returns 200 with assembled_url and duration_seconds", async () => {
      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
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

    it("inserts assembly row with correct iteration_order and status='assembling'", async () => {
      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(assemblyInsertPayloads).toHaveLength(1);
      const inserted = assemblyInsertPayloads[0];
      expect(inserted.status).toBe("assembling");
      expect(inserted.iteration_order).toEqual(["iter-1", "iter-2", "iter-3"]);
      expect(inserted.session_id).toBe("sess-1");
      expect(inserted.pipeline_version).toBe("v1.1");
    });

    it("updates assembly row to status='complete' with duration and url", async () => {
      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
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
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockApplySpeedRamp).toHaveBeenCalledTimes(3);
    });

    it("calls concatClips once with 3 ramped segment paths", async () => {
      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockConcatClips).toHaveBeenCalledTimes(1);
      const [paths, outPath] = mockConcatClips.mock.calls[0] as [string[], string];
      expect(paths).toHaveLength(3);
      // All paths should be in tmp dir
      for (const p of paths) {
        expect(p.startsWith(os.tmpdir())).toBe(true);
      }
      expect(outPath.startsWith(os.tmpdir())).toBe(true);
    });

    it("allows duplicate iteration_ids (same clip can appear twice)", async () => {
      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      expect(mockApplySpeedRamp).toHaveBeenCalledTimes(3);
    });
  });

  describe("validation — 400 errors", () => {
    it("returns 400 when session_id is missing", async () => {
      const req = makeReq({ body: { iteration_ids: ["iter-1"] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      // After migration 072 (batch-level assemblies), the error message is
      // "session_id or batch_label required" since either is acceptable.
      expect((res._body as Record<string, unknown>).error).toMatch(/session_id or batch_label required/i);
    });

    it("returns 400 when iteration_ids is empty", async () => {
      const req = makeReq({ body: { session_id: "sess-1", iteration_ids: [] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
    });

    it("returns 400 when iteration belongs to a different session", async () => {
      // Simulate iter-1 belonging to a different session
      supabaseMockConfig.iterations = [
        // iter-1 is returned but with wrong session_id (shouldn't happen via the .eq filter
        // but test that the "not found in iterMap" path fires).
        // We simulate by returning no rows for the session — as if query returned empty
        // (the iter doesn't belong to the session being queried).
      ];
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(400);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/does not belong to session/i);
    });

    it("returns 400 when an iteration has no clip_url", async () => {
      supabaseMockConfig.iterations = [
        { id: "iter-1", clip_url: null, session_id: "sess-1" },
        { id: "iter-2", clip_url: "https://storage.example.com/clip2.mp4", session_id: "sess-1" },
      ];
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2"] },
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
        body: { session_id: "sess-1", iteration_ids: ["iter-1", "iter-2"] },
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
        body: { session_id: "sess-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      // Should still succeed — raw clip is used as fallback
      expect(res._status).toBe(200);
      // concatClips should still have been called with 1 segment (the raw path)
      expect(mockConcatClips).toHaveBeenCalledTimes(1);
      const [paths] = mockConcatClips.mock.calls[0] as [string[]];
      expect(paths).toHaveLength(1);
      // The segment path should be the *raw* path (ends in -raw.mp4, not -ramp.mp4)
      expect(paths[0]).toMatch(/-raw\.mp4$/);
    });

    it("returns 500 and assembly_id when storage upload fails", async () => {
      supabaseMockConfig.uploadErr = { message: "storage quota exceeded" };
      mockGetSupabase.mockReturnValue(buildSupabaseMock());

      const req = makeReq({
        body: { session_id: "sess-1", iteration_ids: ["iter-1"] },
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
      // When requireAdmin returns null (already sent a 403), the handler returns without
      // calling res.status/json itself. Simulate this by checking handler exits early.
      mockRequireAdmin.mockImplementation((_req: unknown, res: unknown) => {
        (res as ReturnType<typeof makeRes>).status(403).json({ error: "Forbidden" });
        return null;
      });

      const req = makeReq({ body: { session_id: "sess-1", iteration_ids: ["iter-1"] } });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(403);
      // No assembly should have been inserted
      expect(assemblyInsertPayloads).toHaveLength(0);
    });
  });
});
