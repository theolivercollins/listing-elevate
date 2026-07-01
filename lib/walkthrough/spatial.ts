/**
 * lib/walkthrough/spatial.ts
 *
 * Cinematic walkthrough v2 engine — spatial analysis + deterministic route
 * planning. Built 2026-07-02 after 3 paid Seedance 2.0 reference-to-video
 * test cycles (v1/v2/v3, see docs/HANDOFF.md 2026-07-01/02 entries) proved a
 * hard law: THE MODEL IS FAITHFUL EXACTLY WHERE A REFERENCE PHOTO COVERS THE
 * CAMERA'S VIEW, AND FABRICATES EVERYWHERE ELSE — invented doorways, wrong
 * furniture, wrong house numbers, and warped geometry on unphotographed
 * reveals, all traced to the same root cause. See lib/walkthrough/generate.ts
 * for the full 4-defect-class writeup.
 *
 * Oliver's fix (2026-07-02): "look at all the photos together first, build a
 * connectivity map of the home, then apply a hard rule: if a doorway is
 * visibly covered, walk through it; if not, fade." This module is that
 * engine, split into two independently-testable halves:
 *
 *   - analyzeSpatialGraph(): ONE multimodal Gemini vision call over ALL of a
 *     property's photos at once — the "look at all the photos together"
 *     pass. Reuses the SAME GoogleGenAI client, GEMINI_API_KEY env var,
 *     primary/fallback model pair, and pricing table as the production
 *     per-photo analyzer (lib/providers/gemini-analyzer.ts) — see that
 *     file's PRIMARY_MODEL/FALLBACK_MODEL/computeGeminiCost exports. This is
 *     a genuinely different call shape (N images + N labels in one request,
 *     not one image), so it is a sibling function here rather than a branch
 *     inside analyzePhotoWithGemini — but it deliberately does NOT hand-roll
 *     a second HTTP client.
 *
 *   - planRoute(): PURE deterministic code, no model call. Walks the graph
 *     forward-only along evidenced edges, chunks it into short segments, and
 *     always crossfades between segments — the "hard rule" ladder. Because
 *     it's pure, it's the primary unit-test surface (see __tests__/spatial.
 *     test.ts); analyzeSpatialGraph is exercised by the paid probe instead
 *     (scripts/probe-walkthrough-cinematic.ts), consistent with the
 *     project's convention of not mocking paid vision calls in CI.
 *
 * Validation at the boundary (never trust the prompt): every room/edge the
 * model returns is checked against the actual input photo ids before it can
 * influence routing. Rooms/edges referencing unknown ids, self-loop edges,
 * and out-of-range confidence values are dropped or clamped in code, not
 * left to the prompt's "don't do that" instructions.
 */

import { GoogleGenAI } from "@google/genai";
import { Type } from "@google/genai";
import {
  GeminiAnalysisError,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  computeGeminiCost,
} from "../providers/gemini-analyzer.js";

// ─── Public types ───────────────────────────────────────────────────────

/** Minimal photo shape analyzeSpatialGraph needs — matches the fields on
 *  `Photo` (lib/types.ts) that actually feed the vision call, so callers can
 *  pass a full Photo row or a lighter probe-script shape interchangeably. */
export interface SpatialAnalysisPhotoInput {
  id: string;
  file_url: string;
  room_type: string | null;
}

export interface SpatialGraphNode {
  photoId: string;
  /** Model-reported room type (free text; not constrained to the RoomType
   *  union — this is a scouting pass, not the production photo-analysis
   *  pipeline, and the caller already has an authoritative room_type from
   *  Gemini's per-photo analyzer if it needs one). */
  roomType: string;
  /** Short human label, e.g. "Living Room", "Primary Bathroom". */
  label: string;
}

export type SpatialEdgeType = "doorway" | "opening" | "sightline";

