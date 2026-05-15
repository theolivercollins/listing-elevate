// api/admin/__tests__/voice-clone.test.ts
//
// Tests for the staff-driven voice clone enrollment endpoint. All methods
// are admin-only and act on a target_user_id (the customer being enrolled),
// not on the calling admin's own id.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { EventEmitter } from "node:events";

// ─── Mocks (hoisted before imports) ───────────────────────────────────────────

vi.mock("../../../lib/db.js", () => ({
  getSupabase: vi.fn(),
  setUserVoiceClone: vi.fn(),
  recordCostEvent: vi.fn(),
}));

vi.mock("../../../lib/auth.js", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("../../../lib/providers/elevenlabs.js", () => ({
  ElevenLabsProvider: vi.fn(),
}));

vi.mock("busboy", () => ({ default: vi.fn() }));

// ─── Imports ──────────────────────────────────────────────────────────────────

import handler from "../voice-clone.js";
import { getSupabase, setUserVoiceClone, recordCostEvent } from "../../../lib/db.js";
import { requireAdmin } from "../../../lib/auth.js";
import { ElevenLabsProvider } from "../../../lib/providers/elevenlabs.js";
import Busboy from "busboy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const adminUserId = "admin-001";
const targetUserId = "customer-abc-123";
const mockVoiceId = "el-voice-xyz";

function makeReq(
  method: string,
  opts: { query?: Record<string, string>; body?: Record<string, unknown> } = {},
): VercelRequest {
  const emitter = new EventEmitter() as unknown as VercelRequest & EventEmitter;
  (emitter as unknown as { method: string }).method = method;
  (emitter as unknown as { headers: Record<string, string> }).headers = {
    "content-type": "multipart/form-data; boundary=----boundary",
  };
  (emitter as unknown as { query: Record<string, string> }).query = opts.query ?? {};
  (emitter as unknown as { body: Record<string, unknown> }).body = opts.body ?? {};
  (emitter as unknown as { pipe: () => void }).pipe = vi.fn();
  return emitter as VercelRequest;
}

function makeRes() {
  const res = {
    _status: 200 as number,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader(k: string, v: string) { this._headers[k] = v; return this; },
    end() { return this; },
  };
  return res;
}

function adminAuth() {
  return {
    user: { id: adminUserId, email: "admin@listingelevate.com" },
    profile: {
      id: "profile-admin",
      user_id: adminUserId,
      role: "admin" as const,
      first_name: "Admin",
      last_name: "User",
      phone: null,
      email: "admin@listingelevate.com",
      brokerage: null,
      logo_url: null,
      colors: { primary: "#000", secondary: "#fff" },
      presets: [],
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    },
  };
}

/** Build a Busboy mock that fires file + target_user_id field + close. */
function setupBusboyHappyPath(opts: {
  mimeType?: string;
  filename?: string;
  sizeBytes?: number;
  withTargetUserId?: boolean;
} = {}) {
  const mimeType = opts.mimeType ?? "audio/mpeg";
  const filename = opts.filename ?? "sample.mp3";
  const sizeBytes = opts.sizeBytes ?? 1000;
  const withTargetUserId = opts.withTargetUserId !== false;

  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter();
    setImmediate(() => {
      if (withTargetUserId) bb.emit("field", "target_user_id", targetUserId);
      const stream = new EventEmitter();
      bb.emit("file", "sample", stream, { filename, mimeType });
      stream.emit("data", Buffer.alloc(sizeBytes));
      stream.emit("end");
      bb.emit("close");
    });
    return bb;
  });
}

function setupBusboyNoFile() {
  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter();
    setImmediate(() => {
      bb.emit("field", "target_user_id", targetUserId);
      bb.emit("close");
    });
    return bb;
  });
}

function setupBusboyOversized() {
  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter();
    setImmediate(() => {
      bb.emit("field", "target_user_id", targetUserId);
      const stream = new EventEmitter();
      bb.emit("file", "sample", stream, { filename: "big.mp3", mimeType: "audio/mpeg" });
      stream.emit("limit");
      stream.emit("end");
      bb.emit("close");
    });
    return bb;
  });
}

// ─── Supabase mock ────────────────────────────────────────────────────────────

