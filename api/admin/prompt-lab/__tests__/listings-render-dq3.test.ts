/**
 * listings-render-dq3.test.ts
 *
 * DQ.3 paired auto-route in api/admin/prompt-lab/listings/[id]/render.ts,
 * after the 2026-06-10 seedance-pair relaxation:
 *
 *   A. paired + model_override 'seedance-pair'  → HONOURED (opt-in pair mode)
 *   B. paired + model_override anything else    → coerced to kling-v3-pro (unchanged)
 *   C. paired + no override                     → kling-v3-pro (default unchanged)
 *   D. paired + body.models[] (compare flow)    → selections respected verbatim (unchanged)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Auth mock ─────────────────────────────────────────────────────────────────
const mockRequireAdmin = vi.fn();
vi.mock("../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));

// ── Provider mocks — capture generateClip params per submission ──────────────
const generateClipCalls: Array<Record<string, unknown>> = [];
const fakeProvider = {
  name: "atlas",
  generateClip: vi.fn(async (params: Record<string, unknown>) => {
    generateClipCalls.push(params);
    return { jobId: `task-${generateClipCalls.length}`, estimatedSeconds: 90 };
  }),
};
vi.mock("../../../../lib/providers/dispatch", () => ({
  pickProvider: vi.fn(() => fakeProvider),
  isNativeKling: vi.fn((k: string) => k === "kling-v2-native"),
}));
vi.mock("../../../../lib/providers/atlas", () => ({
  AtlasProvider: vi.fn(() => fakeProvider),
}));
vi.mock("../../../../lib/sanitize-prompt", () => ({
  sanitizeDirectorPrompt: (p: string) => p,
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Mutable fixtures the chainable mock serves per table.
let sceneRow: Record<string, unknown>;
const iterationInserts: Array<Record<string, unknown>> = [];

vi.mock("../../../../lib/client", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self; chain.eq = self; chain.order = self;
      chain.limit = self; chain.update = self;
      if (table === "prompt_lab_listings") {
        chain.maybeSingle = () => Promise.resolve({ data: { model_name: "kling-v2-6-pro" }, error: null });
        // final status update: .update().eq() → thenable
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return chain;
      }
      if (table === "prompt_lab_listing_scenes") {
        chain.maybeSingle = () => Promise.resolve({ data: sceneRow, error: null });
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return chain;
      }
      if (table === "prompt_lab_listing_photos") {
        chain.maybeSingle = () => Promise.resolve({ data: { image_url: "https://cdn.example.com/photo.jpg" }, error: null });
        return chain;
      }
      if (table === "prompt_lab_listing_scene_iterations") {
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null }); // no prior iterations
        chain.insert = (row: Record<string, unknown>) => {
          iterationInserts.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: `iter-${iterationInserts.length}`, ...row }, error: null }),
            }),
          };
        };
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
        return chain;
      }
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
      return chain;
    },
  }),
}));

import handler from "../listings/[id]/render";

const adminUser = { user: { id: "u1", email: "admin@test.com" }, profile: { role: "admin" } };

function makeRes() {
  const r = { _status: 0, _body: {} as unknown };
  return Object.assign(r, {
    status(code: number) { r._status = code; return this; },
    json(body: unknown) { r._body = body; return this; },
    setHeader() { return this; },
  });
}

const PAIRED_SCENE = {
  id: "scene-1",
  photo_id: "photo-1",
  end_image_url: "https://cdn.example.com/end.jpg",
  director_prompt: "camera glides from the doorway toward the window",
  refinement_notes: null,
  use_end_frame: true,
};

async function postRender(body: Record<string, unknown>) {
  const res = makeRes();
  await handler(
    { method: "POST", query: { id: "listing-1" }, headers: {}, body: { scene_ids: ["scene-1"], ...body } } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  generateClipCalls.length = 0;
  iterationInserts.length = 0;
  sceneRow = { ...PAIRED_SCENE };
  mockRequireAdmin.mockResolvedValue(adminUser);
});

describe("listings render — DQ.3 paired auto-route with seedance-pair opt-in", () => {
  it("A. paired + model_override='seedance-pair' is HONOURED (opt-in pair mode)", async () => {
    const res = await postRender({ model_override: "seedance-pair" });
    expect(res._status).toBe(200);
    expect(generateClipCalls).toHaveLength(1);
    expect(generateClipCalls[0].modelOverride).toBe("seedance-pair");
    // End frame travels with the request and the scene's own prompt is used.
    expect(generateClipCalls[0].endImageUrl).toBe("https://cdn.example.com/end.jpg");
    expect(generateClipCalls[0].prompt).toBe(PAIRED_SCENE.director_prompt);
    expect(iterationInserts[0].model_used).toBe("seedance-pair");
  });

  it("B. paired + any other model_override still coerces to kling-v3-pro", async () => {
    const res = await postRender({ model_override: "kling-v2-6-pro" });
    expect(res._status).toBe(200);
    expect(generateClipCalls[0].modelOverride).toBe("kling-v3-pro");
    expect(iterationInserts[0].model_used).toBe("kling-v3-pro");
  });

  it("C. paired + no override defaults to kling-v3-pro (DQ.3 default unchanged)", async () => {
    const res = await postRender({});
    expect(res._status).toBe(200);
    expect(generateClipCalls[0].modelOverride).toBe("kling-v3-pro");
    expect(iterationInserts[0].model_used).toBe("kling-v3-pro");
  });

  it("D. paired + body.models[] (Compare-models flow) respects selections verbatim", async () => {
    const res = await postRender({ models: ["seedance-pair", "kling-v2-6-pro"] });
    expect(res._status).toBe(200);
    expect(generateClipCalls.map((c) => c.modelOverride)).toEqual(["seedance-pair", "kling-v2-6-pro"]);
  });
});
