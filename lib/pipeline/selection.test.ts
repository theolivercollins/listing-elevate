import { describe, it, expect } from "vitest";
import {
  buildPhotoSelectionLearning,
  selectPhotosWithExplanation,
  TARGET_SCENE_COUNT,
  MAX_PER_ROOM_TYPE,
} from "./selection.js";
import type { PhotoAnalysisResult } from "../prompts/photo-analysis.js";
import type { RoomType } from "../db.js";

function candidate(
  id: string,
  room_type: RoomType,
  aesthetic_score: number,
  extra: Partial<PhotoAnalysisResult> = {},
): { id: string; analysis: PhotoAnalysisResult } {
  return {
    id,
    analysis: {
      room_type,
      quality_score: 8,
      aesthetic_score,
      depth_rating: "high",
      key_features: [],
      composition: "",
      suggested_discard: false,
      discard_reason: null,
      video_viable: true,
      suggested_motion: null,
      motion_rationale: null,
      ...extra,
    },
  };
}

describe("selectPhotosWithExplanation", () => {
  it("picks the highest-aesthetic photo from each required room type", () => {
    const results = [
      candidate("ef-low", "exterior_front", 7.0),
      candidate("ef-high", "exterior_front", 9.5),
      candidate("k", "kitchen", 8.0),
      candidate("lr", "living_room", 8.5),
      candidate("mb", "master_bedroom", 6.0),
      candidate("ba", "bathroom", 7.5),
    ];

    const { verdicts } = selectPhotosWithExplanation(results);
    // Within the exterior_front group the higher aesthetic wins the required slot.
    expect(verdicts.get("ef-high")?.status).toBe("selected");
    expect(verdicts.get("ef-high")?.reason).toMatch(/required room.*exterior front/i);
    // The sibling ef-low still gets selected via the fill pass (TARGET is 12,
    // we're well under), but with a "Fill slot" reason rather than the
    // required-room reason.
    expect(verdicts.get("ef-low")?.status).toBe("selected");
    expect(verdicts.get("ef-low")?.reason).toMatch(/fill slot/i);
    // Every other required room also has its verdict reflect the required pass.
    for (const id of ["k", "lr", "mb", "ba"]) {
      expect(verdicts.get(id)?.reason).toMatch(/required room/i);
    }
  });

  it("discards a photo flagged by the analyzer with a video-viable=false verdict", () => {
    const results = [
      candidate("good", "kitchen", 9),
      candidate("bad", "kitchen", 9.5, {
        video_viable: false,
        motion_rationale: "camera trapped behind island",
      }),
      candidate("skip", "bedroom", 6.5, { suggested_discard: true, discard_reason: "severe blur" }),
    ];

    const { verdicts } = selectPhotosWithExplanation(results);
    expect(verdicts.get("bad")?.status).toBe("discarded");
    expect(verdicts.get("bad")?.reason).toMatch(/camera trapped behind island/);
    expect(verdicts.get("skip")?.status).toBe("discarded");
    expect(verdicts.get("skip")?.reason).toMatch(/severe blur/);
    expect(verdicts.get("good")?.status).toBe("selected");
  });

  it("caps at TARGET_SCENE_COUNT with a 'scene cap reached' reason on overflow", () => {
    // Flood with 20 unique rooms so the per-room cap never bites — only the
    // global TARGET_SCENE_COUNT cap should.
    const rooms: RoomType[] = [
      "exterior_front", "kitchen", "living_room", "master_bedroom", "bathroom",
      "exterior_back", "aerial", "dining", "hallway", "foyer",
      "office", "laundry", "closet", "basement", "deck",
      "powder_room", "stairs", "media_room", "gym", "mudroom",
    ];
    const results = rooms.map((r, i) => candidate(`${r}-${i}`, r, 9 - i * 0.1));

    const { selected, verdicts } = selectPhotosWithExplanation(results);
    expect(selected.length).toBe(TARGET_SCENE_COUNT);

    // The overflow entries should carry the scene-cap reason.
    const overflow = results.filter((r) => verdicts.get(r.id)?.status === "not_selected");
    expect(overflow.length).toBe(rooms.length - TARGET_SCENE_COUNT);
    for (const o of overflow) {
      expect(verdicts.get(o.id)?.reason).toMatch(/scene cap of 12/i);
    }
  });

  it("surfaces per-room quota with the winning photos' scores", () => {
    // Three kitchens — MAX_PER_ROOM_TYPE=2 means the weakest one must be
    // not_selected with a quota reason naming the two winners.
    const results = [
      candidate("k-top", "kitchen", 9.8),
      candidate("k-mid", "kitchen", 9.0),
      candidate("k-low", "kitchen", 8.0),
      candidate("lr", "living_room", 9),
      candidate("mb", "master_bedroom", 9),
      candidate("ba", "bathroom", 9),
      candidate("ef", "exterior_front", 9),
    ];

    const { verdicts } = selectPhotosWithExplanation(results);
    expect(verdicts.get("k-top")?.status).toBe("selected");
    expect(verdicts.get("k-mid")?.status).toBe("selected");
    expect(verdicts.get("k-low")?.status).toBe("not_selected");
    const reason = verdicts.get("k-low")?.reason ?? "";
    expect(reason).toMatch(/kitchen quota full/i);
    expect(reason).toMatch(new RegExp(`max ${MAX_PER_ROOM_TYPE}`));
    expect(reason).toMatch(/9\.8/);
    expect(reason).toMatch(/9\.0/);
  });

  it("returns 1-based ranks matching pick order", () => {
    const results = [
      candidate("ef", "exterior_front", 8),
      candidate("k", "kitchen", 8),
    ];
    const { verdicts } = selectPhotosWithExplanation(results);
    // REQUIRED_ROOM_TYPES order is [exterior_front, kitchen, ...] — so ef is #1.
    expect(verdicts.get("ef")?.rank).toBe(1);
    expect(verdicts.get("k")?.rank).toBe(2);
  });

  it("builds room-level learning from photo_selection events", () => {
    const learning = buildPhotoSelectionLearning([
      {
        payload: {
          removed: [
            { id: "laundry-a", room_type: "laundry", operator_feedback: { category: "low_value_room" } },
            { id: "mudroom-a", room_type: "mudroom", operator_feedback: { category: "low_value_room" } },
          ],
          added: [
            { id: "office-a", room_type: "office", operator_feedback: { category: "feature_room" } },
          ],
          kept: [
            { id: "front-a", room_type: "exterior_front", operator_feedback: { category: "hero_exterior" } },
          ],
        },
      },
    ]);

    expect(learning.room_type_adjustments.laundry).toBeLessThan(-1);
    expect(learning.room_type_adjustments.mudroom).toBeLessThan(-1);
    expect(learning.room_type_adjustments.office).toBeGreaterThan(0);
    expect(learning.room_type_adjustments.exterior_front).toBeGreaterThan(0);
  });

  it("learns from rejection categories beyond low-value rooms", () => {
    const learning = buildPhotoSelectionLearning([
      {
        payload: {
          removed: [
            { id: "laundry-a", room_type: "laundry", operator_feedback: { category: "weak_video_potential" } },
            { id: "garage-a", room_type: "garage", operator_feedback: { category: "bad_composition" } },
            { id: "closet-a", room_type: "closet", operator_feedback: { category: "not_representative" } },
          ],
        },
      },
    ]);

    expect(learning.room_type_adjustments.laundry).toBeLessThan(0);
    expect(learning.room_type_adjustments.garage).toBeLessThan(0);
    expect(learning.room_type_adjustments.closet).toBeLessThan(0);
  });

  it("learns from operator reordering of kept photos", () => {
    const learning = buildPhotoSelectionLearning([
      {
        payload: {
          before: ["laundry-a", "kitchen-a", "office-a"],
          after: ["kitchen-a", "office-a", "laundry-a"],
          kept: [
            { id: "laundry-a", room_type: "laundry", operator_feedback: { category: "necessary_coverage" } },
            { id: "kitchen-a", room_type: "kitchen", operator_feedback: { category: "primary_room" } },
            { id: "office-a", room_type: "office", operator_feedback: { category: "feature_room" } },
          ],
        },
      },
    ]);

    expect(learning.room_type_adjustments.kitchen).toBeGreaterThan(0);
    expect(learning.room_type_adjustments.office).toBeGreaterThan(0);
    expect(learning.room_type_adjustments.laundry).toBeLessThan(0);
  });

  it("uses static and learned value adjustments so high-scoring laundry loses fill slots", () => {
    const results = [
      candidate("ef", "exterior_front", 8.4),
      candidate("k", "kitchen", 8.2),
      candidate("lr", "living_room", 8.1),
      candidate("mb", "master_bedroom", 8.0),
      candidate("ba", "bathroom", 7.9),
      candidate("office", "office", 8.0),
      candidate("dining", "dining", 7.9),
      candidate("deck", "deck", 7.8),
      candidate("pool", "pool", 7.7),
      candidate("media", "media_room", 7.6),
      candidate("foyer", "foyer", 7.5),
      candidate("gym", "gym", 7.4),
      candidate("laundry", "laundry", 9.8),
    ];
    const learning = buildPhotoSelectionLearning([
      { payload: { removed: [{ room_type: "laundry", operator_feedback: { category: "low_value_room" } }] } },
    ]);

    const { selected, verdicts } = selectPhotosWithExplanation(results, { learning });

    expect(selected.map((s) => s.id)).not.toContain("laundry");
    expect(verdicts.get("laundry")?.status).toBe("not_selected");
    expect(verdicts.get("laundry")?.reason).toMatch(/selection learning|low-value/i);
  });
});
