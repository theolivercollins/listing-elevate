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
  it("opener extraction + covered-path traversal: the exterior_front room becomes its own opener segment, ahead of the forward-only interior chain", () => {
    const g = graph(
      [room("ext", "Front Exterior", "exterior_front"), room("living", "Living Room"), room("kitchen", "Kitchen")],
      [edge("ext", "living", 0.9), edge("living", "kitchen", 0.75)],
    );

    const plan = planRoute(g);

    // The exterior_front room is always its own opening segment (fix 3) —
    // never chained with the interior rooms even though an edge exists.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([["ext"], ["living", "kitchen"]]);
    expect(plan.transitions).toEqual([{ afterSegmentIndex: 0, type: "crossfade" }]);
    // Stable skeleton first, variable manifest/path last (cache-friendly ordering).
    expect(plan.segments[0].prompt.startsWith(WALKTHROUGH_SKELETON_PROMPT)).toBe(true);
    expect(plan.segments[0].prompt).toContain("Front Exterior");
    expect(plan.segments[1].prompt).toContain("Kitchen");
    expect(plan.segments[1].prompt).toContain("doorway");
    // Opener: 1 space -> 4s (MIN_SEGMENT_DURATION_SEC floor). Interior chain: 2 spaces * 3.5s/space = 7s.
    expect(plan.segments[0].durationSec).toBe(4);
    expect(plan.segments[1].durationSec).toBe(7);
  });

  it("dead-end handling: a room with no onward covered edge becomes its own trailing segment", () => {
    const g = graph(
      [
        room("ext", "Front Exterior", "exterior_front"),
        room("office", "Office"), // most-interior leaf -> wins the chain start (score 0, degree 1)
        room("living", "Living Room"), // interior hub (score 0, degree 3)
        room("kitchen", "Kitchen"), // true dead end — reached only via backtrack, after the pool branch
        room("lanai", "Lanai"),
        room("pool", "Pool"),
      ],
      [
        edge("ext", "office", 0.95), // ignored for chaining — ext is always its own opener, edges or not
        edge("office", "living", 0.9),
        edge("living", "kitchen", 0.65), // dead end — kitchen has no onward covered edge
        edge("living", "lanai", 0.85),
        edge("lanai", "pool", 0.9),
      ],
    );

    const plan = planRoute(g);

    // ext opens on its own; office (the lowest-degree interior room) starts
    // the chain; forward-only DFS (highest-confidence neighbor first) fills
    // the 4-space cap with office->living->lanai->pool before the kitchen
    // branch is ever reached, so kitchen — the true dead end — lands in its
    // own trailing segment exactly as the design intends.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext"],
      ["office", "living", "lanai", "pool"],
      ["kitchen"],
    ]);
    expect(plan.transitions).toEqual([
      { afterSegmentIndex: 0, type: "crossfade" },
      { afterSegmentIndex: 1, type: "crossfade" },
    ]);
    // Single-room segments hold rather than attempt an impossible transition.
    expect(plan.segments[2].prompt).toContain("hold on Kitchen");
  });

  it("max-spaces split: a long connected interior chain splits at the configured cap, fading between chunks", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const rooms = ids.map((id, i) => (i === 0 ? room(id, "A", "exterior_front") : room(id, id.toUpperCase())));
    const edges: SpatialGraphEdge[] = [];
    for (let i = 0; i < ids.length - 1; i++) edges.push(edge(ids[i], ids[i + 1], 0.9));
    const g = graph(rooms, edges);

    const plan = planRoute(g, { maxSpacesPerSegment: 3 });

    // "a" is the exterior_front opener, extracted from the chain; the
    // remaining b..f interior chain splits at the 3-space cap.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["a"],
      ["b", "c", "d"],
      ["e", "f"],
    ]);
    expect(plan.transitions).toEqual([
      { afterSegmentIndex: 0, type: "crossfade" },
      { afterSegmentIndex: 1, type: "crossfade" },
    ]);
  });

  it("hero-shot ending: a mid-chain heroShot is pulled out into its own dedicated closing segment", () => {
    const ids = ["a", "b", "c", "d"];
    const rooms = ids.map((id, i) => (i === 0 ? room(id, "A", "exterior_front") : room(id, id.toUpperCase())));
    const edges: SpatialGraphEdge[] = [];
    for (let i = 0; i < ids.length - 1; i++) edges.push(edge(ids[i], ids[i + 1], 0.9));
    const g = graph(rooms, edges, "b"); // hero shot is a mid-chain room

    const plan = planRoute(g);

    // "a" opens; "b" (the lowest-degree interior room, a leaf off the b-c-d
    // chain once "a" is extracted) starts the chain but is immediately
    // pulled back out into its own dedicated closing segment (fix 3d) since
    // it's the hero shot.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([["a"], ["c", "d"], ["b"]]);
    const allIds = plan.segments.flatMap((s) => s.photoIds);
    // heroShot appears exactly once across the whole plan — moved, not duplicated.
    expect(allIds.filter((id) => id === "b")).toHaveLength(1);
    expect(plan.segments[plan.segments.length - 1].photoIds).toEqual(["b"]);
    expect(plan.segments[plan.segments.length - 1].durationSec).toBe(4);
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

  it("real dry-run reproduction (property a30212b2): dedups duplicate exterior/pool photos, orients the chain interior->outdoor, and closes on the aerial hero shot", () => {
    // Verbatim shape of the 2026-07-02 dry run: 10 photos including two
    // exterior_front and two pool duplicates, an aerial hero shot, and the
    // 5 edges Gemini actually reported. Bad output before the fix: [FrontExt]
    // [Pool->Lanai->Living->Kitchen] [BackExt->Waterfront] [FrontExt AGAIN]
    // [Pool->Aerial]. Ideal output: [FrontExt] [Kitchen->Living->Lanai->Pool]
    // [BackExt->Waterfront] [Aerial], crossfades throughout.
    const g = graph(
      [
        room("ext1", "Front Exterior A", "exterior_front"),
        room("ext2", "Front Exterior B", "exterior_front"), // duplicate — same room, drops entirely
        room("pool1", "Pool A", "pool"), // has edge evidence -> wins as the pool's representative photo
        room("pool2", "Pool B", "pool"), // duplicate, no edges -> drops entirely
        room("aerial", "Aerial", "aerial"),
        room("lanai", "Lanai", "lanai"),
        room("backext", "Back Exterior", "back_exterior"),
        room("waterfront", "Waterfront", "waterfront"),
        room("living", "Living Room", "living_room"),
        room("kitchen", "Kitchen", "kitchen"),
      ],
      [
        edge("living", "lanai", 1.0, "doorway"),
        edge("lanai", "pool1", 1.0, "opening"),
        edge("living", "kitchen", 0.9, "opening"),
        edge("backext", "waterfront", 0.9, "sightline"),
        edge("pool1", "backext", 0.8, "doorway"),
      ],
      "aerial",
    );

    const plan = planRoute(g);

    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext1"], // opener — first-listed duplicate wins (no edge evidence to break the tie)
      ["kitchen", "living", "lanai", "pool1"], // interior->outdoor chain, most-covered first
      ["backext", "waterfront"], // remaining, purely-outdoor chain
      ["aerial"], // hero closer, always last
    ]);
    expect(plan.transitions).toEqual([
      { afterSegmentIndex: 0, type: "crossfade" },
      { afterSegmentIndex: 1, type: "crossfade" },
      { afterSegmentIndex: 2, type: "crossfade" },
    ]);
    expect(plan.segments.map((s) => s.durationSec)).toEqual([4, 14, 7, 4]);

    // Every ROOM appears at most once across the whole plan — no duplicate
    // exterior/pool beats, and the dropped duplicates (ext2, pool2) never
    // appear anywhere.
    const allIds = plan.segments.flatMap((s) => s.photoIds);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).not.toContain("ext2");
    expect(allIds).not.toContain("pool2");
  });
});
