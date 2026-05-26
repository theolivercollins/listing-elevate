import { describe, it, expect } from "vitest";
import { validateSceneGraph } from "./schema.js";
import type { PropertySceneGraph } from "../types.js";

/** Minimal valid PropertySceneGraph fixture */
function makeValidGraph(overrides: Partial<PropertySceneGraph> = {}): PropertySceneGraph {
  return {
    listing_id: "listing-123",
    photos: [
      {
        photo_id: "photo-1",
        room_id: "kitchen_1",
        room_confidence: 0.95,
        sub_region: null,
        camera_bearing_vector: "looking_into_room",
        shot_type: "wide",
        focal_subject: "kitchen island",
        visible_features: ["island", "stainless steel appliances"],
        visible_portals: [],
      },
    ],
    rooms: [
      {
        room_id: "kitchen_1",
        room_type: "kitchen",
        features: ["island", "stainless steel appliances"],
        photo_ids: ["photo-1"],
      },
    ],
    front_orientation: "N",
    exterior_shots: [],
    extracted_at: "2026-05-26T10:00:00.000Z",
    model_version: "gemini-2.5-pro@2026-05-26",
    ...overrides,
  };
}

describe("validateSceneGraph", () => {
  it("accepts a fully valid PropertySceneGraph", () => {
    const graph = makeValidGraph();
    expect(() => validateSceneGraph(graph)).not.toThrow();
    const result = validateSceneGraph(graph);
    expect(result.listing_id).toBe("listing-123");
    expect(result.photos).toHaveLength(1);
    expect(result.rooms).toHaveLength(1);
  });

  it("accepts a graph with visible_portals containing all required fields", () => {
    const graph = makeValidGraph({
      photos: [
        {
          photo_id: "photo-2",
          room_id: "living_room_1",
          room_confidence: 0.98,
          sub_region: null,
          camera_bearing_vector: "looking_out_of_room",
          shot_type: "medium",
          focal_subject: null,
          visible_features: ["sofa", "fireplace"],
          visible_portals: [
            {
              portal_id: "portal_1",
              from_room_id: "living_room_1",
              to_room_id: "kitchen_1",
              screen_position: {
                x: 0.8,
                y: 0.5,
                bbox: { x1: 0.7, y1: 0.2, x2: 0.9, y2: 0.8 },
              },
              depth_estimate: "mid",
              is_open_path: true,
              confidence: 0.9,
            },
          ],
        },
      ],
    });
    const result = validateSceneGraph(graph);
    expect(result.photos[0].visible_portals).toHaveLength(1);
    expect(result.photos[0].visible_portals[0].is_open_path).toBe(true);
  });

  it("accepts unknown front_orientation", () => {
    const graph = makeValidGraph({ front_orientation: "unknown" });
    expect(() => validateSceneGraph(graph)).not.toThrow();
  });

  it("accepts all valid ShotType values", () => {
    for (const shot_type of ["wide", "medium", "close", "aerial", "detail"] as const) {
      const graph = makeValidGraph({
        photos: [{ ...makeValidGraph().photos[0], shot_type }],
      });
      expect(() => validateSceneGraph(graph)).not.toThrow();
    }
  });

  it("accepts all valid BearingVector values", () => {
    const bearings = [
      "looking_into_room",
      "looking_out_of_room",
      "parallel_to_wall_N",
      "parallel_to_wall_E",
      "parallel_to_wall_S",
      "parallel_to_wall_W",
      "unknown",
    ] as const;
    for (const camera_bearing_vector of bearings) {
      const graph = makeValidGraph({
        photos: [{ ...makeValidGraph().photos[0], camera_bearing_vector }],
      });
      expect(() => validateSceneGraph(graph)).not.toThrow();
    }
  });

  it("rejects non-object input", () => {
    expect(() => validateSceneGraph(null)).toThrow("must be a JSON object");
    expect(() => validateSceneGraph("string")).toThrow("must be a JSON object");
    expect(() => validateSceneGraph(42)).toThrow("must be a JSON object");
  });

  it("rejects missing listing_id", () => {
    const { listing_id: _l, ...graph } = makeValidGraph();
    expect(() => validateSceneGraph(graph)).toThrow("listing_id");
  });

  it("rejects invalid front_orientation", () => {
    const graph = makeValidGraph({ front_orientation: "NE" as unknown as "N" });
    expect(() => validateSceneGraph(graph)).toThrow("front_orientation");
  });

  it("rejects invalid shot_type", () => {
    const graph = makeValidGraph({
      photos: [{ ...makeValidGraph().photos[0], shot_type: "panoramic" as unknown as "wide" }],
    });
    expect(() => validateSceneGraph(graph)).toThrow("shot_type");
  });

  it("rejects invalid camera_bearing_vector", () => {
    const graph = makeValidGraph({
      photos: [
        {
          ...makeValidGraph().photos[0],
          camera_bearing_vector: "facing_up" as unknown as "unknown",
        },
      ],
    });
    expect(() => validateSceneGraph(graph)).toThrow("camera_bearing_vector");
  });

  it("rejects photos with missing room_id", () => {
    const photo = { ...makeValidGraph().photos[0] };
    delete (photo as Partial<typeof photo>).room_id;
    const graph = makeValidGraph({ photos: [photo as typeof photo] });
    expect(() => validateSceneGraph(graph)).toThrow("room_id");
  });

  it("rejects portal with invalid depth_estimate", () => {
    const graph = makeValidGraph({
      photos: [
        {
          ...makeValidGraph().photos[0],
          visible_portals: [
            {
              portal_id: "p1",
              from_room_id: "kitchen_1",
              to_room_id: null,
              screen_position: { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 } },
              depth_estimate: "very_far" as unknown as "far",
              is_open_path: true,
              confidence: 0.8,
            },
          ],
        },
      ],
    });
    expect(() => validateSceneGraph(graph)).toThrow("depth_estimate");
  });

  it("rejects exterior_shots with invalid type", () => {
    const graph = makeValidGraph({
      exterior_shots: [{ photo_id: "photo-ext", type: "roof" as unknown as "aerial" }],
    });
    expect(() => validateSceneGraph(graph)).toThrow("type");
  });
});