export interface SpatialGraphEdge {
  from: string;
  to: string;
  /** Photo id whose frame actually shows this connection. */
  evidencePhotoId: string;
  type: SpatialEdgeType;
  /** 0-1. Only edges >= MIN_EDGE_CONFIDENCE are walkable in planRoute. */
  confidence: number;
  description: string;
}

export interface SpatialGraphUsage {
  inputTokens: number;
  outputTokens: number;
  /** Fractional cents, matching GeminiAnalysisResult's convention — round at
   *  the cost_events write site. */
  costCents: number;
  model: string;
}

export interface SpatialGraph {
  rooms: SpatialGraphNode[];
  edges: SpatialGraphEdge[];
  /** Photo id of the most cinematic closing shot (pool / waterfront /
   *  twilight exterior), or null if no photo is a clear standout. */
  heroShot: string | null;
  /** Present whenever the graph came from a real Gemini call — absent on
   *  hand-built graphs in tests. Callers that promote this into a paid
   *  production path are the ones responsible for recordCostEvent (see
   *  lib/db.ts recordCostEvent) — this module never writes cost_events
   *  itself, matching gemini-analyzer.ts's "callers own cost_events writes"
   *  convention. */
  usage?: SpatialGraphUsage;
}

// ─── System prompt ──────────────────────────────────────────────────────

const SPATIAL_ANALYSIS_SYSTEM = `You are a professional real-estate videographer scouting a home before filming a walkthrough tour. You are given EVERY listing photo for this property AT ONCE, each labeled with its photo id and a provided room_type hint. Build a connectivity map of the home.

For EACH photo, report its room: use the given photo id, and a short human label (e.g. "Living Room", "Primary Bathroom", "Front Exterior") describing what the room actually looks like — use the room_type hint but correct it if the photo clearly shows something else.

Then find EDGES: connections between two rooms that are VISIBLY PROVEN by at least one of the photos — an open doorway, an open sliding/French door, an archway, or a clear, unambiguous sightline directly from one space into the other. Hard rules:
- Only emit an edge when a SPECIFIC photo actually shows the connection. Name that photo as evidencePhotoId (it may be either endpoint's own photo, or a third photo that happens to show both).
- type: 'doorway' (a walkable door/opening the camera could physically pass through), 'opening' (an archway or wide opening, no door), or 'sightline' (you can see into the other room from this vantage point, but no photo actually shows a walkable opening — weaker connectivity, camera should NOT be routed through it).
- confidence (0-1): how certain you are, FROM THE PHOTO ALONE, that this exact connection exists. Use 0.6 or higher ONLY when the evidence is unambiguous — an open door/opening plainly visible with the destination space recognizable through it. Use LOWER confidence for anything inferred from typical home layouts rather than actually seen.
- NEVER emit an edge with no real evidencePhotoId, and NEVER emit an edge just because two room types are usually adjacent in houses (e.g. "kitchens are near living rooms") without a photo that actually proves it for THIS house.
- description: one specific sentence naming exactly what's visible (e.g. "Open sliding glass doors on the far wall of the living room lead directly onto the covered lanai, visible in both photos.").

Finally, pick heroShot: the single best CLOSING shot for a real-estate video — a pool, waterfront, dramatic twilight/golden-hour exterior, or the single most striking image of the home. Prefer exteriors. Return its photo id, or null if nothing stands out.

HARD RULE: this map decides where a camera is ALLOWED to walk in the final video. An invented edge sends the camera through a wall that isn't there. If you are not certain a photo proves a connection, leave the edge out entirely rather than guessing — omission is always safer than fabrication here.

Return ONLY the JSON object matching the provided schema — no markdown, no extra keys, no prose.`;

