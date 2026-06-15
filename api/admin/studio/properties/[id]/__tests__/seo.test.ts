import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mockRequireAdmin = vi.fn();
const mockGetSupabase = vi.fn();
const mockFetchArtifact = vi.fn();
const mockGenerate = vi.fn();

vi.mock("../../../../../../lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("../../../../../../lib/client", () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));
vi.mock("../../../../../../lib/seo/repository", () => ({
  defaultSeoBaseUrl: () => "https://listingelevate.com",
  fetchListingSeoArtifactByPropertyId: (...args: unknown[]) => mockFetchArtifact(...args),
}));
vi.mock("../../../../../../lib/seo/generate", () => ({
  generateListingSeoForProperty: (...args: unknown[]) => mockGenerate(...args),
}));

import handler from "../seo";

function makeRes() {
  return {
    _status: 0,
    _body: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
}

function makeReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: "GET",
    query: { id: "prop-1" },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as VercelRequest;
}

beforeEach(() => {
  mockRequireAdmin.mockReset();
  mockGetSupabase.mockReset();
  mockFetchArtifact.mockReset();
  mockGenerate.mockReset();
  mockRequireAdmin.mockResolvedValue({ user: { id: "u1" }, profile: { role: "admin" } });
  mockGetSupabase.mockReturnValue({ from: vi.fn() });
});

describe("/api/admin/studio/properties/[id]/seo", () => {
  it("returns 401 when admin auth fails", async () => {
    mockRequireAdmin.mockImplementation((_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(401);
  });

  it("returns the current artifact on GET", async () => {
    mockFetchArtifact.mockResolvedValue({ id: "seo-1", slug: "listing-slug" });
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ artifact: { id: "seo-1", slug: "listing-slug" } });
    expect(mockFetchArtifact).toHaveBeenCalledWith(expect.anything(), "prop-1");
  });

  it("generates an artifact on POST", async () => {
    mockGenerate.mockResolvedValue({ id: "seo-2", slug: "fresh-slug" });
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { use_ai: false } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ artifact: { id: "seo-2", slug: "fresh-slug" } });
    expect(mockGenerate).toHaveBeenCalledWith({
      propertyId: "prop-1",
      baseUrl: "https://listingelevate.com",
      useAi: false,
      force: false,
    });
  });

  it("passes force=true when explicitly requested", async () => {
    mockGenerate.mockResolvedValue({ id: "seo-3", slug: "forced-slug" });
    const res = makeRes();
    await handler(makeReq({ method: "POST", body: { use_ai: true, force: true } }), res as unknown as VercelResponse);
    expect(res._status).toBe(200);
    expect(mockGenerate).toHaveBeenCalledWith({
      propertyId: "prop-1",
      baseUrl: "https://listingelevate.com",
      useAi: true,
      force: true,
    });
  });

  it("returns 409 when there is no active public preview link", async () => {
    mockGenerate.mockRejectedValue(new Error("public_preview_required"));
    const res = makeRes();
    await handler(makeReq({ method: "POST" }), res as unknown as VercelResponse);
    expect(res._status).toBe(409);
    expect(res._body).toMatchObject({ error: "public_preview_required" });
  });
});
