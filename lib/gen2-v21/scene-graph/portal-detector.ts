/**
 * Focused secondary Gemini call to extract visible_portals for ambiguous photos.
 * Triggered when room_confidence < 0.8 OR the primary pass returned no visible_portals.
 * Returns empty array on any failure — cheap fallback.
 */

import { GoogleGenAI } from "@google/genai";
import type { VisiblePortal } from "../types.js";

const PORTAL_MODEL = process.env.SCENE_GRAPH_MODEL ?? "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are a precise architectural portal detector.
Given a single property photo, identify all visible portals (doorways, archways, open passages) in the frame.

For each portal return:
- portal_id: a unique string like "portal_1", "portal_2", etc.
- from_room_id: describe the room the camera is in (e.g. "kitchen_1")
- to_room_id: describe the room visible through the portal, or null if unknown
- screen_position: normalized 0..1 coordinates
  - x, y: center point of the portal
  - bbox: { x1, y1, x2, y2 } bounding box
- depth_estimate: "near" | "mid" | "far"
- is_open_path: true only for walkable openings (doors/archways), false for windows/mirrors
- confidence: 0..1 how confident you are this is a real portal

Output a JSON array of portal objects. If no portals are visible, output [].
Output ONLY the JSON array, no markdown, no extra text.`;

/**
 * Make a focused secondary call on a single photo to extract visible portals with high precision.
 * Returns empty array on any error — callers should treat [] as "no portals detected".
 */
export async function detectPortalsForPhoto(photoUrl: string): Promise<VisiblePortal[]> {
  try {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) return [];

    const genai = new GoogleGenAI({ apiKey });

    const resp = await genai.models.generateContent({
      model: PORTAL_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Identify all visible portals in this photo. Return a JSON array." },
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

    if (!rawText) return [];

    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) return [];

    // Light structural validation — accept items that look like portals
    return parsed.filter(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof p.portal_id === "string" &&
        typeof p.from_room_id === "string" &&
        typeof p.is_open_path === "boolean" &&
        typeof p.confidence === "number",
    ) as VisiblePortal[];
  } catch {
    return [];
  }
}