function buildSpatialResponseSchema() {
  return {
    type: Type.OBJECT,
    required: ["rooms", "edges", "heroShot"],
    properties: {
      rooms: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["photoId", "roomType", "label"],
          properties: {
            photoId: { type: Type.STRING },
            roomType: { type: Type.STRING },
            label: { type: Type.STRING },
          },
        },
      },
      edges: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["from", "to", "evidencePhotoId", "type", "confidence", "description"],
          properties: {
            from: { type: Type.STRING },
            to: { type: Type.STRING },
            evidencePhotoId: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["doorway", "opening", "sightline"] },
            confidence: { type: Type.NUMBER },
            description: { type: Type.STRING },
          },
        },
      },
      heroShot: { type: Type.STRING, nullable: true },
    },
  } as const;
}

interface RawSpatialGraphResponse {
  rooms?: Array<{ photoId?: unknown; roomType?: unknown; label?: unknown }>;
  edges?: Array<{
    from?: unknown;
    to?: unknown;
    evidencePhotoId?: unknown;
    type?: unknown;
    confidence?: unknown;
    description?: unknown;
  }>;
  heroShot?: unknown;
}

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

// ─── Public entrypoint ──────────────────────────────────────────────────

/**
 * ONE multimodal Gemini call over ALL the given photos at once, returning a
 * connectivity graph. Photos that fail to fetch are skipped (logged, not
 * fatal) — the call still runs over whatever fetched successfully as long
 * as at least 2 remain. Every room/edge the model returns is validated
 * against the real input photo ids before being trusted (see module
 * docblock) — this is a boundary, not a formality.
 */
