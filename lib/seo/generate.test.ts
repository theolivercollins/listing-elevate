import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSupabase = vi.fn();
const mockRecordCostEvent = vi.fn();
const mockFetchSource = vi.fn();
const mockFetchArtifactByProperty = vi.fn();
const mockUpsertArtifact = vi.fn();
const mockCanStoreArtifacts = vi.fn();

vi.mock("../client", () => ({
  getSupabase: (...args: unknown[]) => mockGetSupabase(...args),
}));
vi.mock("../db", () => ({
  recordCostEvent: (...args: unknown[]) => mockRecordCostEvent(...args),
}));
vi.mock("./repository", async () => {
  const actual = await vi.importActual<typeof import("./repository")>("./repository");
  return {
    ...actual,
    defaultSeoBaseUrl: () => "https://listingelevate.com",
    canStoreListingSeoArtifacts: (...args: unknown[]) => mockCanStoreArtifacts(...args),
    fetchListingSeoSource: (...args: unknown[]) => mockFetchSource(...args),
    fetchListingSeoArtifactByPropertyId: (...args: unknown[]) => mockFetchArtifactByProperty(...args),
    upsertListingSeoArtifact: (...args: unknown[]) => mockUpsertArtifact(...args),
  };
});

import { generateListingSeoForProperty } from "./generate";
import { buildListingSeoArtifact } from "./artifact";
import type { ListingSeoSource } from "./types";

const source: ListingSeoSource = {
  property: {
    id: "prop-1",
    address: "5019 San Massimo Dr, Punta Gorda, FL 33950, USA",
    price: 725000,
    bedrooms: 3,
    bathrooms: 2,
    square_footage: 2140,
    listing_agent: "Avery Collins",
    brokerage: "Recasi Realty",
    horizontal_video_url: "https://cdn.example.com/h.mp4",
    vertical_video_url: null,
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-06-10T12:00:00Z",
  },
  preview: {
    id: "preview-1",
    token: "P78rHGXUN3nrc9d4iy5l60vfFPyhQeVl",
    kind: "public",
    expires_at: null,
    revoked_at: null,
    created_at: "2026-06-10T12:00:00Z",
  },
  client: {
    name: "Helgemo Team",
    agent_name: "Avery Collins",
    brokerage: "Recasi Realty",
    brand_logo_url: null,
    agent_headshot_url: null,
  },
  hero_photo_url: "https://cdn.example.com/hero.jpg",
  photos: [
    { file_url: "https://cdn.example.com/kitchen.jpg", room_type: "kitchen", key_features: ["waterfall island"], selected: true, quality_score: 0.98 },
  ],
  canonical_url: "https://listingelevate.com/listings/5019-san-massimo-dr-punta-gorda-fl-33950-p78rhgxu",
  base_url: "https://listingelevate.com",
};

function makeAnthropic() {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: "text",
          text: JSON.stringify({
            meta_description: "AI meta for the listing.",
            summary: "AI summary for the listing.",
            long_description: "AI long description for the listing.",
            highlights: ["3 bedrooms", "waterfall island", "listing film"],
            faqs: [
              { question: "Where is it?", answer: "Punta Gorda, FL." },
              { question: "Who represents it?", answer: "Avery Collins." },
              { question: "Is there video?", answer: "Yes." },
            ],
          }),
        }],
        usage: { input_tokens: 1000, output_tokens: 500 },
      }),
    },
  };
}

beforeEach(() => {
  mockGetSupabase.mockReset().mockReturnValue({ from: vi.fn() });
  mockRecordCostEvent.mockReset().mockResolvedValue(undefined);
  mockFetchSource.mockReset().mockResolvedValue(source);
  mockFetchArtifactByProperty.mockReset().mockResolvedValue(null);
  mockCanStoreArtifacts.mockReset().mockResolvedValue(true);
  mockUpsertArtifact.mockReset().mockImplementation((_db, _source, artifact) => Promise.resolve({ id: "seo-1", ...artifact }));
  delete process.env.ANTHROPIC_API_KEY;
});

describe("generateListingSeoForProperty", () => {
  it("skips paid generation when the stored fingerprint is current", async () => {
    const current = buildListingSeoArtifact(source);
    mockFetchArtifactByProperty.mockResolvedValue({ id: "seo-existing", ...current });
    process.env.ANTHROPIC_API_KEY = "test-key";
    const anthropicClient = makeAnthropic();

    const result = await generateListingSeoForProperty(
      { propertyId: "prop-1", useAi: true },
      { anthropicClient },
    );

    expect(result.id).toBe("seo-existing");
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(mockUpsertArtifact).not.toHaveBeenCalled();
  });

  it("fails loudly when a paid Anthropic call succeeds but cost ledger insert fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockRecordCostEvent.mockRejectedValue(new Error("cost_events insert failed"));

    await expect(generateListingSeoForProperty(
      { propertyId: "prop-1", useAi: true },
      { anthropicClient: makeAnthropic() },
    )).rejects.toThrow(/ai_seo_cost_ledger_failed/);

    expect(mockUpsertArtifact).not.toHaveBeenCalled();
  });

  it("can force regeneration even when the fingerprint is current", async () => {
    const current = buildListingSeoArtifact(source);
    mockFetchArtifactByProperty.mockResolvedValue({ id: "seo-existing", ...current });
    process.env.ANTHROPIC_API_KEY = "test-key";
    const anthropicClient = makeAnthropic();

    await generateListingSeoForProperty(
      { propertyId: "prop-1", useAi: true, force: true },
      { anthropicClient },
    );

    expect(anthropicClient.messages.create).toHaveBeenCalledTimes(1);
    expect(mockUpsertArtifact).toHaveBeenCalledTimes(1);
  });

  it("returns a deterministic stateless artifact and skips paid generation when the artifact table is unavailable", async () => {
    mockCanStoreArtifacts.mockResolvedValue(false);
    process.env.ANTHROPIC_API_KEY = "test-key";
    const anthropicClient = makeAnthropic();

    const result = await generateListingSeoForProperty(
      { propertyId: "prop-1", useAi: true },
      { anthropicClient },
    );

    expect(result.id).toBe("stateless:preview-1");
    expect(result.generated_by).toBe("deterministic");
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(mockFetchArtifactByProperty).not.toHaveBeenCalled();
    expect(mockUpsertArtifact).not.toHaveBeenCalled();
  });
});
