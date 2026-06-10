import { describe, it, expect } from "vitest";
import { orderScenesForAssembly, slotForRoomType } from "./scene-ordering.js";
import type { RoomType } from "../types.js";

interface TestScene {
  scene_number: number;
  room_type: RoomType | null;
  id: string;
}

const scene = (scene_number: number, room_type: RoomType | null, id: string): TestScene => ({
  scene_number,
  room_type,
  id,
});

describe("orderScenesForAssembly", () => {
  it("returns empty for empty input", () => {
    expect(orderScenesForAssembly([])).toEqual([]);
  });

  it("preserves all scenes (no data loss)", () => {
    const scenes = [
      scene(1, "kitchen", "k1"),
      scene(2, "bedroom", "b1"),
      scene(3, "exterior_front", "ef1"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((s) => s.id))).toEqual(new Set(["k1", "b1", "ef1"]));
  });

  it("puts aerial + exterior_front first", () => {
    const scenes = [
      scene(1, "kitchen", "k1"),
      scene(2, "exterior_front", "ef1"),
      scene(3, "aerial", "a1"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out[0].id).toBe("a1");
    expect(out[1].id).toBe("ef1");
    expect(out[2].id).toBe("k1");
  });

  it("walks living → dining → kitchen → bedrooms → bathrooms", () => {
    const scenes = [
      scene(1, "bathroom", "ba1"),
      scene(2, "bedroom", "b1"),
      scene(3, "kitchen", "k1"),
      scene(4, "living_room", "lr1"),
      scene(5, "dining", "d1"),
      scene(6, "master_bedroom", "mb1"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out.map((s) => s.id)).toEqual(["lr1", "d1", "k1", "mb1", "b1", "ba1"]);
  });

  it("closes with exterior_back", () => {
    const scenes = [
      scene(1, "exterior_back", "eb1"),
      scene(2, "kitchen", "k1"),
      scene(3, "exterior_front", "ef1"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out.map((s) => s.id)).toEqual(["ef1", "k1", "eb1"]);
  });

  it("groups multiple scenes per room_type, preserving director order", () => {
    const scenes = [
      scene(5, "bedroom", "b3"), // director put this third
      scene(1, "bedroom", "b1"),
      scene(3, "bedroom", "b2"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out.map((s) => s.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("places 'other' and null room_type at the end", () => {
    const scenes = [
      scene(1, "other", "o1"),
      scene(2, null, "n1"),
      scene(3, "kitchen", "k1"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out[0].id).toBe("k1");
    expect(new Set([out[1].id, out[2].id])).toEqual(new Set(["o1", "n1"]));
  });

  it("handles the typical 12-scene listing flow", () => {
    const scenes: TestScene[] = [
      scene(1, "aerial", "drone1"),
      scene(2, "exterior_front", "frontExt"),
      scene(3, "foyer", "entry"),
      scene(4, "living_room", "lr"),
      scene(5, "dining", "din"),
      scene(6, "kitchen", "kit"),
      scene(7, "master_bedroom", "masterBd"),
      scene(8, "bedroom", "bd2"),
      scene(9, "bathroom", "ba1"),
      scene(10, "pool", "pool"),
      scene(11, "deck", "deck"),
      scene(12, "exterior_back", "backExt"),
    ];
    // Shuffle to simulate director's arbitrary order
    const shuffled = [...scenes].reverse();
    const out = orderScenesForAssembly(shuffled);
    expect(out.map((s) => s.id)).toEqual([
      "drone1", "frontExt", "entry",
      "lr", "din", "kit",
      "masterBd", "bd2",
      "ba1",
      "deck", "pool",
      "backExt",
    ]);
  });

  it("slots lanai in the outdoor sequence (after deck, before pool) — not uncategorized", () => {
    const scenes = [
      scene(1, "exterior_back", "back"),
      scene(2, "pool", "pool"),
      scene(3, "lanai", "lanai"),
      scene(4, "deck", "deck"),
      scene(5, "kitchen", "kit"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out.map((s) => s.id)).toEqual(["kit", "deck", "lanai", "pool", "back"]);
  });

  it("reproduces the 2026-06-10 prod run with lanai correctly placed mid-walkthrough", () => {
    // Real failure data: aerial, exterior_front, living_room, pool,
    // exterior_back, exterior_back, lanai — lanai had been dumped at the end
    // because it wasn't a slotted room_type. With lanai slotted, it lands in
    // the outdoor group before pool instead of trailing the video.
    const scenes = [
      scene(1, "aerial", "s1"),
      scene(2, "exterior_front", "s2"),
      scene(3, "living_room", "s3"),
      scene(5, "pool", "s5"),
      scene(6, "exterior_back", "s6"),
      scene(7, "exterior_back", "s7"),
      scene(4, "lanai", "s4"),
    ];
    const out = orderScenesForAssembly(scenes);
    expect(out.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
    // lanai is no longer last.
    expect(out[out.length - 1].room_type).toBe("exterior_back");
  });

  it("does not mutate input", () => {
    const scenes = [scene(1, "kitchen", "k1"), scene(2, "aerial", "a1")];
    const snapshot = JSON.stringify(scenes);
    orderScenesForAssembly(scenes);
    expect(JSON.stringify(scenes)).toBe(snapshot);
  });
});

describe("slotForRoomType", () => {
  it("returns the room_type itself for slotted types", () => {
    expect(slotForRoomType("kitchen")).toBe("kitchen");
    expect(slotForRoomType("master_bedroom")).toBe("master_bedroom");
    expect(slotForRoomType("lanai")).toBe("lanai");
  });

  it("returns '_uncategorized' for null, 'other'", () => {
    expect(slotForRoomType(null)).toBe("_uncategorized");
    expect(slotForRoomType("other")).toBe("_uncategorized");
  });
});
