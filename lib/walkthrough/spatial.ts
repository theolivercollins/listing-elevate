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

// ─── Room classification + dedup (2026-07-02 dry-run fixes) ────────────
//
// A real dry run against property a30212b2 exposed three flaws in the
// original single-DFS planner: (1) two photos of the same physical room
// (e.g. two exterior_front shots) were treated as two different rooms and
// could both land in the plan; (2) the DFS always started at the
// exterior/front room and so walked outward-to-outward instead of
// interior-to-outdoor; (3) segment order was raw DFS-backtrack order, so an
// aerial hero shot or a second exterior shot could land mid-tour instead of
// bookending it. The helpers below implement the fix; planRoute()'s
// docblock has the full rule ladder.

function normalizeRoomType(roomType: string): string {
  return (roomType || "other").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Aerial rooms are hero/closer-only — never a mid-segment chain member (and
 *  omitted entirely if they're not the hero shot). */
function isAerialRoomType(rt: string): boolean {
  return /aerial/.test(rt);
}

/** The single opener room type — always its own opening segment, never
 *  chained with anything else, regardless of edge evidence. Deliberately
 *  narrower than "exterior" alone so back_exterior/waterfront (real outdoor
 *  amenity rooms) don't get misclassified as the opener. */
function isExteriorFrontRoomType(rt: string): boolean {
  return rt === "exterior_front" || (/exterior/.test(rt) && /front/.test(rt));
}

function isLanaiRoomType(rt: string): boolean {
  return /lanai/.test(rt);
}

/** Pool, waterfront, or any other (non-front) exterior variant — e.g.
 *  back_exterior. Callers must check isExteriorFrontRoomType/isAerialRoomType
 *  first; this is intentionally broad ("exterior") once those are ruled out. */
function isOutdoorAmenityRoomType(rt: string): boolean {
  return /pool|waterfront|exterior/.test(rt);
}

/** Entry rooms (foyer/entryway/hallway) — 2026-07-02 follow-up dry run
 *  (property 1c2e7ae6) fix: these always win the chain-start slot in their
 *  connected component (see orientationScore + planChainSegments' start
 *  pick), so a tour walks IN from the front door instead of starting
 *  mid-house and stranding the foyer as an orphaned segment after the rest
 *  of the interior has already been shown. */
function isEntryRoomType(rt: string): boolean {
  return /foyer|entry|hall/.test(rt);
}

/** Private rooms (bedroom/bathroom/closet/office/den) — 2026-07-02
 *  follow-up dry run fix: these never appear inside the main interior/
 *  outdoor chain (see planRoute's chainRooms/privateRooms split); they get
 *  their own short trailing "suite" segment(s) instead, so the primary walk
 *  never ends by walking the camera INTO a bedroom. */
function isPrivateRoomType(rt: string): boolean {
  return /bedroom|bathroom|closet|office|den/.test(rt);
}

/** Orientation score for interior->outdoor chain ordering AND chain-start
 *  priority: entry rooms (foyer/hallway) score -1 — most interior of all,
 *  so they always win the start-room comparison in planChainSegments
 *  regardless of degree (fix 2026-07-02) — plain interior spaces (kitchen/
 *  living/etc — anything not entry/exterior/pool/lanai/aerial/waterfront)
 *  score 0, the semi-outdoor lanai scores 1, and pool/back-exterior/
 *  waterfront amenities score 2. Only meaningful for rooms already outside
 *  the exterior-front/aerial categories (those are pulled out of the chain
 *  graph entirely before this is ever consulted). */
function orientationScore(rt: string): -1 | 0 | 1 | 2 {
  if (isEntryRoomType(rt)) return -1;
  if (isLanaiRoomType(rt)) return 1;
  if (isOutdoorAmenityRoomType(rt)) return 2;
  return 0;
}

/**
 * Fix 1 (room dedup): photos sharing the same normalized room_type (e.g. two
 * exterior_front shots, two pool shots) represent ONE physical room. Merges
 * every such group into a single node — keyed on the FIRST occurrence's
 * position for determinism — picking the group member with the most edge
 * evidence (highest degree across ALL edges, not just covered ones) as the
 * representative photo, falling back to the first member on a tie. Edges are
 * remapped onto the surviving representative ids; a merge that turns an edge
 * into a self-loop (both endpoints collapsed onto the same room) is dropped,
 * and duplicate edges between the same pair of rooms collapse to whichever
 * copy has the higher confidence.
 */
function dedupeRoomsByType(graph: SpatialGraph): { rooms: SpatialGraphNode[]; edges: SpatialGraphEdge[]; heroShot: string | null } {
  const groupOrder: string[] = [];
  const groups = new Map<string, SpatialGraphNode[]>();
  for (const r of graph.rooms) {
    const key = normalizeRoomType(r.roomType);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(r);
  }

  // Any-confidence degree count, used only to pick the best representative
  // photo per duplicate group — deliberately not gated by MIN_EDGE_CONFIDENCE
  // since a sub-threshold edge is still evidence the photo shows a doorway.
  const degreeById = new Map<string, number>();
  for (const e of graph.edges) {
    degreeById.set(e.from, (degreeById.get(e.from) ?? 0) + 1);
    degreeById.set(e.to, (degreeById.get(e.to) ?? 0) + 1);
  }

  const idMap = new Map<string, string>(); // original photoId -> canonical (representative) photoId
  const dedupedRooms: SpatialGraphNode[] = [];
  for (const key of groupOrder) {
    const members = groups.get(key)!;

    // Fix (private-room pair preservation, 2026-07-02 follow-up dry run,
    // property 1c2e7ae6): a private room type (bedroom/bathroom/etc) can
    // legitimately have MULTIPLE photos of the SAME physical room joined by
    // a real edge — e.g. a bathroom's vanity-facing shot and its
    // shower-facing shot, connected by a doorway/opening edge Gemini
    // actually reported. Collapsing straight to one representative like
    // every other room type would silently drop that second photo and the
    // connection between them, which planRoute needs to build the private
    // "suite" micro-walk (see isPrivateRoomType). When such an internal
    // edge exists, keep BOTH its endpoints as separate rooms instead of the
    // usual single-winner collapse; any other duplicates in the group still
    // map onto the first (higher-confidence) endpoint. Falls through to the
    // normal single-winner path below when there's no such edge (e.g. plain
    // duplicate bedroom shots with no reported connection between them).
    if (members.length > 1 && isPrivateRoomType(key)) {
      const memberIds = new Set(members.map((m) => m.photoId));
      const internalEdges = graph.edges.filter(
        (e) =>
          e.confidence >= MIN_EDGE_CONFIDENCE &&
          e.from !== e.to &&
          memberIds.has(e.from) &&
          memberIds.has(e.to),
      );
      if (internalEdges.length > 0) {
        const best = internalEdges.reduce((a, b) => (b.confidence > a.confidence ? b : a));
        const nodeA = members.find((m) => m.photoId === best.from)!;
        const nodeB = members.find((m) => m.photoId === best.to)!;
        for (const m of members) {
          idMap.set(m.photoId, m.photoId === nodeB.photoId ? nodeB.photoId : nodeA.photoId);
        }
        dedupedRooms.push(nodeA, nodeB);
        continue;
      }
    }

    let winner = members[0];
    let winnerDegree = degreeById.get(winner.photoId) ?? 0;
    for (const m of members.slice(1)) {
      const d = degreeById.get(m.photoId) ?? 0;
      if (d > winnerDegree) {
        winner = m;
        winnerDegree = d;
      }
    }
    for (const m of members) idMap.set(m.photoId, winner.photoId);
    dedupedRooms.push(winner);
  }

  const bestEdgeByPair = new Map<string, SpatialGraphEdge>();
  for (const e of graph.edges) {
    const from = idMap.get(e.from) ?? e.from;
    const to = idMap.get(e.to) ?? e.to;
    if (from === to) continue; // merge collapsed both endpoints onto the same room -- drop the now-self-loop edge
    const pairKey = [from, to].sort().join("::");
    const remapped: SpatialGraphEdge = {
      ...e,
      from,
      to,
      evidencePhotoId: idMap.get(e.evidencePhotoId) ?? e.evidencePhotoId,
    };
    const existing = bestEdgeByPair.get(pairKey);
    if (!existing || remapped.confidence > existing.confidence) {
      bestEdgeByPair.set(pairKey, remapped);
    }
  }

  const heroShot = graph.heroShot ? (idMap.get(graph.heroShot) ?? graph.heroShot) : null;
  return { rooms: dedupedRooms, edges: [...bestEdgeByPair.values()], heroShot };
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
 * Fix 3(d) (hero closer): the hero shot always gets its own dedicated
 * closing beat, appended as the LAST segment — never folded into the tail
 * of whatever chain segment happens to end the tour. No-op if heroShot is
 * unset, unknown, or already the sole trailing element of the last segment.
 * Otherwise: if the hero room is currently a member of some chain segment,
 * it's spliced out of there (dropping the segment entirely if that empties
 * it) before the new closing segment is appended — so it never appears
 * twice. Aerial/exterior-front hero rooms, which never entered idSegments
 * in the first place (they're excluded from the chain graph), just get
 * appended fresh. Mutates idSegments in place.
 */
function applyHeroShotClosing(
  idSegments: string[][],
  heroShot: string | null,
  roomById: Map<string, SpatialGraphNode>,
): void {
  if (!heroShot || !roomById.has(heroShot)) return;

  if (idSegments.length > 0) {
    const last = idSegments[idSegments.length - 1];
    if (last[last.length - 1] === heroShot) return; // already the closing beat
  }

  for (let s = 0; s < idSegments.length; s++) {
    const idx = idSegments[s].indexOf(heroShot);
    if (idx !== -1) {
      idSegments[s].splice(idx, 1);
      if (idSegments[s].length === 0) idSegments.splice(s, 1);
      break;
    }
  }

  idSegments.push([heroShot]);
}

/**
 * Fix 2 + dead-end handling for the interior/amenity "chain graph" (rooms
 * with the exterior-front opener and any aerial rooms already excluded — see
 * planRoute). Splits `rooms` into connected components over `edges`
 * (>= MIN_EDGE_CONFIDENCE only), and for each component:
 *
 *   - No-edges component (or entirely edgeless graph): every room is its own
 *     segment (unchanged no-edges fallback).
 *   - Otherwise: picks a deterministic start room — lowest orientationScore
 *     (most interior) first, then lowest degree (prefer an actual leaf/dead
 *     end over a branching hub) as a tiebreak, then first-seen order as the
 *     final tiebreak — then walks a forward-only DFS (highest-confidence
 *     neighbor first) from there, chunking the resulting order into segments
 *     exactly as before: a room stays in the current segment only while a
 *     covered edge directly connects it to the previous room in the FINAL
 *     order AND the segment hasn't hit maxSpaces; otherwise a new segment
 *     starts. This is what turns a DFS backtrack (or a genuine dead end —
 *     e.g. a room whose only covered edge leads to an already-full segment)
 *     into a crossfade instead of an impossible camera move.
 *
 * Picking the lowest-degree, most-interior room as the start is what
 * reorients a linear chain from "outdoor-in" to "interior-out": in a
 * kitchen<->living<->lanai<->pool<->back_ext<->waterfront chain, the kitchen
 * (score 0, degree 1 — an actual leaf) wins the start over living (score 0,
 * degree 2), so the DFS walks kitchen->living->lanai->pool->back_ext->
 * waterfront instead of starting from whichever room happened to be listed
 * first in the graph.
 *
 * Entry-first override (2026-07-02 follow-up dry run, property 1c2e7ae6): an
 * entry room (foyer/hallway) scores -1 in orientationScore, strictly below
 * every other room type, so if a component contains one it ALWAYS wins the
 * start-room comparison outright — the degree/index tiebreaks never even
 * get consulted, because the score comparison short-circuits first. That's
 * what stops a tour from starting mid-house and stranding the foyer as an
 * orphaned segment after the interior has already been shown: a foyer that's
 * connected to anything in its component is guaranteed to open that
 * component's chain, whether it's a leaf or a branching hub.
 */
function planChainSegments(
  rooms: SpatialGraphNode[],
  edges: SpatialGraphEdge[],
  maxSpaces: number,
): string[][] {
  if (rooms.length === 0) return [];

  const roomIndex = new Map(rooms.map((r, i) => [r.photoId, i]));
  const roomById = new Map(rooms.map((r) => [r.photoId, r]));
  const { adjacency, covered } = buildAdjacency(rooms, edges);

  if (covered.length === 0) {
    return rooms.map((r) => [r.photoId]);
  }

  // Connected components over the covered adjacency, discovered in the
  // rooms' original (dedup-stable) order for determinism.
  const globalVisited = new Set<string>();
  const components: string[][] = [];
  for (const r of rooms) {
    if (globalVisited.has(r.photoId)) continue;
    const stack = [r.photoId];
    globalVisited.add(r.photoId);
    const comp: string[] = [];
    while (stack.length > 0) {
      const id = stack.pop()!;
      comp.push(id);
      for (const n of adjacency.get(id) ?? []) {
        if (!globalVisited.has(n.to)) {
          globalVisited.add(n.to);
          stack.push(n.to);
        }
      }
    }
    components.push(comp);
  }

  const hasEdge = (a: string, b: string) => (adjacency.get(a) ?? []).some((n) => n.to === b);
  const allSegments: string[][] = [];

  for (const comp of components) {
    let start = comp[0];
    let startScore = orientationScore(normalizeRoomType(roomById.get(start)!.roomType));
    let startDegree = (adjacency.get(start) ?? []).length;
    let startIdx = roomIndex.get(start)!;
    for (const id of comp.slice(1)) {
      const score = orientationScore(normalizeRoomType(roomById.get(id)!.roomType));
      const degree = (adjacency.get(id) ?? []).length;
      const idx = roomIndex.get(id)!;
      const better =
        score < startScore ||
        (score === startScore && degree < startDegree) ||
        (score === startScore && degree === startDegree && idx < startIdx);
      if (better) {
        start = id;
        startScore = score;
        startDegree = degree;
        startIdx = idx;
      }
    }

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
    dfs(start);
    for (const id of comp) if (!visited.has(id)) dfs(id); // defensive: shouldn't fire, comp came from the same graph

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
        allSegments.push(current);
        current = [id];
      }
    }
    if (current.length > 0) allSegments.push(current);
  }

  return allSegments;
}

/**
 * Deterministic route planner — the "hard rule" ladder made concrete. Fixed
 * 2026-07-02 after a real dry run (property a30212b2) exposed three flaws:
 * duplicate exterior/pool photos both landing in the plan, chains walking
 * outdoor-to-outdoor instead of interior-to-outdoor, and cinematic ordering
 * (opener / hero closer) being at the mercy of raw DFS-backtrack order — and
 * refined the same day after a second dry run (property 1c2e7ae6, full MLS
 * photo set) exposed two more semantic gaps: the foyer could get stranded as
 * its own segment AFTER the interior walk instead of opening it, and private
 * rooms (bedrooms/bathrooms) could land mid-chain or even end the tour by
 * walking the camera INTO a bedroom. See dedupeRoomsByType /
 * planChainSegments / applyHeroShotClosing above for the mechanics; here's
 * the assembly:
 *
 *   1. Dedup rooms by normalized room_type (fix 1) — two photos of the same
 *      physical room (e.g. two exterior_front shots) collapse to one node,
 *      keeping whichever photo has the most edge evidence as the
 *      representative. Edges are remapped onto survivors; self-loops created
 *      by the merge are dropped, duplicate edges between the same pair keep
 *      the higher-confidence copy. Exception: a private room type (bedroom/
 *      bathroom/etc) with a real internal edge between two of its own photos
 *      (e.g. a bathroom's vanity shot doorway-connected to its shower shot)
 *      keeps BOTH photos instead of collapsing to one — that pair becomes
 *      the suite micro-walk in step 3.
 *   2. Split the deduped rooms into FOUR groups: the exterior-front opener
 *      room(s) (always their own single-room opening segment, never chained
 *      with anything, edges into/out of them are ignored for chaining
 *      purposes), aerial room(s) (never a mid-segment member — hero/closer
 *      only, omitted entirely if not the hero shot), private rooms (bedroom/
 *      bathroom/closet/office/den — pulled out of the main walk entirely
 *      UNLESS every remaining candidate room is private, in which case
 *      excluding them would leave nothing to show and they stay put), and
 *      everything else (the "chain graph": public interior + amenity rooms
 *      available for connected, forward-only traversal).
 *   3. planChainSegments() walks the chain graph: no usable
 *      (>= MIN_EDGE_CONFIDENCE) edges anywhere → every chain room is its own
 *      segment (no-edges fallback). Otherwise, per connected component, a
 *      forward-only DFS starts at the most-interior, lowest-degree room
 *      (fix 2 — orients kitchen/living/bedroom-style rooms first, pool/
 *      back-exterior/waterfront-style amenities last; an entry room — foyer/
 *      hallway — always wins this start slot outright, regardless of degree,
 *      per orientationScore's -1) and chunks the traversal into segments
 *      exactly as before: a room stays in the current segment only while a
 *      covered edge directly connects it to the previous room AND the
 *      segment hasn't hit maxSpacesPerSegment; otherwise a new segment
 *      starts (this is what turns a DFS backtrack, or a genuine dead end,
 *      into a crossfade instead of an impossible camera move). The SAME
 *      function, called again over just the private rooms with a tighter
 *      2-space cap, produces the trailing "suite" segments — a bedroom's
 *      lone photo, a bathroom's vanity->shower pair, etc.
 *   4. Cinematic segment order: opener segment(s) first, then the resulting
 *      chain segments that contain at least one interior-or-entry room
 *      ("interior->outdoor" chains) sorted longest/most-covered first, then
 *      the remaining chain segments that are entirely outdoor/amenity rooms
 *      (also longest first), then the private "suite" segments (component
 *      order, capped at 2 spaces each), then the hero shot as a dedicated
 *      closing segment appended last (applyHeroShotClosing) — pulled out of
 *      wherever it currently sits if it's mid-chain, or appended fresh if it
 *      was an aerial/opener room that was never part of the chain graph at
 *      all.
 */
export function planRoute(
  graph: SpatialGraph,
  opts?: { maxSpacesPerSegment?: number },
): WalkthroughPlan {
  const maxSpaces = Math.max(1, opts?.maxSpacesPerSegment ?? DEFAULT_MAX_SPACES_PER_SEGMENT);
  if (graph.rooms.length === 0) {
    return { segments: [], transitions: [] };
  }

  const deduped = dedupeRoomsByType(graph);
  const roomById = new Map(deduped.rooms.map((r) => [r.photoId, r]));

  const openerRooms = deduped.rooms.filter((r) => isExteriorFrontRoomType(normalizeRoomType(r.roomType)));
  const aerialRooms = deduped.rooms.filter((r) => isAerialRoomType(normalizeRoomType(r.roomType)));
  const excludedIds = new Set([...openerRooms, ...aerialRooms].map((r) => r.photoId));
  const candidateRooms = deduped.rooms.filter((r) => !excludedIds.has(r.photoId));

  // Fix (private-room exclusion, 2026-07-02 follow-up dry run, property
  // 1c2e7ae6): bedroom/bathroom/closet/office/den rooms never join the MAIN
  // interior/outdoor chain — they get their own short trailing "suite"
  // segment(s) below — UNLESS every remaining candidate room is private, in
  // which case pulling them out would leave nothing for the main walk at
  // all, so they stay in the chain graph exactly as before.
  const hasPublicInterior = candidateRooms.some(
    (r) => !isPrivateRoomType(normalizeRoomType(r.roomType)),
  );
  const privateRooms = hasPublicInterior
    ? candidateRooms.filter((r) => isPrivateRoomType(normalizeRoomType(r.roomType)))
    : [];
  const chainRooms = hasPublicInterior
    ? candidateRooms.filter((r) => !isPrivateRoomType(normalizeRoomType(r.roomType)))
    : candidateRooms;

  const chainRoomIds = new Set(chainRooms.map((r) => r.photoId));
  const chainEdges = deduped.edges.filter((e) => chainRoomIds.has(e.from) && chainRoomIds.has(e.to));

  const chainIdSegments = planChainSegments(chainRooms, chainEdges, maxSpaces);

  // Suite segments: private rooms walk their OWN short connected chains
  // (>= MIN_EDGE_CONFIDENCE edges among themselves only — e.g. a bathroom's
  // vanity->shower pair), capped at 2 spaces instead of maxSpaces, kept
  // entirely separate from the main interior/outdoor chains. Reuses
  // planChainSegments so start-pick/dead-end/no-edges behavior stays
  // identical to the main chain, just tighter (a private-room beat is a
  // couple of seconds, not a full room-to-room tour).
  const privateRoomIds = new Set(privateRooms.map((r) => r.photoId));
  const privateEdges = deduped.edges.filter((e) => privateRoomIds.has(e.from) && privateRoomIds.has(e.to));
  const suiteIdSegments = planChainSegments(privateRooms, privateEdges, Math.min(2, maxSpaces));

  // Fix 3: interior-anchored chains (contain >= 1 interior-or-entry room —
  // orientationScore <= 0, so a lone foyer counts as interior-anchored too)
  // come before purely-outdoor/amenity chains, each bucket sorted longest/
  // most-covered first.
  const interiorAnchored: string[][] = [];
  const outdoorOnly: string[][] = [];
  for (const seg of chainIdSegments) {
    const hasInterior = seg.some(
      (id) => orientationScore(normalizeRoomType(roomById.get(id)!.roomType)) <= 0,
    );
    (hasInterior ? interiorAnchored : outdoorOnly).push(seg);
  }
  interiorAnchored.sort((a, b) => b.length - a.length);
  outdoorOnly.sort((a, b) => b.length - a.length);

  const idSegments: string[][] = [
    ...openerRooms.map((r) => [r.photoId]),
    ...interiorAnchored,
    ...outdoorOnly,
    ...suiteIdSegments,
  ];

  applyHeroShotClosing(idSegments, deduped.heroShot, roomById);

  if (idSegments.length === 0) {
    // e.g. an all-aerial property with no heroShot set — nothing left to
    // show once aerial-only rooms are excluded from the chain graph.
    return { segments: [], transitions: [] };
  }

  const segments = idSegments.map((ids) => buildSegment(ids.map((id) => roomById.get(id)!), deduped.edges));
  return { segments, transitions: buildFadeTransitions(segments.length) };
}
