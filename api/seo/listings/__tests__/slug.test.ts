import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const mockGetSupabase = vi.fn();
const mockFetchBySlug = vi.fn();

vi.mock("../../../../lib/client", () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));
vi.mock("../../../../lib/seo/repository", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/seo/repository")>("../../../../lib/seo/repository");
  return {
    ...actual,
    defaultSeoBaseUrl: () => "https://listingelevate.com",
    fetchPublicListingSeoArtifactBySlug: (...args: unknown[]) => mockFetchBySlug(...args),
  };
});

import handler from "../[slug]";
import jsonHandler from "../[slug].json";

function makeRes() {
  return {
    _status: 0,
    _body: "",
    _headers: {} as Record<string, string>,
    status(code: number) { this._status = code; return this; },
    send(body: string) { this._body = body; return this; },
    setHeader(key: string, value: string) { this._headers[key] = value; return this; },
  };
}

function makeJsonRes() {
  return {
    _status: 0,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
    setHeader(key: string, value: string) { this._headers[key] = value; return this; },
  };
}

function makeReq(slug = "5019-san-massimo-dr"): VercelRequest {
  return {
    method: "GET",
    query: { slug },
    headers: {},
  } as unknown as VercelRequest;
}

const artifact = {
  id: "seo-1",
  property_id: "prop-1",
  preview_id: "preview-1",
  slug: "5019-san-massimo-dr",
  status: "generated",
  indexable: true,
  title: "5019 San Massimo Dr | Punta Gorda Listing Film",
  meta_description: "3 bed, 2 bath listing film.",
  summary: "Short summary.",
  long_description: "Long listing description.",
  highlights: ["3 bedrooms", "2 bathrooms"],
  faqs: [{ question: "Where is it?", answer: "Punta Gorda, FL." }],
  schema_json: {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "VideoObject", contentUrl: "https://cdn.example.com/video.mp4", embedUrl: "https://listingelevate.com/preview/token" },
      { "@type": "House", image: ["https://cdn.example.com/photo.jpg"] },
    ],
  },
  llms_markdown: "# 5019 San Massimo Dr\n",
  source_fingerprint: "abc",
  generated_by: "deterministic",
  model: null,
  prompt_version: "ai-seo-v1",
  cost_cents: 0,
  error: null,
  generated_at: "2026-06-14T12:00:00Z",
  created_at: "2026-06-14T12:00:00Z",
  updated_at: "2026-06-14T12:00:00Z",
};

beforeEach(() => {
  mockGetSupabase.mockReset();
  mockFetchBySlug.mockReset();
  mockGetSupabase.mockReturnValue({ from: vi.fn() });
});

describe("/listings/:slug SEO page", () => {
  it("returns server-rendered listing HTML", async () => {
    mockFetchBySlug.mockResolvedValue(artifact);
    const res = makeRes();
    await handler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(res._body).toContain("<title>5019 San Massimo Dr | Punta Gorda Listing Film</title>");
    expect(res._body).toContain('rel="canonical" href="https://listingelevate.com/listings/5019-san-massimo-dr"');
    expect(res._body).toContain('application/ld+json');
    expect(mockFetchBySlug).toHaveBeenCalledWith(expect.anything(), "5019-san-massimo-dr");
  });

  it("returns 404 when the artifact is not public", async () => {
    mockFetchBySlug.mockResolvedValue(null);
    const res = makeRes();
    await handler(makeReq("missing"), res as unknown as VercelResponse);

    expect(res._status).toBe(404);
    expect(res._body).toBe("Not found");
  });

  it("public JSON omits internal IDs, costs, model details, and errors", async () => {
    mockFetchBySlug.mockResolvedValue(artifact);
    const res = makeJsonRes();
    await jsonHandler(makeReq(), res as unknown as VercelResponse);

    expect(res._status).toBe(200);
    const body = res._body as { listing: Record<string, unknown> };
    expect(body.listing.slug).toBe("5019-san-massimo-dr");
    expect(body.listing.title).toBe("5019 San Massimo Dr | Punta Gorda Listing Film");
    expect(body.listing).not.toHaveProperty("id");
    expect(body.listing).not.toHaveProperty("property_id");
    expect(body.listing).not.toHaveProperty("preview_id");
    expect(body.listing).not.toHaveProperty("cost_cents");
    expect(body.listing).not.toHaveProperty("model");
    expect(body.listing).not.toHaveProperty("error");
  });
});
