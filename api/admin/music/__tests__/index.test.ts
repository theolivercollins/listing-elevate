// api/admin/music/__tests__/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { EventEmitter } from "node:events";

// ─── Mocks must be hoisted before any imports that trigger module evaluation ──

vi.mock("../../../../lib/client.js", () => ({
  getSupabase: vi.fn(),
}));

vi.mock("../../../../lib/auth.js", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("busboy", () => {
  return { default: vi.fn() };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import handler from "../index.js";
import { getSupabase } from "../../../../lib/client.js";
import { requireAdmin } from "../../../../lib/auth.js";
import Busboy from "busboy";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  extraHeaders: Record<string, string> = {}
): VercelRequest {
  const emitter = new EventEmitter() as any;
  emitter.method = method;
  emitter.headers = {
    "content-type": "multipart/form-data; boundary=----boundary",
    ...extraHeaders,
  };
  emitter.query = {};
  emitter.body = {};
  emitter.pipe = vi.fn();
  return emitter as VercelRequest;
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

/** Busboy that emits a valid audio file + specified fields, then closes. */
function setupBusboyHappyPath(
  fields: Record<string, string> = {},
  mimeType = "audio/mpeg",
  filename = "track.mp3",
  sizeBytes = 1000
) {
  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter() as any;
    setImmediate(() => {
      // Emit fields
      for (const [name, val] of Object.entries(fields)) {
        bb.emit("field", name, val);
      }
      // Emit file
      const stream = new EventEmitter() as any;
      bb.emit("file", "file", stream, { filename, mimeType });
      stream.emit("data", Buffer.alloc(sizeBytes));
      stream.emit("end");
      bb.emit("close");
    });
    return bb;
  });
}

/** Busboy that closes with no file. */
function setupBusboyNoFile(fields: Record<string, string> = {}) {
  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter() as any;
    setImmediate(() => {
      for (const [name, val] of Object.entries(fields)) {
        bb.emit("field", name, val);
      }
      bb.emit("close");
    });
    return bb;
  });
}

/** Busboy that fires the stream 'limit' event (oversized). */
function setupBusboyOversized() {
  (Busboy as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const bb = new EventEmitter() as any;
    setImmediate(() => {
      const stream = new EventEmitter() as any;
      stream.resume = vi.fn();
      bb.emit("file", "file", stream, { filename: "big.mp3", mimeType: "audio/mpeg" });
      stream.emit("limit");
      stream.emit("end");
      bb.emit("close");
    });
    return bb;
  });
}

// ─── Supabase mock helpers ────────────────────────────────────────────────────

const FAKE_TRACK = {
  id: "track-uuid-1",
  name: "Bright Beginnings",
  file_url: "https://storage.example.com/music/track-uuid-1.mp3",
  mood_tag: "upbeat",
  duration_seconds: null,
  license: null,
  attribution: null,
  active: true,
  created_at: "2026-05-14T00:00:00Z",
};

function setupSupabaseMockForPost() {
  const uploadMock = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrlMock = vi.fn().mockReturnValue({
    data: { publicUrl: FAKE_TRACK.file_url },
  });
  const insertMock = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: FAKE_TRACK, error: null }),
    }),
  });

  const supabaseMock = {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: insertMock,
    }),
  };

  (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(supabaseMock);
  return { supabaseMock, uploadMock, insertMock };
}

function setupSupabaseMockForGet(tracks: typeof FAKE_TRACK[] = [FAKE_TRACK]) {
  const orderMock2 = vi.fn().mockResolvedValue({ data: tracks, error: null });
  const orderMock1 = vi.fn().mockReturnValue({ order: orderMock2 });
  const selectMock = vi.fn().mockReturnValue({ order: orderMock1 });

  const supabaseMock = {
    from: vi.fn().mockReturnValue({ select: selectMock }),
  };

  (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(supabaseMock);
  return { supabaseMock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/admin/music", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdminAuth());
  });

  it("returns list of tracks", async () => {
    setupSupabaseMockForGet([FAKE_TRACK]);
    const req = makeReq("GET");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(200);
    expect(res._body.tracks).toHaveLength(1);
    expect(res._body.tracks[0].id).toBe(FAKE_TRACK.id);
  });

  it("returns 403 for non-admin", async () => {
    (requireAdmin as ReturnType<typeof vi.fn>).mockImplementation(async (_req, res) => {
      (res as any).status(403).json({ error: "Forbidden" });
      return null;
    });
    const req = makeReq("GET");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(403);
  });
});

describe("POST /api/admin/music — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdminAuth());
  });

  it("uploads file, inserts row, returns track", async () => {
    setupBusboyHappyPath({ name: "Bright Beginnings", mood_tag: "upbeat" });
    const { uploadMock, insertMock } = setupSupabaseMockForPost();

    const req = makeReq("POST");
    const res = makeRes();

    await handler(req, res as any);

    expect(res._status).toBe(200);
    expect(res._body.track).toMatchObject({ id: FAKE_TRACK.id, mood_tag: "upbeat" });
    expect(uploadMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/music — validation errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAdmin as ReturnType<typeof vi.fn>).mockResolvedValue(makeAdminAuth());
  });

  it("returns 400 when no file is provided", async () => {
    setupBusboyNoFile({ name: "Track", mood_tag: "upbeat" });
    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/file required/i);
  });

  it("returns 400 when mood_tag is invalid", async () => {
    setupBusboyHappyPath({ name: "Track", mood_tag: "disco" });
    setupSupabaseMockForPost();
    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/mood_tag/i);
  });

  it("returns 413 when file exceeds 20 MB limit", async () => {
    setupBusboyOversized();
    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(413);
    expect(res._body.error).toMatch(/too large/i);
  });

  it("returns 415 when file MIME type is not audio", async () => {
    setupBusboyHappyPath(
      { name: "Track", mood_tag: "upbeat" },
      "application/pdf",
      "doc.pdf"
    );
    setupSupabaseMockForPost();
    const req = makeReq("POST");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(415);
    expect(res._body.error).toMatch(/unsupported media type/i);
  });

  it("returns 405 for unsupported method", async () => {
    const req = makeReq("DELETE");
    const res = makeRes();
    await handler(req, res as any);
    expect(res._status).toBe(405);
  });
});
