import { describe, it, expect } from "vitest";
import { fitScenesToDuration, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from "./duration-fit.js";
import type { RoomType } from "../types.js";

interface TestScene {
  scene_number: number;
  room_type: RoomType | null;
  durationSeconds: number;
  id: string;
}

const s = (
  scene_number: number,
  room_type: RoomType | null,
  durationSeconds: number,
  id: string,
): TestScene => ({ scene_number, room_type, durationSeconds, id });

const TWELVE_SCENE_LISTING: TestScene[] = [
  s(1, "aerial", 5, "drone"),
  s(2, "exterior_front", 5, "frontExt"),
  s(3, "foyer", 5, "entry"),
  s(4, "living_room", 5, "lr"),
  s(5, "dining", 5, "din"),
  s(6, "kitchen", 5, "kit"),
  s(7, "master_bedroom", 5, "master"),
  s(8, "bedroom", 5, "bd2"),
  s(9, "bathroom", 5, "ba1"),
  s(10, "pool", 5, "pool"),
  s(11, "deck", 5, "deck"),
  s(12, "exterior_back", 5, "backExt"),
];

describe("fitScenesToDuration", () => {
  it("returns empty for empty input", () => {
    expect(fitScenesToDuration([], 60)).toEqual([]);
  });

  it("returns scenes as-is when targetSeconds is null (legacy)", () => {
    const out = fitScenesToDuration(TWELVE_SCENE_LISTING, null);
    expect(out).toHaveLength(12);
    expect(out.every((f) => f.durationSeconds === 5)).toBe(true);
  });

  it("60s target × 12 scenes × 5s natural — no fitting needed", () => {
    const out = fitScenesToDuration(TWELVE_SCENE_LISTING, 60);
    expect(out).toHaveLength(12);
    const total = out.reduce((acc, f) => acc + f.durationSeconds, 0);
    expect(total).toBe(60);
    // Walkthrough order preserved
    expect(out.map((f) => f.scene.id)).toEqual([
      "drone", "frontExt", "entry", "lr", "din", "kit",
      "master", "bd2", "ba1", "pool", "deck", "backExt",
    ]);
  });

  it("30s target × 12 scenes × 5s — trims clip durations, keeps all", () => {
    const out = fitScenesToDuration(TWELVE_SCENE_LISTING, 30);
    // 30 / 12 = 2.5s per clip — exactly MIN. All 12 should survive.
    expect(out).toHaveLength(12);
    const total = out.reduce((acc, f) => acc + f.durationSeconds, 0);
    expect(total).toBeCloseTo(30, 1);
    expect(out.every((f) => f.durationSeconds >= MIN_CLIP_SECONDS)).toBe(true);
  });

  it("15s target × 12 scenes × 5s — drops T3+ scenes, keeps T1 + T2", () => {
    const out = fitScenesToDuration(TWELVE_SCENE_LISTING, 15);
    // 15 / MIN(2.5) = 6 scenes max
    expect(out).toHaveLength(6);
    const ids = out.map((f) => f.scene.id);
    // T1 scenes must be present: drone, frontExt, lr, kit, master, backExt
    expect(ids).toContain("drone");
    expect(ids).toContain("frontExt");
    expect(ids).toContain("lr");
    expect(ids).toContain("kit");
    expect(ids).toContain("master");
    expect(ids).toContain("backExt");
    // T3 (foyer) and the lower T2s should be dropped
    expect(ids).not.toContain("entry");
    // Even allocation = 15/6 = 2.5s
    expect(out.every((f) => f.durationSeconds === 2.5)).toBe(true);
  });

  it("preserves walkthrough order after dropping", () => {
    const out = fitScenesToDuration(TWELVE_SCENE_LISTING, 15);
    const ids = out.map((f) => f.scene.id);
    // Whatever survives, the order should follow original walkthrough
    const originalOrder = TWELVE_SCENE_LISTING.map((x) => x.id);
    let lastIdx = -1;
    for (const id of ids) {
      const idx = originalOrder.indexOf(id);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("caps allocation per clip at MAX_CLIP_SECONDS", () => {
    // 60s target, only 4 scenes -> 15s/scene if uncapped. Should cap at 5.
    const fewScenes = TWELVE_SCENE_LISTING.slice(0, 4);
    const out = fitScenesToDuration(fewScenes, 60);
    expect(out).toHaveLength(4);
    expect(out.every((f) => f.durationSeconds <= MAX_CLIP_SECONDS)).toBe(true);
  });

  it("caps allocation at source clip duration", () => {
    // Short source clips — can't stretch them past actual generated length.
    const shortClips = TWELVE_SCENE_LISTING.map((x) => ({ ...x, durationSeconds: 3 }));
    const out = fitScenesToDuration(shortClips, 60);
    expect(out.every((f) => f.durationSeconds <= 3)).toBe(true);
  });

  it("drops uncategorized first, then T3, then T2", () => {
    // Build a mix where the lowest-priority scenes are at the END of order.
    const mixed: TestScene[] = [
      s(1, "aerial", 5, "t1a"),         // T1
      s(2, "kitchen", 5, "t1b"),        // T1
      s(3, "bedroom", 5, "t2"),         // T2
      s(4, "foyer", 5, "t3"),           // T3
      s(5, "other", 5, "t4"),           // T4
    ];
    // Force aggressive truncation (5s tight budget).
    const out = fitScenesToDuration(mixed, 5);
    // 5 / 2.5 = 2 max scenes. Must be the two T1s.
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.scene.id).sort()).toEqual(["t1a", "t1b"]);
  });

  it("does not mutate input", () => {
    const snapshot = JSON.stringify(TWELVE_SCENE_LISTING);
    fitScenesToDuration(TWELVE_SCENE_LISTING, 15);
    expect(JSON.stringify(TWELVE_SCENE_LISTING)).toBe(snapshot);
  });
});