function setupSupabaseMock(opts: { profileExists?: boolean } = {}) {
  const profileExists = opts.profileExists !== false;
  const uploadMock = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrlMock = vi.fn().mockReturnValue({
    data: { publicUrl: `https://storage.example.com/voiceovers/${targetUserId}/clone-sample.mp3` },
  });

  // Two different from('user_profiles') call shapes:
  //   POST: select(...).eq(...).maybeSingle() → for the targetProfile lookup
  //   GET:  select(...).eq(...).single()      → for the status read
  //   DELETE: update(...).eq(...)
  const maybeSingleMock = vi.fn().mockResolvedValue({
    data: profileExists
      ? { first_name: "Jane", last_name: "Customer", email: "customer@test.com" }
      : null,
    error: null,
  });
  const singleMock = vi.fn().mockResolvedValue({
    data: {
      voice_clone_status: "ready",
      elevenlabs_voice_id: mockVoiceId,
      voice_clone_paid_cents: 12500,
      voice_clone_paid_at: "2026-05-14T00:00:00Z",
      voice_clone_created_at: "2026-05-14T00:00:00Z",
    },
    error: null,
  });
  const eqMock = vi.fn().mockReturnValue({
    maybeSingle: maybeSingleMock,
    single: singleMock,
  });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  const updateEqMock = vi.fn().mockResolvedValue({ error: null });
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

  const supabaseMock = {
    storage: {
      from: vi.fn().mockReturnValue({ upload: uploadMock, getPublicUrl: getPublicUrlMock }),
    },
    from: vi.fn().mockReturnValue({ select: selectMock, update: updateMock }),
  };

  (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(supabaseMock);
  return { supabaseMock, uploadMock, selectMock, updateMock, maybeSingleMock };
}

function setupElevenLabsMock(voiceId = mockVoiceId) {
  const cloneVoiceMock = vi.fn().mockResolvedValue({ voiceId });
  (ElevenLabsProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    cloneVoice: cloneVoiceMock,
  }));
  return { cloneVoiceMock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/admin/voice-clone — staff uploads sample for a customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (setUserVoiceClone as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (recordCostEvent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("happy path — admin uploads for target user, returns 200 with voice_id", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyHappyPath();
    setupSupabaseMock();
    const { cloneVoiceMock } = setupElevenLabsMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      voice_id: mockVoiceId,
      status: "ready",
      paid_cents: 12500,
      user_id: targetUserId,
    });
    // Eager + final status flips on the TARGET, not the admin
    expect(setUserVoiceClone).toHaveBeenCalledWith(targetUserId, { status: "enrolling" });
    expect(setUserVoiceClone).toHaveBeenCalledWith(targetUserId, expect.objectContaining({
      voice_id: mockVoiceId,
      status: "ready",
      paid_cents: 12500,
    }));
    // Cost event metadata records BOTH the customer and the acting admin
    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: "elevenlabs",
      costCents: 0,
      metadata: expect.objectContaining({
        scope: "voice_clone_create",
        user_id: targetUserId,
        admin_user_id: adminUserId,
      }),
    }));
    expect(cloneVoiceMock).toHaveBeenCalledOnce();
  });

  it("returns 400 when target_user_id is missing", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyHappyPath({ withTargetUserId: false });
    setupSupabaseMock();
    setupElevenLabsMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/target_user_id/i);
  });

  it("returns 404 when target user has no user_profiles row", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyHappyPath();
    setupSupabaseMock({ profileExists: false });
    setupElevenLabsMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(404);
    expect((res._body as { error: string }).error).toMatch(/no user_profiles row/i);
  });

  it("returns 400 when no file is uploaded", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyNoFile();
    setupSupabaseMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/no file/i);
  });

  it("returns 415 when file has wrong MIME type", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyHappyPath({ mimeType: "application/pdf", filename: "doc.pdf" });
    setupSupabaseMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(415);
    expect((res._body as { error: string }).error).toMatch(/unsupported media type/i);
  });

  it("returns 413 when file exceeds 10 MB", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupBusboyOversized();
    setupSupabaseMock();

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(413);
    expect((res._body as { error: string }).error).toMatch(/too large/i);
  });

  it("returns 403 when caller is not admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockImplementation(async (_req, res) => {
      (res as unknown as ReturnType<typeof makeRes>).status(403).json({ error: "Forbidden" });
      return null;
    });

    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(403);
  });
});

describe("GET /api/admin/voice-clone — status check for a target user", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns current status for the target user", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupSupabaseMock();

    const req = makeReq("GET", { query: { user_id: targetUserId } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({
      status: "ready",
      voice_id: mockVoiceId,
      user_id: targetUserId,
    });
  });

  it("returns 400 when user_id query param is missing", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupSupabaseMock();

    const req = makeReq("GET");
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
  });
});

describe("PATCH /api/admin/voice-clone — flip status without uploading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (setUserVoiceClone as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("admin can move a user to 'scheduled'", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupSupabaseMock();

    const req = makeReq("PATCH", {
      query: { user_id: targetUserId },
      body: { status: "scheduled" },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(setUserVoiceClone).toHaveBeenCalledWith(targetUserId, { status: "scheduled" });
  });

  it("rejects an invalid status value", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupSupabaseMock();

    const req = makeReq("PATCH", {
      query: { user_id: targetUserId },
      body: { status: "garbage" },
    });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(400);
  });
});

describe("DELETE /api/admin/voice-clone — reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (setUserVoiceClone as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("admin resets a target user's clone state", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(adminAuth());
    setupSupabaseMock();

    const req = makeReq("DELETE", { query: { user_id: targetUserId } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ status: "none", user_id: targetUserId });
    expect(setUserVoiceClone).toHaveBeenCalledWith(
      targetUserId,
      expect.objectContaining({ status: "none" }),
    );
  });

  it("returns 403 for non-admin caller", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockImplementation(async (_req, res) => {
      (res as unknown as ReturnType<typeof makeRes>).status(403).json({ error: "Forbidden" });
      return null;
    });

    const req = makeReq("DELETE", { query: { user_id: targetUserId } });
    const res = makeRes();
    await handler(req, res as unknown as VercelResponse);

    expect(res._status).toBe(403);
  });
});
