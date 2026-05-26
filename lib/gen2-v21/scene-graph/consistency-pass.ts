/**
 * Consistency pass — re-prompts Gemini on photos with low confidence or contradictions
 * (e.g., same room_id but very different visible_features), then patches the graph.
 * Returns the corrected PropertySceneGraph.
 */

import { GoogleGenAI } from "@google/genai";
import type { PropertySceneGraph, PhotoSceneFacts } from "../types.js";
import { validateSceneGraph } from "./schema.js";

const CONSISTENCY_MODEL = process.env.SCENE_GRAPH_MODEL ?? "gemini-2.5-pro";

/** room_confidence below this triggers a re-check */
const CONFIDENCE_THRESHOLD = 0.8;

/** Jaccard similarity below this for photos sharing a room_id triggers a re-check */
const FEATURE_SIMILARITY_THRESHOLD = 0.3;

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

/** Identify photos that need re-checking */
function findAmbiguousPhotos(
  graph: PropertySceneGraph,
): Set<string> {
  const ambiguous = new Set<string>();

  // Low confidence
  for (const photo of graph.photos) {
    if (photo.room_confidence < CONFIDENCE_THRESHOLD) {
      ambiguous.add(photo.photo_id);
    }
  }

  // Contradiction: same room_id but very different visible_features
  const byRoom = new Map<string, PhotoSceneFacts[]>();
  for (const photo of graph.photos) {
    const existing = byRoom.get(photo.room_id) ?? [];
    existing.push(photo);
    byRoom.set(photo.room_id, existing);
  }

  for (const [, roomPhotos] of byRoom) {
    if (roomPhotos.length < 2) continue;
    for (let i = 0; i < roomPhotos.length; i++) {
      for (let j = i + 1; j < roomPhotos.length; j++) {
        const sim = jaccardSimilarity(roomPhotos[i].visible_features, roomPhotos[j].visible_features);
        if (sim < FEATURE_SIMILARITY_THRESHOLD) {
          ambiguous.add(roomPhotos[i].photo_id);
          ambiguous.add(roomPhotos[j].photo_id);
        }
      }
    }
  }

  return ambiguous;
}

const SYSTEM_PROMPT = `You are a real-estate scene analysis specialist performing a consistency correction pass.
You will be shown one or more property photos that were flagged as ambiguous or contradictory.
For each flagged photo, re-analyze it carefully and return corrected PhotoSceneFacts.

Output a JSON array of corrected PhotoSceneFacts objects.
Each object must include ALL fields:
- photo_id (same as the original)
- room_id (corrected if needed)
- room_confidence (0..1)
- sub_region (string or null)
- camera_bearing_vector
- shot_type
- focal_subject (string or null)
- visible_features (string[])
- visible_portals (array, can be empty)

Output ONLY the JSON array. No markdown, no extra text.`;

/**
 * Run consistency pass on a scene graph.
 * Photos with room_confidence < 0.8 or contradictory visible_features vs same-room siblings
 * are re-prompted individually. Returns the patched graph.
 */
export async function runConsistencyPass(
  graph: PropertySceneGraph,
  photoUrls: Map<string, string>,
): Promise<PropertySceneGraph> {
  const ambiguousIds = findAmbiguousPhotos(graph);
  if (ambiguousIds.size === 0) return graph;

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return graph;

  const genai = new GoogleGenAI({ apiKey });

  const flaggedPhotos = graph.photos.filter((p) => ambiguousIds.has(p.photo_id));
  const imageParts = flaggedPhotos
    .map((p) => {
      const url = photoUrls.get(p.photo_id);
      if (!url) return null;
      return { fileData: { fileUri: url, mimeType: "image/jpeg" } };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (imageParts.length === 0) return graph;

  const photoList = flaggedPhotos
    .map(
      (p) =>
        `photo_id="${p.photo_id}" (current room_id="${p.room_id}", confidence=${p.room_confidence.toFixed(2)})`,
    )
    .join("\n");

  try {
    const resp = await genai.models.generateContent({
      model: CONSISTENCY_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Re-analyze these ${flaggedPhotos.length} flagged photos and return corrected PhotoSceneFacts.\n\nFlagged photos:\n${photoList}\n\nReturn a JSON array of corrected objects.`,
            },
            ...imageParts,
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const rawText =
      (resp as { text?: string }).text ??
      (resp as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    if (!rawText) return graph;

    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const corrections = JSON.parse(cleaned) as unknown[];

    if (!Array.isArray(corrections)) return graph;

    // Build a map of corrections by photo_id
    const correctionMap = new Map<string, PhotoSceneFacts>();
    for (const c of corrections) {
      if (
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>)["photo_id"] === "string"
      ) {
        const photoId = (c as Record<string, unknown>)["photo_id"] as string;
        correctionMap.set(photoId, c as PhotoSceneFacts);
      }
    }

    // Patch the graph
    const patchedPhotos = graph.photos.map((p) => {
      const correction = correctionMap.get(p.photo_id);
      return correction ?? p;
    });

    const patchedGraph: PropertySceneGraph = { ...graph, photos: patchedPhotos };

    // Re-derive rooms from patched photos
    const roomMap = new Map<string, { room_type: string; features: string[]; photo_ids: string[] }>();
    for (const photo of patchedPhotos) {
      if (!roomMap.has(photo.room_id)) {
        // Try to find existing room data
        const existingRoom = graph.rooms.find((r) => r.room_id === photo.room_id);
        roomMap.set(photo.room_id, {
          room_type: existingRoom?.room_type ?? photo.room_id,
          features: [...(existingRoom?.features ?? photo.visible_features)],
          photo_ids: [],
        });
      }
      roomMap.get(photo.room_id)!.photo_ids.push(photo.photo_id);
    }

    const patchedRooms = Array.from(roomMap.entries()).map(([room_id, data]) => ({
      room_id,
      room_type: data.room_type,
      features: data.features,
      photo_ids: data.photo_ids,
    }));

    const finalGraph: PropertySceneGraph = { ...patchedGraph, rooms: patchedRooms };

    // Validate before returning — if patched graph is invalid, return original
    try {
      return validateSceneGraph(finalGraph);
    } catch {
      return graph;
    }
  } catch {
    // On any failure, return the original unmodified graph
    return graph;
  }
}
