/**
 * assemble-listing.test.ts
 *
 * Unit tests for POST /api/admin/prompt-lab/assemble-listing.
 *
 * The assembly path renders via Creatomate (cloud concat) — no local FFmpeg,
 * no Supabase upload. External deps are mocked:
 *   - lib/auth                  (requireAdmin)
 *   - lib/client                (getSupabase)
 *   - lib/db                    (recordCostEvent)
 *   - lib/providers/creatomate   (CreatomateProvider, pollAssemblyUntilComplete,
 *                                creatomateCostCents)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Cost mock ────────────────────────────────────────────────────────────────
const mockRecordCostEvent = vi.fn();
vi.mock("../../../../lib/db", () => ({
  recordCostEvent: (...args: unknown[]) => mockRecordCostEvent(...args),
}));

// ── Creatomate + poll mock ─────────────────────────────────────────────────────
const mockAssembleConcat = vi.fn();
const mockPoll = vi.fn();
const mockCostCents = vi.fn();
vi.mock("../../../../lib/providers/creatomate", () => ({
  CreatomateProvider: class {
    assembleConcat = (...args: unknown[]) => mockAssembleConcat(...args);
  },
  creatomateCostCents: (...args: unknown[]) => mockCostCents(...args),
}));
vi.mock("../../../../lib/providers/assembly-router", () => ({
  pollAssemblyJob: (...args: unknown[]) => mockPoll(...args),
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────
let supabaseMockConfig: {
  listingRow: unknown | null;
  scenes: Array<{ id: string; scene_number: number; room_type: string }>;
  iterations: Array<{ id: string; clip_url: string | null; scene_id: string }>;
  assemblyInsertResult: { id: string } | null;
  insertErr: { message: string } | null;
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
  };
}

const mockGetSupabase = vi.fn();
vi.mock("../../../../lib/client", () => ({
  getSupabase: () => mockGetSupabase(),
}));

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

// ── Tests ─────────────────────────────────────────────────────────────────────

let importedHandler: (req: VercelRequest, res: VercelResponse) => Promise<VercelResponse | void>;

beforeEach(async () => {
  vi.resetModules();

  vi.mock("../../../../lib/auth", () => ({
    requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  }));
  vi.mock("../../../../lib/db", () => ({
    recordCostEvent: (...args: unknown[]) => mockRecordCostEvent(...args),
  }));
  vi.mock("../../../../lib/providers/creatomate", () => ({
    CreatomateProvider: class {
      assembleConcat = (...args: unknown[]) => mockAssembleConcat(...args);
    },
    creatomateCostCents: (...args: unknown[]) => mockCostCents(...args),
  }));
  vi.mock("../../../../lib/providers/assembly-router", () => ({
    pollAssemblyJob: (...args: unknown[]) => mockPoll(...args),
  }));
  vi.mock("../../../../lib/client", () => ({
    getSupabase: () => mockGetSupabase(),
  }));

  mockRequireAdmin.mockReset();
  mockRecordCostEvent.mockReset();
  mockAssembleConcat.mockReset();
  mockPoll.mockReset();
  mockCostCents.mockReset();
  mockGetSupabase.mockReset();

  resetSupabaseMockConfig();
  mockGetSupabase.mockReturnValue(buildSupabaseMock());

  mockRequireAdmin.mockResolvedValue(adminUser);
  mockRecordCostEvent.mockResolvedValue(undefined);
  mockAssembleConcat.mockResolvedValue({ jobId: "ss-job-1", environment: "v1" });
  mockPoll.mockResolvedValue({
    status: "complete",
    videoUrl: "https://cdn.creatomate.io/render/out.mp4",
    durationSeconds: 15,
  });
  mockCostCents.mockReturnValue(20);

  const mod = await import("../assemble-listing.js");
  importedHandler = mod.default;
});

describe("POST /api/admin/prompt-lab/assemble-listing", () => {
  describe("happy path", () => {
    it("returns 200 with the Creatomate-hosted url and duration_seconds", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      const body = res._body as Record<string, unknown>;
      expect(body.id).toBe("asm-uuid-1");
      expect(body.assembled_url).toBe("https://cdn.creatomate.io/render/out.mp4");
      expect(body.duration_seconds).toBe(15);
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
      expect(completeUpdate?.assembled_url).toBe("https://cdn.creatomate.io/render/out.mp4");
      expect(completeUpdate?.completed_at).toBeDefined();
    });

    it("submits the ordered clip URLs to Creatomate (default 16:9)", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockAssembleConcat).toHaveBeenCalledTimes(1);
      const [clipUrls, aspectRatio] = mockAssembleConcat.mock.calls[0] as [string[], string];
      expect(clipUrls).toEqual([
        "https://storage.example.com/clip1.mp4",
        "https://storage.example.com/clip2.mp4",
        "https://storage.example.com/clip3.mp4",
      ]);
      expect(aspectRatio).toBe("16:9");
    });

    it("passes aspect_ratio '9:16' through to Creatomate", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"], aspect_ratio: "9:16" },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      const [, aspectRatio] = mockAssembleConcat.mock.calls[0] as [string[], string];
      expect(aspectRatio).toBe("9:16");
    });

    it("records a Creatomate assembly cost event", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2", "iter-3"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(mockRecordCostEvent).toHaveBeenCalledTimes(1);
      const event = mockRecordCostEvent.mock.calls[0][0] as Record<string, unknown>;
      expect(event.provider).toBe("creatomate");
      expect(event.stage).toBe("assembly");
      expect(event.costCents).toBe(20);
    });

    it("allows duplicate iteration_ids (same clip can appear twice)", async () => {
      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(200);
      const [clipUrls] = mockAssembleConcat.mock.calls[0] as [string[]];
      expect(clipUrls).toHaveLength(3);
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
    it("returns 500 and marks failed when the Creatomate render does not complete", async () => {
      mockPoll.mockResolvedValue({ status: "failed", error: "Creatomate render timed out" });

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1", "iter-2"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(500);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/timed out/i);
      expect(body.assembly_id).toBe("asm-uuid-1");

      const failedUpdate = assemblyUpdates.find((u) => u.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect(String(failedUpdate?.error)).toMatch(/timed out/i);
    });

    it("returns 500 and marks failed when the Creatomate submit throws", async () => {
      mockAssembleConcat.mockRejectedValue(new Error("Creatomate render submit failed: 401"));

      const req = makeReq({
        body: { listing_id: "listing-1", iteration_ids: ["iter-1"] },
      });
      const res = makeRes();
      await importedHandler(req, res as unknown as VercelResponse);

      expect(res._status).toBe(500);
      const body = res._body as Record<string, unknown>;
      expect(String(body.error)).toMatch(/submit failed/i);
      expect(body.assembly_id).toBe("asm-uuid-1");

      const failedUpdate = assemblyUpdates.find((u) => u.status === "failed");
      expect(failedUpdate).toBeDefined();
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
      expect(assemblyInsertPayloads).toHaveLength(0);
    });
  });
});
