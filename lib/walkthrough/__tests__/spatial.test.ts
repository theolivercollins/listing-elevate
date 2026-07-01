// TDD tests for planRoute — the pure, deterministic half of the cinematic
// walkthrough v2 engine (lib/walkthrough/spatial.ts). analyzeSpatialGraph
// (the paid Gemini vision call) is intentionally NOT unit tested here —
// it's exercised by scripts/probe-walkthrough-cinematic.ts against a real
// listing, matching the project's convention of not mocking paid vision
// calls in CI (see lib/providers/gemini-analyzer.test.ts, which only tests
// the pure gateVerticalHeadroom() half of that sibling module).
//
// Mock graphs only — no network, no model calls.

import { describe, it, expect } from "vitest";
import { planRoute, WALKTHROUGH_SKELETON_PROMPT } from "../spatial.js";
import type { SpatialGraph, SpatialGraphEdge, SpatialGraphNode } from "../spatial.js";

function room(photoId: string, label: string, roomType = label.toLowerCase().replace(/\s+/g, "_")): SpatialGraphNode {
  return { photoId, roomType, label };
}

function edge(
  from: string,
  to: string,
  confidence: number,
  type: SpatialGraphEdge["type"] = "doorway",
  description = `${from}->${to} evidence`,
): SpatialGraphEdge {
  return { from, to, evidencePhotoId: from, type, confidence, description };
}

function graph(rooms: SpatialGraphNode[], edges: SpatialGraphEdge[], heroShot: string | null = null): SpatialGraph {
  return { rooms, edges, heroShot };
}

describe("planRoute", () => {
  it("covered-path traversal: walks a linear chain forward-only along evidenced doorways", () => {
    const g = graph(
      [room("ext", "Front Exterior", "exterior_front"), room("living", "Living Room"), room("kitchen", "Kitchen")],
      [edge("ext", "living", 0.9), edge("living", "kitchen", 0.75)],
    );

    const plan = planRoute(g);

    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].photoIds).toEqual(["ext", "living", "kitchen"]);
    expect(plan.transitions).toEqual([]);
    // Stable skeleton first, variable manifest/path last (cache-friendly ordering).
    expect(plan.segments[0].prompt.startsWith(WALKTHROUGH_SKELETON_PROMPT)).toBe(true);
    expect(plan.segments[0].prompt).toContain("Front Exterior");
    expect(plan.segments[0].prompt).toContain("Kitchen");
    expect(plan.segments[0].prompt).toContain("doorway");
    // 3 spaces * 3.5s/space = 10.5 -> rounds to 11.
    expect(plan.segments[0].durationSec).toBe(11);
  });

  it("dead-end handling: a room with no onward covered edge becomes its own trailing segment", () => {
    const g = graph(
      [
        room("ext", "Front Exterior", "exterior_front"),
        room("living", "Living Room"),
        room("kitchen", "Kitchen"),
        room("lanai", "Lanai"),
        room("pool", "Pool"),
      ],
      [
        edge("ext", "living", 0.9),
        edge("living", "kitchen", 0.65), // dead end — kitchen has no onward covered edge
        edge("living", "lanai", 0.85),
        edge("lanai", "pool", 0.9),
      ],
    );

    const plan = planRoute(g);

    // Forward-only DFS (highest-confidence neighbor first) fills a 4-space
    // segment with ext->living->lanai->pool before the kitchen branch is
    // ever reached, so kitchen — the true dead end — lands in its own
    // trailing segment exactly as the design intends.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext", "living", "lanai", "pool"],
      ["kitchen"],
    ]);
    expect(plan.transitions).toEqual([{ afterSegmentIndex: 0, type: "crossfade" }]);
    // Single-room segments hold rather than attempt an impossible transition.
    expect(plan.segments[1].prompt).toContain("hold on Kitchen");
  });

  it("max-spaces split: a long connected chain splits at the configured cap, fading between chunks", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const rooms = ids.map((id, i) => (i === 0 ? room(id, "A", "exterior_front") : room(id, id.toUpperCase())));
    const edges: SpatialGraphEdge[] = [];
    for (let i = 0; i < ids.length - 1; i++) edges.push(edge(ids[i], ids[i + 1], 0.9));
    const g = graph(rooms, edges);

    const plan = planRoute(g, { maxSpacesPerSegment: 3 });

    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect(plan.transitions).toEqual([{ afterSegmentIndex: 0, type: "crossfade" }]);
  });

  it("hero-shot ending: reorders the reachable heroShot to the end of the final segment", () => {
    const ids = ["a", "b", "c", "d"];
    const rooms = ids.map((id, i) => (i === 0 ? room(id, "A", "exterior_front") : room(id, id.toUpperCase())));
    const edges: SpatialGraphEdge[] = [];
    for (let i = 0; i < ids.length - 1; i++) edges.push(edge(ids[i], ids[i + 1], 0.9));
    const g = graph(rooms, edges, "b"); // hero shot is a mid-chain room

    const plan = planRoute(g);

    expect(plan.segments).toHaveLength(1);
    const photoIds = plan.segments[0].photoIds;
    expect(photoIds[photoIds.length - 1]).toBe("b");
    expect(photoIds).toEqual(["a", "c", "d", "b"]);
    // heroShot appears exactly once — moved, not duplicated.
    expect(photoIds.filter((id) => id === "b")).toHaveLength(1);
  });

  it("no-edges fallback: with zero usable edges, every room is its own segment and every join is a fade", () => {
    const g = graph(
      [room("r1", "Room One", "exterior_front"), room("r2", "Room Two"), room("r3", "Room Three")],
      [],
    );

    const plan = planRoute(g);

    expect(plan.segments.map((s) => s.photoIds)).toEqual([["r1"], ["r2"], ["r3"]]);
    expect(plan.transitions).toEqual([
      { afterSegmentIndex: 0, type: "crossfade" },
      { afterSegmentIndex: 1, type: "crossfade" },
    ]);
  });

  it("below-confidence edges are treated as no usable connection (0.6 threshold enforced in code)", () => {
    const g = graph(
      [room("r1", "Room One", "exterior_front"), room("r2", "Room Two")],
      [edge("r1", "r2", 0.5)], // below MIN_EDGE_CONFIDENCE — must not be walked
    );

    const plan = planRoute(g);

    expect(plan.segments.map((s) => s.photoIds)).toEqual([["r1"], ["r2"]]);
    expect(plan.transitions).toEqual([{ afterSegmentIndex: 0, type: "crossfade" }]);
  });

  it("returns an empty plan for an empty graph", () => {
    const plan = planRoute(graph([], []));
    expect(plan.segments).toEqual([]);
    expect(plan.transitions).toEqual([]);
  });
});
