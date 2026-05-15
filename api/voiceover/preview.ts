/**
 * POST /api/voiceover/preview
 *
 * Orchestrate: [Compass scrape →] Claude script → ElevenLabs TTS.
 * Uploads the MP3 to storage under voiceovers/preview/{tempId}.mp3.
 * Does NOT persist to a property row — the client passes the returned audioUrl
 * to createProperty which moves the file to a permanent path.
 *
 * Body: { voiceId, durationSec, compassUrl?, script?, description? }
 *   - compassUrl: scrape Compass then generate script + TTS (original path)
 *   - script:     skip scrape + script gen; run TTS only (voice-swap flow)
 *   - description: skip Compass scrape; pass description directly to script gen + TTS
 * Returns: { audioUrl, script, voice: { id, name } }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../../lib/auth.js";
import { isValidVoiceId, getVoice, WORD_BUDGET } from "../../lib/voiceover/voices.js";
import { scrapeCompassDescription } from "../../lib/voiceover/scrape-compass.js";
import { generateVoiceoverScript } from "../../lib/voiceover/generate-script.js";
import { generateVoiceoverAudio } from "../../lib/voiceover/generate-audio.js";

const VALID_DURATIONS = new Set([15, 30, 60]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return; // requireAuth already sent 401

  const {
    voiceId,
    durationSec,
    compassUrl,
    script: providedScript,
    description: providedDescription,
  } = req.body ?? {};

  // ── Input validation ──
  if (!voiceId || typeof voiceId !== "string" || !isValidVoiceId(voiceId)) {
    return res.status(400).json({ error: "Invalid voiceId" });
  }

  const duration = Number(durationSec);
  if (!VALID_DURATIONS.has(duration)) {
    return res.status(400).json({ error: "durationSec must be 15, 30, or 60" });
  }

  // Determine execution path:
  //   skipScriptGen=true  → TTS only (script already provided)
  //   hasDescription=true → skip Compass scrape, run script gen + TTS
  //   else                → full chain: Compass scrape + script gen + TTS
  const skipScriptGen = typeof providedScript === "string" && providedScript.trim().length > 0;
  const hasDescription =
    !skipScriptGen &&
    typeof providedDescription === "string" &&
    providedDescription.trim().length > 0;

  if (!skipScriptGen && !hasDescription) {
    if (
      !compassUrl ||
      typeof compassUrl !== "string" ||
      !compassUrl.match(/^https?:\/\/(www\.)?compass\.com\//i)
    ) {
      return res.status(400).json({
        error:
          "One of compassUrl (compass.com URL), description, or script is required",
      });
    }
  }

  const voice = getVoice(voiceId)!;
  // Unique temp ID for storage path — not tied to a property yet.
  const tempId = `preview/${crypto.randomUUID()}`;

  let script: string;

  if (skipScriptGen) {
    // Voice-only regeneration — use the script the client already has.
    script = providedScript.trim();
  } else {
    // ── Step 1: Resolve description ──
    let description: string;

    if (hasDescription) {
      // Caller supplied description directly — skip Compass scrape entirely.
      description = (providedDescription as string).trim();
    } else {
      // Full chain: scrape Compass for description.
      try {
        const scrapeResult = await scrapeCompassDescription(compassUrl, null);
        description = scrapeResult.description;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return res.status(422).json({
          error: msg,
          hint: "Try pasting the description manually",
        });
      }
    }

    // ── Step 2: Generate script ──
    try {
      const scriptResult = await generateVoiceoverScript({
        description,
        durationSec: duration as 15 | 30 | 60,
        address: "", // address not available pre-property; script uses description
        packageLabel: "Just Listed",
        propertyId: null,
      });
      script = scriptResult.script;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Script generation failed: ${msg}` });
    }
  }

  // ── Step 3: Generate audio ──
  let audioUrl: string;
  try {
    const audioResult = await generateVoiceoverAudio({
      script,
      voiceId,
      propertyId: null,
      storageFolder: tempId,
    });
    audioUrl = audioResult.audioUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: `Audio generation failed: ${msg}` });
  }

  return res.status(200).json({
    audioUrl,
    script,
    voice: { id: voice.id, name: voice.name },
  });
}
