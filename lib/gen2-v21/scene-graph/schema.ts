/**
 * JSON schema + runtime validator for PropertySceneGraph.
 * Used by extractor.ts to validate Gemini structured output before returning.
 */

import type {
  PropertySceneGraph,
  PhotoSceneFacts,
  RoomFacts,
  VisiblePortal,
  BearingVector,
  ShotType,
} from "../types.js";

// ── Lightweight runtime schema validation (no Zod dep required) ──

const BEARING_VECTORS: BearingVector[] = [
  "looking_into_room",
  "looking_out_of_room",
  "parallel_to_wall_N",
  "parallel_to_wall_E",
  "parallel_to_wall_S",
  "parallel_to_wall_W",
  "unknown",
];

const SHOT_TYPES: ShotType[] = ["wide", "medium", "close", "aerial", "detail"];

const DEPTH_ESTIMATES = ["near", "mid", "far"] as const;

const FRONT_ORIENTATIONS = ["N", "E", "S", "W", "unknown"] as const;

const EXTERIOR_TYPES = ["aerial", "front", "back", "side", "drone_descent"] as const;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !isNaN(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertField(obj: Record<string, unknown>, key: string, check: (v: unknown) => boolean, path: string): void {
  if (!check(obj[key])) {
    throw new Error(`Schema violation at ${path}.${key}: got ${JSON.stringify(obj[key])}`);
  }
}

function validateVisiblePortal(raw: unknown, path: string): VisiblePortal {
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  // Auto-generate portal_id if Gemini omitted it
  if (!isString(raw["portal_id"])) {
    raw["portal_id"] = `auto_${path.replace(/[^a-z0-9]/gi, "_")}_${Math.random().toString(36).slice(2, 8)}`;
  }
  // Coerce missing from_room_id to empty string
  if (!isString(raw["from_room_id"])) raw["from_room_id"] = "";
  // Coerce to_room_id: non-string non-null → null
  if (raw["to_room_id"] !== null && !isString(raw["to_room_id"])) raw["to_room_id"] = null;
  // Coerce missing screen_position to a default center
  if (!isObject(raw["screen_position"])) {
    raw["screen_position"] = { x: 0.5, y: 0.5, bbox: { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 } };
  }
  const sp = raw["screen_position"] as Record<string, unknown>;
  if (!isNumber(sp["x"])) sp["x"] = 0.5;
  if (!isNumber(sp["y"])) sp["y"] = 0.5;
  if (!isObject(sp["bbox"])) {
    sp["bbox"] = { x1: 0.4, y1: 0.4, x2: 0.6, y2: 0.6 };
  }
  const bbox = sp["bbox"] as Record<string, unknown>;
  for (const coord of ["x1", "y1", "x2", "y2"]) {
    if (!isNumber(bbox[coord])) bbox[coord] = 0.5;
  }
  // Coerce unknown depth estimates to "mid"
  if (!DEPTH_ESTIMATES.includes(raw["depth_estimate"] as typeof DEPTH_ESTIMATES[number])) {
    raw["depth_estimate"] = "mid";
  }
  // Coerce missing is_open_path to false
  if (!isBoolean(raw["is_open_path"])) raw["is_open_path"] = false;
  // Coerce missing confidence to 0.5
  if (!isNumber(raw["confidence"])) raw["confidence"] = 0.5;

  return raw as unknown as VisiblePortal;
}

function validatePhotoSceneFacts(raw: unknown, path: string): PhotoSceneFacts {
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  if (!isString(raw["photo_id"])) raw["photo_id"] = `unknown_photo_${Math.random().toString(36).slice(2, 8)}`;
  if (!isString(raw["room_id"])) raw["room_id"] = "unknown_room";
  if (!isNumber(raw["room_confidence"])) raw["room_confidence"] = 0.5;
  // Coerce sub_region: non-string non-null → null (Gemini may return objects or numbers)
  if (raw["sub_region"] !== null && !isString(raw["sub_region"])) {
    raw["sub_region"] = null;
  }
  // Coerce unknown bearing vectors to "unknown" rather than throwing.
  // Gemini may return values like "parallel_to_wall" (without N/E/S/W suffix)
  // or other creative variants — treat them as unknown rather than blocking extraction.
  if (!BEARING_VECTORS.includes(raw["camera_bearing_vector"] as BearingVector)) {
    raw["camera_bearing_vector"] = "unknown";
  }
  // Coerce unknown shot types to "medium" (safe midpoint).
  if (!SHOT_TYPES.includes(raw["shot_type"] as ShotType)) {
    raw["shot_type"] = "medium";
  }
  // Coerce focal_subject: non-string non-null → null (defensive, same as sub_region)
  if (raw["focal_subject"] !== null && !isString(raw["focal_subject"])) {
    raw["focal_subject"] = null;
  }
  // Coerce visible_features: ensure it's a string[] (filter out non-strings, default to [])
  if (!isArray(raw["visible_features"])) {
    raw["visible_features"] = [];
  } else {
    raw["visible_features"] = (raw["visible_features"] as unknown[]).map((f) =>
      isString(f) ? f : isObject(f) ? JSON.stringify(f) : String(f)
    );
  }
  // Coerce visible_portals: ensure it's an array (default to [])
  if (!isArray(raw["visible_portals"])) {
    raw["visible_portals"] = [];
  }
  (raw["visible_portals"] as unknown[]).forEach((p, i) =>
    validateVisiblePortal(p, `${path}.visible_portals[${i}]`),
  );

  return raw as unknown as PhotoSceneFacts;
}

function validateRoomFacts(raw: unknown, path: string): RoomFacts {
  if (!isObject(raw)) throw new Error(`${path} must be an object`);
  if (!isString(raw["room_id"])) raw["room_id"] = "unknown_room";
  if (!isString(raw["room_type"])) raw["room_type"] = "unknown";
  // Coerce features
  if (!isArray(raw["features"])) {
    raw["features"] = [];
  } else {
    raw["features"] = (raw["features"] as unknown[]).map((f) =>
      isString(f) ? f : String(f)
    );
  }
  // Coerce photo_ids
  if (!isArray(raw["photo_ids"])) {
    raw["photo_ids"] = [];
  } else {
    raw["photo_ids"] = (raw["photo_ids"] as unknown[]).filter(isString);
  }
  return raw as unknown as RoomFacts;
}

/**
 * Validate raw unknown input against the PropertySceneGraph shape.
 * Throws a descriptive Error on any violation.
 * Returns a typed PropertySceneGraph on success.
 */
export function validateSceneGraph(raw: unknown): PropertySceneGraph {
  if (!isObject(raw)) throw new Error("Scene graph must be a JSON object");

  assertField(raw, "listing_id", isString, "root");
  assertField(raw, "extracted_at", isString, "root");
  assertField(raw, "model_version", isString, "root");

  // Coerce unknown front_orientation to "unknown"
  if (!FRONT_ORIENTATIONS.includes(raw["front_orientation"] as typeof FRONT_ORIENTATIONS[number])) {
    raw["front_orientation"] = "unknown";
  }

  if (!isArray(raw["photos"])) throw new Error("root.photos must be an array");
  (raw["photos"] as unknown[]).forEach((p, i) =>
    validatePhotoSceneFacts(p, `photos[${i}]`),
  );

  if (!isArray(raw["rooms"])) throw new Error("root.rooms must be an array");
  (raw["rooms"] as unknown[]).forEach((r, i) =>
    validateRoomFacts(r, `rooms[${i}]`),
  );

  if (!isArray(raw["exterior_shots"])) throw new Error("root.exterior_shots must be an array");
  (raw["exterior_shots"] as unknown[]).forEach((es, i) => {
    if (!isObject(es)) throw new Error(`exterior_shots[${i}] must be an object`);
    const esObj = es as Record<string, unknown>;
    assertField(esObj, "photo_id", isString, `exterior_shots[${i}]`);
    // Coerce unknown exterior types to "front" (safe default)
    if (!EXTERIOR_TYPES.includes(esObj["type"] as typeof EXTERIOR_TYPES[number])) {
      esObj["type"] = "front";
    }
  });

  return raw as unknown as PropertySceneGraph;
}

/**
 * JSON Schema object (for Gemini's responseSchema parameter) matching PropertySceneGraph.
 * Provided as a convenience — callers that want strict Gemini structured output
 * can pass this to config.responseSchema.
 */
export const SCENE_GRAPH_JSON_SCHEMA = {
  type: "object",
  required: ["listing_id", "photos", "rooms", "front_orientation", "exterior_shots", "extracted_at", "model_version"],
  properties: {
    listing_id: { type: "string" },
    extracted_at: { type: "string" },
    model_version: { type: "string" },
    front_orientation: { type: "string", enum: ["N", "E", "S", "W", "unknown"] },
    photos: {
      type: "array",
      items: {
        type: "object",
        required: ["photo_id", "room_id", "room_confidence", "sub_region", "camera_bearing_vector", "shot_type", "focal_subject", "visible_features", "visible_portals"],
        properties: {
          photo_id: { type: "string" },
          room_id: { type: "string" },
          room_confidence: { type: "number" },
          sub_region: { type: ["string", "null"] },
          camera_bearing_vector: {
            type: "string",
            enum: BEARING_VECTORS,
          },
          shot_type: { type: "string", enum: SHOT_TYPES },
          focal_subject: { type: ["string", "null"] },
          visible_features: { type: "array", items: { type: "string" } },
          visible_portals: {
            type: "array",
            items: {
              type: "object",
              required: ["portal_id", "from_room_id", "to_room_id", "screen_position", "depth_estimate", "is_open_path", "confidence"],
              properties: {
                portal_id: { type: "string" },
                from_room_id: { type: "string" },
                to_room_id: { type: ["string", "null"] },
                screen_position: {
                  type: "object",
                  required: ["x", "y", "bbox"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    bbox: {
                      type: "object",
                      required: ["x1", "y1", "x2", "y2"],
                      properties: {
                        x1: { type: "number" },
                        y1: { type: "number" },
                        x2: { type: "number" },
                        y2: { type: "number" },
                      },
                    },
                  },
                },
                depth_estimate: { type: "string", enum: ["near", "mid", "far"] },
                is_open_path: { type: "boolean" },
                confidence: { type: "number" },
              },
            },
          },
        },
      },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        required: ["room_id", "room_type", "features", "photo_ids"],
        properties: {
          room_id: { type: "string" },
          room_type: { type: "string" },
          features: { type: "array", items: { type: "string" } },
          photo_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    exterior_shots: {
      type: "array",
      items: {
        type: "object",
        required: ["photo_id", "type"],
        properties: {
          photo_id: { type: "string" },
          type: { type: "string", enum: ["aerial", "front", "back", "side", "drone_descent"] },
        },
      },
    },
  },
} as const;