export async function analyzeSpatialGraph(
  photos: SpatialAnalysisPhotoInput[],
): Promise<SpatialGraph> {
  if (photos.length < 2) {
    throw new GeminiAnalysisError(
      `analyzeSpatialGraph requires at least 2 photos, got ${photos.length}`,
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiAnalysisError("GEMINI_API_KEY is not set in the environment");
  }

  const knownIds = new Set(photos.map((p) => p.id));

  // Same inline-base64 fetch strategy as gemini-analyzer.ts: the Gemini
  // Developer API's fileData.fileUri is GCS/Files-API/YouTube only, not
  // arbitrary HTTPS (see lib/providers/gemini-files.ts docblock) — so a
  // Supabase public URL has to go in as inline bytes.
  const fetched: Array<{ id: string; mimeType: string; base64: string; roomType: string | null }> = [];
  for (const photo of photos) {
    try {
      const r = await fetch(photo.file_url);
      if (!r.ok) throw new Error(`fetch ${r.status} for ${photo.file_url}`);
      const ct = r.headers.get("content-type") ?? "image/jpeg";
      const mimeType = ct.includes("png")
        ? "image/png"
        : ct.includes("webp")
          ? "image/webp"
          : ct.includes("gif")
            ? "image/gif"
            : "image/jpeg";
      const buf = Buffer.from(await r.arrayBuffer());
      fetched.push({ id: photo.id, mimeType, base64: buf.toString("base64"), roomType: photo.room_type });
    } catch (err) {
      console.warn(
        `[spatial] failed to fetch photo ${photo.id} for spatial analysis — skipping`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (fetched.length < 2) {
    throw new GeminiAnalysisError(
      `analyzeSpatialGraph: fewer than 2 photos fetched successfully (${fetched.length}/${photos.length})`,
    );
  }

  // Interleave a small text label immediately before each image so the
  // model can ground room descriptions/edges to a specific photo id even
  // though Gemini has no first-class "caption this image" input field.
  const parts: ContentPart[] = [];
  for (const p of fetched) {
    parts.push({ text: `Photo id: ${p.id}\nProvided room_type hint: ${p.roomType ?? "unknown"}` });
    parts.push({ inlineData: { mimeType: p.mimeType, data: p.base64 } });
  }
  parts.push({
    text:
      `Analyze all ${fetched.length} photos above together, as one home. ` +
      `Photo ids, in the order shown: ${fetched.map((p) => p.id).join(", ")}. ` +
      `Return ONLY the JSON object described by the schema — no markdown, no extra keys.`,
  });

  const ai = new GoogleGenAI({ apiKey });
  const schema = buildSpatialResponseSchema();

  const callOnce = async (model: string) =>
    ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SPATIAL_ANALYSIS_SYSTEM,
        responseMimeType: "application/json",
        responseSchema: schema as never,
        temperature: 0.2,
      },
    });

  let res;
  let model = PRIMARY_MODEL;
  try {
    res = await callOnce(PRIMARY_MODEL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksLikeModelNotFound =
      /not\s*found|not\s*supported|does\s*not\s*exist|invalid.*model|404/i.test(msg);
    if (!looksLikeModelNotFound) {
      throw new GeminiAnalysisError(`Gemini spatial call failed on ${PRIMARY_MODEL}: ${msg}`, err);
    }
    console.warn(
      `[spatial] ${PRIMARY_MODEL} not addressable (${msg}); retrying on ${FALLBACK_MODEL}`,
    );
    try {
      res = await callOnce(FALLBACK_MODEL);
      model = FALLBACK_MODEL;
    } catch (err2) {
      throw new GeminiAnalysisError(
        `Gemini spatial call failed on both ${PRIMARY_MODEL} and ${FALLBACK_MODEL}: ${err2 instanceof Error ? err2.message : String(err2)}`,
        err2,
      );
    }
  }

  const text = res.text ?? "";
  if (!text) {
    throw new GeminiAnalysisError(
      `Gemini spatial call returned no text (finishReason=${res.candidates?.[0]?.finishReason ?? "unknown"})`,
    );
  }

  let parsed: RawSpatialGraphResponse;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    parsed = JSON.parse(cleaned) as RawSpatialGraphResponse;
  } catch (err) {
    throw new GeminiAnalysisError(`Gemini spatial call returned non-JSON: ${text.slice(0, 200)}`, err);
  }

  // ── Boundary validation — never trust the prompt ──────────────────────
  const validRooms: SpatialGraphNode[] = [];
  for (const r of parsed.rooms ?? []) {
    if (!r || typeof r.photoId !== "string" || !knownIds.has(r.photoId)) continue;
    const roomType = typeof r.roomType === "string" && r.roomType ? r.roomType : "other";
    validRooms.push({
      photoId: r.photoId,
      roomType,
      label: typeof r.label === "string" && r.label ? r.label : roomType.replace(/_/g, " "),
    });
  }
  // Every fetched photo must have a node, even if the model skipped it —
  // planRoute's no-edges fallback needs one segment per input photo.
  const coveredIds = new Set(validRooms.map((r) => r.photoId));
  for (const p of fetched) {
    if (!coveredIds.has(p.id)) {
      const roomType = p.roomType ?? "other";
      validRooms.push({ photoId: p.id, roomType, label: roomType.replace(/_/g, " ") });
    }
  }

  const roomIds = new Set(validRooms.map((r) => r.photoId));
  const validEdges: SpatialGraphEdge[] = [];
  for (const e of parsed.edges ?? []) {
    if (!e) continue;
    if (typeof e.from !== "string" || typeof e.to !== "string" || typeof e.evidencePhotoId !== "string") continue;
    if (!roomIds.has(e.from) || !roomIds.has(e.to) || !knownIds.has(e.evidencePhotoId)) continue;
    if (e.from === e.to) continue; // hard ban: self-loop
    const type: SpatialEdgeType =
      e.type === "doorway" || e.type === "opening" || e.type === "sightline" ? e.type : "sightline";
    const confidence =
      typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? Math.max(0, Math.min(1, e.confidence))
        : 0;
    validEdges.push({
      from: e.from,
      to: e.to,
      evidencePhotoId: e.evidencePhotoId,
      type,
      confidence,
      description: typeof e.description === "string" ? e.description : "",
    });
  }

  const heroShot = typeof parsed.heroShot === "string" && knownIds.has(parsed.heroShot) ? parsed.heroShot : null;

  const usageMeta = res.usageMetadata;
  const inputTokens = usageMeta?.promptTokenCount ?? 0;
  const outputTokens = usageMeta?.candidatesTokenCount ?? 0;
  const costCents = computeGeminiCost(model, inputTokens, outputTokens);

  return {
    rooms: validRooms,
    edges: validEdges,
    heroShot,
    usage: { inputTokens, outputTokens, costCents, model },
  };
}

// ─── Route planning (pure, no model call) ───────────────────────────────

/** Only edges at or above this confidence are ever walkable — mirrors the
 *  spatial-analysis system prompt's own 0.6 threshold guidance, enforced
 *  here in code (not trusted from the model). */
const MIN_EDGE_CONFIDENCE = 0.6;

const DEFAULT_MAX_SPACES_PER_SEGMENT = 4;
const SECONDS_PER_SPACE = 3.5;
const MIN_SEGMENT_DURATION_SEC = 4; // Atlas seedance-reference-walkthrough durationRange.min
const MAX_SEGMENT_DURATION_SEC = 15; // Atlas seedance-reference-walkthrough durationRange.max

export interface WalkthroughSegment {
  /** 1+ ordered photo ids — 2-4 in the common connected-graph case; can be a
   *  single id for an isolated dead-end room or the no-edges fallback (see
   *  module docblock / planRoute rules below). Always forward-only: no
   *  photo id repeats within a single segment. */
  photoIds: string[];
  /** Built from WALKTHROUGH_SKELETON_PROMPT + this segment's image-order
   *  manifest and covered-doorway transitions (see buildSegmentPrompt). */
  prompt: string;
  durationSec: number;
}

export interface WalkthroughTransition {
  /** Index into `segments` — this transition sits between segments[i] and
   *  segments[i+1]. */
  afterSegmentIndex: number;
  type: "crossfade";
}

export interface WalkthroughPlan {
  segments: WalkthroughSegment[];
  transitions: WalkthroughTransition[];
}

/**
 * Stable, reusable skeleton — the "coverage law" made into camera-motion
 * instructions, generalized from the validated v3 test-cycle prompt (see
 * /Users/oliverhelgemo/.claude/jobs/bcc0c194/tmp/walkthrough-v3-input.json).
 * Deliberately holds NO per-render content (no image count, no room names)
 * so it's identical across every segment/render — variable content (the
 * image-order manifest + path) is appended AFTER this block by
 * buildSegmentPrompt() / lib/walkthrough/generate.ts's buildWalkthroughPrompt,
 * per the project's cache-friendly-prompt-structure convention (stable
 * prefix first, variable content last).
 */
export const WALKTHROUGH_SKELETON_PROMPT =
  "Single continuous first-person walkthrough shot like a professional real-estate videographer on a stabilized gimbal, moving slowly and deliberately. THE CAMERA ONLY EVER MOVES FORWARD along its path — it NEVER reverses, never retraces, never returns to a space it has already shown, and never turns more than 90 degrees. Move ONLY through real doorways, open doors, or archways that are VISIBLY connected in the reference photos — never through walls, windows, or closed doors, and never invent a doorway, hallway, or opening that isn't shown. Show each space ONLY from viewpoints consistent with the reference photos; do not invent furniture, fixtures, or architecture in areas the references do not show, and do not fabricate what lies beyond a doorway unless a reference photo actually shows it. Preserve exact architecture, layout, furniture, decor, colors, materials and lighting from the references; keep all spatial relationships consistent. Photorealistic, natural color grading, true-to-life textures — not stylized, not animated, no cartoon look, no oversaturation. No cuts, no teleporting, no people, no text overlays, no added or invented spaces or openings, no distortion, no camera shake. Slow, smooth, confident forward pacing for the entire duration.";

function describeTransition(
  fromRoom: SpatialGraphNode,
  toRoom: SpatialGraphNode,
  edges: SpatialGraphEdge[],
): string {
  const edge = edges.find(
    (e) =>
      (e.from === fromRoom.photoId && e.to === toRoom.photoId) ||
      (e.from === toRoom.photoId && e.to === fromRoom.photoId),
  );
  if (!edge) {
    return `continue forward from ${fromRoom.label} into ${toRoom.label}`;
  }
  return `move forward from ${fromRoom.label} into ${toRoom.label} through the ${edge.type} (${edge.description || "visibly connected in the reference photos"})`;
}

/** Builds a segment's full prompt: stable skeleton first, then this
 *  segment's image-order manifest + doorway-evidenced path last. */
export function buildSegmentPrompt(segmentRooms: SpatialGraphNode[], edges: SpatialGraphEdge[]): string {
  const manifest = segmentRooms.map((r, i) => `Image ${i + 1} = ${r.label}`).join("; ");
  let path: string;
  if (segmentRooms.length <= 1) {
    const label = segmentRooms[0]?.label ?? "this space";
    path = `Path: hold on ${label} (image 1) with a slow forward drift — a single space, no transition.`;
  } else {
    const steps: string[] = [];
    for (let i = 0; i < segmentRooms.length - 1; i++) {
      steps.push(describeTransition(segmentRooms[i], segmentRooms[i + 1], edges));
    }
    path = `Path: begin at ${segmentRooms[0].label} (image 1); ${steps.join("; then ")}.`;
  }
  return `${WALKTHROUGH_SKELETON_PROMPT}\n\n${manifest}. ${path}`;
}

function computeDurationSec(spaceCount: number): number {
  return Math.min(
    MAX_SEGMENT_DURATION_SEC,
    Math.max(MIN_SEGMENT_DURATION_SEC, Math.round(spaceCount * SECONDS_PER_SPACE)),
  );
}

function buildSegment(segmentRooms: SpatialGraphNode[], edges: SpatialGraphEdge[]): WalkthroughSegment {
  return {
    photoIds: segmentRooms.map((r) => r.photoId),
    prompt: buildSegmentPrompt(segmentRooms, edges),
    durationSec: computeDurationSec(segmentRooms.length),
  };
}

function buildFadeTransitions(segmentCount: number): WalkthroughTransition[] {
  if (segmentCount <= 1) return [];
  return Array.from({ length: segmentCount - 1 }, (_, i) => ({
    afterSegmentIndex: i,
    type: "crossfade" as const,
  }));
}

function pickStartRoom(rooms: SpatialGraphNode[]): SpatialGraphNode | undefined {
  return rooms.find((r) => /exterior|front/i.test(r.roomType)) ?? rooms[0];
}

function buildAdjacency(
  rooms: SpatialGraphNode[],
  edges: SpatialGraphEdge[],
): { adjacency: Map<string, Array<{ to: string; edge: SpatialGraphEdge }>>; covered: SpatialGraphEdge[] } {
  const adjacency = new Map<string, Array<{ to: string; edge: SpatialGraphEdge }>>();
  for (const r of rooms) adjacency.set(r.photoId, []);
  const covered = edges.filter((e) => e.confidence >= MIN_EDGE_CONFIDENCE);
  for (const e of covered) {
    if (!adjacency.has(e.from) || !adjacency.has(e.to)) continue; // defensive: dangling edge
    adjacency.get(e.from)!.push({ to: e.to, edge: e });
    adjacency.get(e.to)!.push({ to: e.from, edge: e });
  }
  // Deterministic traversal order: prefer the highest-confidence neighbor
  // first (stable sort preserves the edges[] array order on ties).
  for (const list of adjacency.values()) {
    list.sort((a, b) => b.edge.confidence - a.edge.confidence);
  }
  return { adjacency, covered };
}

/**
 * Moves heroShot to the end of the final segment when it's part of the
 * connected traversal (i.e. reachable — present in `visited`). Mutates
 * idSegments in place. No-op if heroShot is unset, not reachable, or
 * already the last photo of the last segment.
 */
function applyHeroShotEnding(idSegments: string[][], heroShot: string | null, visited: Set<string>): void {
  if (!heroShot || idSegments.length === 0 || !visited.has(heroShot)) return;
  const last = idSegments[idSegments.length - 1];
  if (last[last.length - 1] === heroShot) return;

  let segIdx = -1;
  let idx = -1;
  for (let s = 0; s < idSegments.length; s++) {
    const i = idSegments[s].indexOf(heroShot);
    if (i !== -1) {
      segIdx = s;
      idx = i;
      break;
    }
  }
  if (segIdx === -1) return; // not part of any segment — shouldn't happen given visited.has(heroShot)

  idSegments[segIdx].splice(idx, 1);
  if (idSegments[segIdx].length === 0) {
    idSegments.splice(segIdx, 1);
  }
  idSegments[idSegments.length - 1].push(heroShot);
}

/**
 * Deterministic route planner — the "hard rule" ladder made concrete:
 *
 *   1. No usable (>= MIN_EDGE_CONFIDENCE) edges anywhere → every room is its
 *      own segment, every transition a crossfade (no-edges fallback).
 *   2. Otherwise, forward-only DFS from the exterior/front room (falls back
 *      to rooms[0]) across covered edges only, never revisiting a room.
 *      Disconnected rooms (unreachable from the start) are appended after,
 *      each starting its own segment.
 *   3. Chunk the traversal order into segments: a room stays in the CURRENT
 *      segment only while a covered edge directly connects it to the
 *      previous room AND the segment hasn't hit maxSpacesPerSegment;
 *      otherwise a new segment starts. This is what turns a DFS backtrack
 *      (a "physical jump" back through an already-shown room to reach a
 *      sibling branch) into a crossfade instead of an impossible camera
 *      move, and is also what turns a genuine dead-end (e.g. a kitchen with
 *      no onward covered edge) into its own short segment.
 *   4. If heroShot is set and reachable, it's moved to the end of the final
 *      segment so the tour always closes on the cinematic shot.
 */
export function planRoute(
  graph: SpatialGraph,
  opts?: { maxSpacesPerSegment?: number },
): WalkthroughPlan {
  const maxSpaces = Math.max(1, opts?.maxSpacesPerSegment ?? DEFAULT_MAX_SPACES_PER_SEGMENT);
  const rooms = graph.rooms;
  if (rooms.length === 0) {
    return { segments: [], transitions: [] };
  }

  const roomById = new Map(rooms.map((r) => [r.photoId, r]));
  const { adjacency, covered } = buildAdjacency(rooms, graph.edges);

  let idSegments: string[][];

  if (covered.length === 0) {
    // No-edges fallback: every room its own segment, all fades.
    idSegments = rooms.map((r) => [r.photoId]);
  } else {
    const visited = new Set<string>();
    const order: string[] = [];
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      order.push(id);
      for (const n of adjacency.get(id) ?? []) {
        if (!visited.has(n.to)) dfs(n.to);
      }
    };
    const start = pickStartRoom(rooms);
    if (start) dfs(start.photoId);
    // Rooms disconnected from the start (or from every covered edge) still
    // need a segment — append them in the graph's original room order.
    for (const r of rooms) {
      if (!visited.has(r.photoId)) dfs(r.photoId);
    }

    const hasEdge = (a: string, b: string) => (adjacency.get(a) ?? []).some((n) => n.to === b);

    idSegments = [];
    let current: string[] = [];
    for (const id of order) {
      if (current.length === 0) {
        current = [id];
        continue;
      }
      const prev = current[current.length - 1];
      if (current.length < maxSpaces && hasEdge(prev, id)) {
        current.push(id);
      } else {
        idSegments.push(current);
        current = [id];
      }
    }
    if (current.length > 0) {
      idSegments.push(current);
    }

    applyHeroShotEnding(idSegments, graph.heroShot, visited);
  }

  const segments = idSegments.map((ids) => buildSegment(ids.map((id) => roomById.get(id)!), graph.edges));
  return { segments, transitions: buildFadeTransitions(segments.length) };
}
