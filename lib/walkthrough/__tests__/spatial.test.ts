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
    // NB: this room used to be named/typed "Office" — renamed to "Family
    // Room" 2026-07-02 so it stays a plain public-interior room and doesn't
    // collide with the new isPrivateRoomType(/office/) exclusion (see the
    // dedicated "private rooms" tests below for that behavior); the DFS
    // start-pick/dead-end topology this test validates is unchanged.
    const g = graph(
      [
        room("ext", "Front Exterior", "exterior_front"),
        room("family", "Family Room"), // most-interior leaf -> wins the chain start (score 0, degree 1)
        room("living", "Living Room"), // interior hub (score 0, degree 3)
        room("kitchen", "Kitchen"), // true dead end — reached only via backtrack, after the pool branch
        room("lanai", "Lanai"),
        room("pool", "Pool"),
      ],
      [
        edge("ext", "family", 0.95), // ignored for chaining — ext is always its own opener, edges or not
        edge("family", "living", 0.9),
        edge("living", "kitchen", 0.65), // dead end — kitchen has no onward covered edge
        edge("living", "lanai", 0.85),
        edge("lanai", "pool", 0.9),
      ],
    );

    const plan = planRoute(g);

    // ext opens on its own; family room (the lowest-degree interior room)
    // starts the chain; forward-only DFS (highest-confidence neighbor
    // first) fills the 4-space cap with family->living->lanai->pool before
    // the kitchen branch is ever reached, so kitchen — the true dead end —
    // lands in its own trailing segment exactly as the design intends.
    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext"],
      ["family", "living", "lanai", "pool"],
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

  it("entry-first chain start: a foyer/entry room always starts the first interior chain, even when it isn't the lowest-degree room", () => {
    // Without the entry-first override, the OLD start-pick tiebreak (lowest
    // orientationScore, then lowest degree) would hand the start to whatever
    // interior leaf has fewer edges than the foyer — here that's any of
    // living/kitchen/dining (degree 1 each) over the foyer hub (degree 3).
    // The override must win regardless of degree.
    const g = graph(
      [
        room("ext", "Front Exterior", "exterior_front"),
        room("foyer", "Foyer"), // entry room, degree 3 (a hub, NOT a leaf)
        room("living", "Living Room"), // degree 1
        room("kitchen", "Kitchen"), // degree 1
        room("dining", "Dining Room"), // degree 1
      ],
      [
        edge("foyer", "living", 0.9),
        edge("foyer", "kitchen", 0.9),
        edge("foyer", "dining", 0.9),
      ],
    );

    const plan = planRoute(g);

    // foyer opens the (only) interior chain, immediately followed by its
    // highest-confidence neighbor; because none of living/kitchen/dining
    // connect directly to each other, each subsequent one starts a new
    // segment on the DFS backtrack — but foyer itself is never orphaned into
    // its own trailing segment, and never appears anywhere but the head of
    // the very first interior segment.
    expect(plan.segments[0].photoIds).toEqual(["ext"]);
    expect(plan.segments[1].photoIds[0]).toBe("foyer");
    const allIds = plan.segments.flatMap((s) => s.photoIds);
    expect(allIds.filter((id) => id === "foyer")).toHaveLength(1);
  });

  it("private-rooms-only exception: when every non-opener/non-aerial room is private, they stay in the main chain instead of forming separate suite segments", () => {
    // bedroom<->bathroom<->closet is a linear 3-room private chain with NO
    // public interior room anywhere in the graph — excluding them per the
    // usual private-room rule would leave nothing to walk at all, so the
    // exception keeps them in the MAIN chain (4-space cap) instead of the
    // suite path (2-space cap). If the exception were missing, this would
    // instead split into two capped-at-2 suite segments.
    const g = graph(
      [
        room("ext", "Front Exterior", "exterior_front"),
        room("bedroom", "Bedroom"),
        room("bathroom", "Bathroom"),
        room("closet", "Closet"),
      ],
      [edge("bedroom", "bathroom", 0.9), edge("bathroom", "closet", 0.9)],
    );

    const plan = planRoute(g);

    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext"],
      ["bedroom", "bathroom", "closet"], // stayed together — the 4-space main-chain cap, not the 2-space suite cap
    ]);
    expect(plan.transitions).toEqual([{ afterSegmentIndex: 0, type: "crossfade" }]);
  });

  it("real dry-run reproduction (property 1c2e7ae6, full MLS set): entry-first chain start + private rooms pulled into trailing suite segments", () => {
    // Verbatim shape of the 2026-07-02 follow-up dry run: foyer, living,
    // 5-photo kitchen duplicate group, a pool-type "Covered Lanai" node, a
    // primary bedroom, a 4-photo bathroom duplicate group (one connected
    // pair — vanity->shower — plus two evidence-free extras), a 3-photo
    // exterior_front duplicate group, and a 3-photo aerial group with the
    // rear aerial as hero. BAD plan before this fix: [FrontExt]
    // [Kitchen->Living->Lanai->PrimaryBedroom] [Foyer] [Bathroom] [Aerial
    // hero] — foyer orphaned AFTER the interior walk, and the chain ends by
    // walking the camera INTO a bedroom.
    const g = graph(
      [
        room("foyer", "Foyer"),
        room("living", "Living Room", "living_room"),
        room("kitchen1", "Kitchen 1", "kitchen"),
        room("kitchen2", "Kitchen 2", "kitchen"),
        room("kitchen3", "Kitchen 3", "kitchen"), // has the only edge evidence -> wins as kitchen's representative
        room("kitchen4", "Kitchen 4", "kitchen"),
        room("kitchen5", "Kitchen 5", "kitchen"),
        room("lanai", "Covered Lanai", "lanai"),
        room("bedroom1", "Primary Bedroom", "primary_bedroom"),
        room("bath_vanity", "Bathroom - Vanity", "bathroom"),
        room("bath_shower", "Bathroom - Shower", "bathroom"), // connected to bath_vanity below -> kept as a pair
        room("bath_extra1", "Bathroom - Extra 1", "bathroom"), // duplicate, no edges -> drops onto bath_vanity
        room("bath_extra2", "Bathroom - Extra 2", "bathroom"), // duplicate, no edges -> drops onto bath_vanity
        room("ext1", "Front Exterior A", "exterior_front"),
        room("ext2", "Front Exterior B", "exterior_front"), // duplicate — drops entirely
        room("ext3", "Front Exterior C", "exterior_front"), // duplicate — drops entirely
        room("aerial1", "Rear Aerial", "aerial"), // hero
        room("aerial2", "Side Aerial", "aerial"), // duplicate — drops entirely
        room("aerial3", "Front Aerial", "aerial"), // duplicate — drops entirely
      ],
      [
        edge("living", "kitchen3", 0.95, "opening"),
        edge("living", "lanai", 0.95, "doorway"),
        edge("bedroom1", "lanai", 0.95, "doorway"),
        edge("foyer", "living", 0.9, "opening"),
        edge("bath_vanity", "bath_shower", 0.9, "opening"),
        edge("living", "bedroom1", 0.8, "doorway"),
      ],
      "aerial1",
    );

    const plan = planRoute(g);

    expect(plan.segments.map((s) => s.photoIds)).toEqual([
      ["ext1"], // opener — first-listed exterior_front duplicate wins
      ["foyer", "living", "kitchen3"], // entry-first main chain — starts at foyer, ends at the kitchen leaf
      ["lanai"], // living's other covered edge, its own beat once living is already used
      ["bedroom1"], // private suite beat 1 — never mid-chain or a chain-terminal of the main walk
      ["bath_vanity", "bath_shower"], // private suite beat 2 — the vanity->shower micro-walk
      ["aerial1"], // hero closer, always last
    ]);
    expect(plan.transitions).toEqual([
      { afterSegmentIndex: 0, type: "crossfade" },
      { afterSegmentIndex: 1, type: "crossfade" },
      { afterSegmentIndex: 2, type: "crossfade" },
      { afterSegmentIndex: 3, type: "crossfade" },
      { afterSegmentIndex: 4, type: "crossfade" },
    ]);

    // Minimum bar from the dry-run repro, asserted explicitly:
    const [opener, mainChain, lanaiBeat, bedroomBeat, bathroomBeat, hero] = plan.segments;
    expect(mainChain.photoIds[0]).toBe("foyer"); // foyer starts the first interior chain
    expect(mainChain.photoIds[mainChain.photoIds.length - 1]).toBe("kitchen3"); // kitchen ends it
    // no bedroom/bathroom inside the main chain (opener + entry chain + outdoor beat):
    for (const seg of [opener, mainChain, lanaiBeat]) {
      expect(seg.photoIds).not.toContain("bedroom1");
      expect(seg.photoIds.some((id) => id.startsWith("bath_"))).toBe(false);
    }
    // foyer never orphaned after the interior segments — it appears exactly
    // once, at the head of the main chain, not as a later standalone segment:
    const allIds = plan.segments.flatMap((s) => s.photoIds);
    expect(allIds.filter((id) => id === "foyer")).toHaveLength(1);
    expect(bedroomBeat.photoIds).toEqual(["bedroom1"]);
    expect(bathroomBeat.photoIds).toEqual(["bath_vanity", "bath_shower"]);
    // hero last:
    expect(hero.photoIds).toEqual(["aerial1"]);
    expect(plan.segments[plan.segments.length - 1]).toBe(hero);
    // dropped duplicates never appear anywhere:
    expect(allIds).not.toContain("ext2");
    expect(allIds).not.toContain("ext3");
    expect(allIds).not.toContain("kitchen1");
    expect(allIds).not.toContain("bath_extra1");
    expect(allIds).not.toContain("aerial2");
  });
});
