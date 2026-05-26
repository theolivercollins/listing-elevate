import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PropertySceneGraph } from "../types.js";

// ── Mock @google/genai before importing extractor ──
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

// ── Mock lib/db.js to avoid real Supabase connection ──
vi.mock("../../db.js", () => ({
  recordCostEvent: vi.fn().mockResolvedValue(undefined),
}));

// Set required env so extractor doesn't throw on missing key
process.env.GEMINI_API_KEY = "test-key";

// Import AFTER mocks are established
import { extractSceneGraph } from "./extractor.js";

/** A minimal valid PropertySceneGraph as a string for Gemini to "return" */
function makeValidGraphPayload(listingId: string): string {
  const graph: PropertySceneGraph = {
    listing_id: listingId,
    photos: [
      {
        photo_id: "photo-1",
        room_id: "kitchen_1",
        room_confidence: 0.97,
        sub_region: null,
        camera_bearing_vector: "looking_into_room",
        shot_type: "wide",
        focal_subject: "kitchen island",
        visible_features: ["island", "appliances"],
        visible_portals: [],
      },
    ],
    rooms: [
      {
        room_id: "kitchen_1",
        room_type: "kitchen",
        features: ["island", "appliances"],
        photo_ids: ["photo-1"],
      },
    ],
    front_orientation: "N",
    exterior_shots: [],
    extracted_at: "2026-05-26T10:00:00.000Z",
    model_version: "gemini-2.5-pro@2026-05-26",
  };
  return JSON.stringify(graph);
}

function makeGeminiResponse(text: string) {
  return {
    text,
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
  };
}

describe("extractSceneGraph", () => {
  const LISTING_ID = "listing-abc";
  const PHOTOS = [{ id: "photo-1", url: "https://example.com/photo1.jpg" }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path — returns validated graph on clean Gemini response", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      makeGeminiResponse(makeValidGraphPayload(LISTING_ID)),
    );

    const result = await extractSceneGraph(LISTING_ID, PHOTOS);

    expect(result.listing_id).toBe(LISTING_ID);
    expect(result.photos).toHaveLength(1);
    expect(result.rooms).toHaveLength(1);
    expect(result.front_orientation).toBe("N");
    // Gemini called exactly once
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("retries once on JSON validation failure, succeeds on retry", async () => {
    // First call returns invalid JSON structure (missing required fields)
    const badPayload = JSON.stringify({ listing_id: LISTING_ID, wrong_field: true });
    mockGenerateContent
      .mockResolvedValueOnce(makeGeminiResponse(badPayload))
      .mockResolvedValueOnce(makeGeminiResponse(makeValidGraphPayload(LISTING_ID)));

    const result = await extractSceneGraph(LISTING_ID, PHOTOS);

    expect(result.listing_id).toBe(LISTING_ID);
    // Should have been called twice — first attempt + retry
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    // Retry message should mention the validation failure
    const retryCall = mockGenerateContent.mock.calls[1][0];
    const contents = retryCall.contents as Array<{ role: string; parts: Array<{ text?: string }> }>;
    const retryUserMsg = contents.find(
      (c) => c.role === "user" && c.parts.some((p) => p.text?.includes("failed validation")),
    );
    expect(retryUserMsg).toBeDefined();
  });

  it("throws after retry also fails validation", async () => {
    const badPayload = JSON.stringify({ listing_id: LISTING_ID, wrong_field: true });
    mockGenerateContent
      .mockResolvedValueOnce(makeGeminiResponse(badPayload))
      .mockResolvedValueOnce(makeGeminiResponse(badPayload)); // retry also bad

    await expect(extractSceneGraph(LISTING_ID, PHOTOS)).rejects.toThrow();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on completely non-JSON response after retry", async () => {
    const notJson = "Sorry, I cannot analyze these images right now.";
    mockGenerateContent
      .mockResolvedValueOnce(makeGeminiResponse(notJson))
      .mockResolvedValueOnce(makeGeminiResponse(notJson));

    await expect(extractSceneGraph(LISTING_ID, PHOTOS)).rejects.toThrow(/non-JSON|JSON/i);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("accepts markdown-fenced JSON and strips fences", async () => {
    const fenced = "```json\n" + makeValidGraphPayload(LISTING_ID) + "\n```";
    mockGenerateContent.mockResolvedValueOnce(makeGeminiResponse(fenced));

    const result = await extractSceneGraph(LISTING_ID, PHOTOS);
    expect(result.listing_id).toBe(LISTING_ID);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("includes all photos as fileData parts in the request", async () => {
    const multiPhotos = [
      { id: "photo-1", url: "https://example.com/photo1.jpg" },
      { id: "photo-2", url: "https://example.com/photo2.jpg" },
      { id: "photo-3", url: "https://example.com/photo3.jpg" },
    ];

    // Return a graph with 3 photos
    const graph: PropertySceneGraph = {
      listing_id: LISTING_ID,
      photos: multiPhotos.map((p) => ({
        photo_id: p.id,
        room_id: "room_1",
        room_confidence: 0.97,
        sub_region: null,
        camera_bearing_vector: "unknown" as const,
        shot_type: "wide" as const,
        focal_subject: null,
        visible_features: [],
        visible_portals: [],
      })),
      rooms: [
        { room_id: "room_1", room_type: "bedroom", features: [], photo_ids: multiPhotos.map((p) => p.id) },
      ],
      front_orientation: "unknown",
      exterior_shots: [],
      extracted_at: "2026-05-26T10:00:00.000Z",
      model_version: "gemini-2.5-pro@2026-05-26",
    };
    mockGenerateContent.mockResolvedValueOnce(makeGeminiResponse(JSON.stringify(graph)));

    await extractSceneGraph(LISTING_ID, multiPhotos);

    const call = mockGenerateContent.mock.calls[0][0];
    const contents = call.contents as Array<{ role: string; parts: unknown[] }>;
    const userParts = contents[0].parts;
    // Should have 1 text part + 3 image parts
    expect(userParts).toHaveLength(4);
  });
});
