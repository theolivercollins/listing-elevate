// api/admin/music/__tests__/[id].test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Mocks must be hoisted before any imports that trigger module evaluation ──

vi.mock("../../../../lib/client.js", () => ({
  getSupabase: vi.fn(),
}));

vi.mock("../../../../lib/auth.js", () => ({
  requireAdmin: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import handler from "../[id].js";
import { getSupabase } from "../../../../lib/client.js";
import { requireAdmin } from "../../../../lib/auth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRACK_ID = "track-uuid-42";

const FAKE_TRACK = {
  id: TRACK_ID,
  name: "Warm Welcome",
  file_url: "https://storage.example.com/music/track-uuid-42.mp3",
  mood_tag: "warm",
  duration_seconds: null,
  license: "Royalty-free",
  attribution: "Artist Name",
  active: true,
  created_at: "2026-05-14T00:00:00Z",
};

function makeAdminAuth() {
  return {
    user: { id: "admin-uid", email: "admin@test.com" },
    profile: {
      id: "profile-1",
      user_id: "admin-uid",
      role: "admin" as const,
      first_name: "Admin",
      last_name: "User",
      phone: null,
      email: "admin@test.com",
      brokerage: null,
      logo_url: null,
      colors: { primary: "#000", secondary: "#fff" },
      presets: [],
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  };
}

function makeReq(
  method: string,
  body: Record<string, unknown> = {},
  id = TRACK_ID
): VercelRequest {
  return {
    method,
    headers: { "content-type": "application/json" },
    query: { id },
    body,
  } as unknown as VercelRequest;
}

function makeRes() {
  const res: any = {
    _status: 200,
    _body: null,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: any) {
      this._body = body;
      return this;
    },
    setHeader(_k: string, _v: string) {
      return this;
    },
    end() {
      return this;
    },
  };
  return res as VercelResponse & { _status: number; _body: any };
}

function setupSupabasePatchMock(updatedTrack = FAKE_TRACK) {
  const singleMock = vi.fn().mockResolvedValue({ data: updatedTrack, error: null });
  const selectMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqMock = vi.fn().mockReturnValue({ select: selectMock });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

  const supabaseMock = {
    from: vi.fn().mockReturnValue({ update: updateMock }),
  };

  (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(supabaseMock);
  return { supabaseMock, updateMock, eqMock };
}

function setupSupabaseDeleteMock() {
  const eqMock = vi.fn().mockResolvedValue({ error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: eqMock });

  const supabaseMock = {
    from: vi.fn().mockReturnValue({ update: updateMock }),
  };

  (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(supabaseMock);
  return { supabaseMock, updateMock, eqMock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PATCH /api/admin/music/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdminAuth());
  });

  it("updates name and mood_tag, returns updated track", async () => {
    const updated = { ...FAKE_TRACK, name: "Updated Name", mood_tag: "cinematic" };
    setupSupabasePatchMock(updated);

    const req = makeReq("PATCH", { name: "Updated Name", mood_tag: "cinematic" });
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(200);
    expect(res._body.track).toMatchObject({ name: "Updated Name", mood_tag: "cinematic" });
  });

  it("updates active field", async () => {
    const updated = { ...FAKE_TRACK, active: false };
    setupSupabasePatchMock(updated);

    const req = makeReq("PATCH", { active: false });
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(200);
    expect(res._body.track.active).toBe(false);
  });

  it("returns 400 when mood_tag is invalid", async () => {
    const req = makeReq("PATCH", { mood_tag: "jazz" });
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/mood_tag/i);
  });

  it("returns 400 when no editable fields provided", async () => {
    const req = makeReq("PATCH", {});
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/no editable fields/i);
  });

  it("returns 403 for non-admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockImplementation(async (_req, res) => {
      (res as any).status(403).json({ error: "Forbidden" });
      return null;
    });

    const req = makeReq("PATCH", { name: "New Name" });
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(403);
  });
});

describe("DELETE /api/admin/music/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdminAuth());
  });

  it("soft-deletes by setting active=false, returns ok:true, row still present", async () => {
    const { updateMock, eqMock } = setupSupabaseDeleteMock();

    const req = makeReq("DELETE");
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ ok: true });
    // Confirm update called with active:false (not a hard delete)
    expect(updateMock).toHaveBeenCalledWith({ active: false });
    expect(eqMock).toHaveBeenCalledWith("id", TRACK_ID);
  });

  it("returns 403 for non-admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockImplementation(async (_req, res) => {
      (res as any).status(403).json({ error: "Forbidden" });
      return null;
    });

    const req = makeReq("DELETE");
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(403);
  });

  it("returns 405 for unsupported method", async () => {
    const req = makeReq("POST");
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(405);
  });
});
