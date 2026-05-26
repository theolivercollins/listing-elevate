/**
 * Secondary focused Gemini call to infer camera_bearing_vector for photos
 * where the primary pass returned 'unknown'.
 * Returns 'unknown' on any failure.
 */

import { GoogleGenAI } from "@google/genai";
import type { BearingVector } from "../types.js";

const BEARING_MODEL = process.env.SCENE_GRAPH_MODEL ?? "gemini-2.5-flash";

const VALID_BEARINGS: BearingVector[] = [
  "looking_into_room",
  "looking_out_of_room",
  "parallel_to_wall_N",
  "parallel_to_wall_E",
  "parallel_to_wall_S",
  "parallel_to_wall_W",
  "unknown",
];

const SYSTEM_PROMPT = `You are a precise architectural camera-bearing analyst.
Given a single property photo and known room features, determine the camera bearing vector.

Choose exactly one of these values:
- "looking_into_room" — camera faces the interior of the room (away from entry)
- "looking_out_of_room" — camera faces toward the exit/door/hallway
- "parallel_to_wall_N" — camera is roughly parallel to the north wall, shooting east or west
- "parallel_to_wall_E" — camera is roughly parallel to the east wall, shooting north or south
- "parallel_to_wall_S" — camera is roughly parallel to the south wall, shooting east or west
- "parallel_to_wall_W" — camera is roughly parallel to the west wall, shooting north or south
- "unknown" — cannot be determined from the photo

Use architectural clues: window placement (windows typically face outward), door positions,
natural light direction, and room features provided.

Output ONLY a JSON object: { "bearing": "<one of the values above>" }
No markdown, no extra text.`;

/**
 * Infer the camera bearing vector for a single photo using focused Gemini call.
 * roomFeatures provides context about what's known about the room to help orient the model.
 * Returns 'unknown' on any failure.
 */
export async function inferBearingForPhoto(
  photoUrl: string,
  roomFeatures: string[],
): Promise<BearingVector> {
  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) return "unknown";

    const genai = new GoogleGenAI({ apiKey });

    const contextText =
      roomFeatures.length > 0
        ? `Known room features: ${roomFeatures.join(", ")}.`
        : "No additional room context available.";

    const resp = await genai.models.generateContent({
      model: BEARING_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Determine the camera bearing vector for this photo. ${contextText}\nReturn JSON: { "bearing": "..." }`,
            },
            { fileData: { fileUri: photoUrl, mimeType: "image/jpeg" } },
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

    if (!rawText) return "unknown";

    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as { bearing?: string };

    const bearing = parsed?.bearing;
    if (typeof bearing === "string" && VALID_BEARINGS.includes(bearing as BearingVector)) {
      return bearing as BearingVector;
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}
