import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PhotoSceneFacts, PairCandidate, PickerPrediction } from "../types.js";
import { routePhoto } from "./router.js";

function makePhoto(overrides: Partial<PhotoSceneFacts> = {}): PhotoSceneFacts {
  return {
    photo_id: "photo-1",
    room_id: "room-1",
    room_confidence: 0.99,
    sub_region: null,
    camera_bearing_vector: "looking_into_room",
    shot_type: "wide",
    focal_subject: null,
    visible_features: [],
    visible_portals: [],
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<PairCandidate> = {}): PairCandidate {
  return {
    candidate_id: "cand-1",
    listing_id: "listing-1",
    photo_a_id: "photo-1",
    photo_b_id: "photo-2",
    candidate_type: "same_room_different_angle",
    heuristic_score: 0.8,
    reasoning: "test",
    portal_id: null,
    ...overrides,
  };
}

function makePrediction(score: number): PickerPrediction {
  return {
    score,
    confidence: 0.9,
    top_3_features: [],
    model_version: "heuristic-v1",
    used_fallback_heuristic: true,
  };
}

describe("routePhoto", () => {
  it("routes to v21_pair when all conditions pass", () => {
    const result = routePhoto(makePhoto(), [makeCandidate()], makePrediction(0.8));
    expect(result).toBe("v21_pair");
  });

  it("falls through when room_confidence < 0.97 (default gate)", () => {
    const result = routePhoto(makePhoto({ room_confidence: 0.96 }), [makeCandidate()], makePrediction(0.8));
    expect(result).toBe("v1_single_image");
  });

  it("falls through exactly at 0.97 boundary — 0.97 is v21_pair (gte semantics uses strict <)", () => {
    const result = routePhoto(makePhoto({ room_confidence: 0.97 }), [makeCandidate()], makePrediction(0.8));
    expect(result).toBe("v21_pair");
  });

  it("falls through when candidates array is empty", () => {
    const result = routePhoto(makePhoto(), [], makePrediction(0.8));
    expect(result).toBe("v1_single_image");
  });

  it("falls through when pickerScore.score < 0.5", () => {
    const result = routePhoto(makePhoto(), [makeCandidate()], makePrediction(0.49));
    expect(result).toBe("v1_single_image");
  });

  it("routes to v21_pair when pickerScore is null (no picker yet)", () => {
    const result = routePhoto(makePhoto(), [makeCandidate()], null);
    expect(result).toBe("v21_pair");
  });

  it("respects opts.roomConfidenceGate override", () => {
    // With a lower gate of 0.90, a photo at 0.95 should pass
    const pass = routePhoto(makePhoto({ room_confidence: 0.95 }), [makeCandidate()], null, { roomConfidenceGate: 0.90 });
    expect(pass).toBe("v21_pair");

    // With a higher gate of 0.99, a photo at 0.98 should fall through
    const fail = routePhoto(makePhoto({ room_confidence: 0.98 }), [makeCandidate()], null, { roomConfidenceGate: 0.99 });
    expect(fail).toBe("v1_single_image");
  });

  it("uses GEN2_V21_ROOM_CONFIDENCE_GATE env var when no opts override", () => {
    const original = process.env.GEN2_V21_ROOM_CONFIDENCE_GATE;
    try {
      process.env.GEN2_V21_ROOM_CONFIDENCE_GATE = "0.90";
      // Photo at 0.91 should pass with gate=0.90
      const pass = routePhoto(makePhoto({ room_confidence: 0.91 }), [makeCandidate()], null);
      expect(pass).toBe("v21_pair");

      // Photo at 0.89 should fall through
      const fail = routePhoto(makePhoto({ room_confidence: 0.89 }), [makeCandidate()], null);
      expect(fail).toBe("v1_single_image");
    } finally {
      if (original === undefined) {
        delete process.env.GEN2_V21_ROOM_CONFIDENCE_GATE;
      } else {
        process.env.GEN2_V21_ROOM_CONFIDENCE_GATE = original;
      }
    }
  });
});
