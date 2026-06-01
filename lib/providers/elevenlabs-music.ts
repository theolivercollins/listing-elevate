/**
 * ElevenLabs Music generation (Eleven Music API, GA Aug 2025).
 *
 * Separate from the TTS voiceover path (lib/voiceover/generate-audio.ts). Used
 * to pre-generate a per-mood pool of background tracks for the assembled-video
 * music library ("C-pooled" strategy — see
 * docs/plans/2026-06-01-create-listing-finalize-plan.md).
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/music
 * Body:     { prompt, music_length_ms } (model defaults server-side)
 * Returns:  audio/mpeg binary, like the TTS endpoint.
 *
 * Commercial license: ElevenLabs Music is cleared for commercial use on paid
 * plans, trained on licensed data. Generated tracks are ours to use in
 * client-delivered videos.
 */

import { recordCostEvent } from "../db.js";
import type { MoodTag } from "../assembly/music.js";

const ELEVENLABS_MUSIC_API = "https://api.elevenlabs.io/v1/music";

/** Min/max length the Eleven Music API accepts (3s–10min). */
export const MUSIC_MIN_MS = 3_000;
export const MUSIC_MAX_MS = 600_000;

/**
 * Prompt templates per mood. Tuned for real-estate listing videos: instrumental,
 * no vocals (vocals would fight the voiceover), looping-friendly, broadcast-clean.
 */
export const MOOD_PROMPTS: Record<MoodTag, string> = {
  upbeat:
    "Uplifting, bright instrumental background music for a new real-estate listing video. Warm acoustic guitar and light piano, gentle percussion, optimistic and welcoming. No vocals. Smooth, polished, suitable to sit under a calm narrator.",
  warm:
    "Warm, heartfelt instrumental background music for a real-estate lifestyle video. Soft piano and mellow strings, intimate and inviting, unhurried. No vocals. Polished and clean, sits under a calm narrator.",
  celebratory:
    "Triumphant yet tasteful instrumental music for a 'just sold' real-estate video. Bright piano, swelling strings, hopeful and rewarding without being loud or cheesy. No vocals. Clean mix that sits under narration.",
  cinematic:
    "Cinematic, elegant instrumental background music for a luxury real-estate walkthrough. Atmospheric pads, sparse piano, subtle building tension, refined and aspirational. No vocals. Spacious mix for narration on top.",
  neutral:
    "Understated, neutral instrumental underscore for a real-estate video. Soft ambient pads and light piano, calm and unobtrusive, modern and clean. No vocals. Designed to sit quietly under a narrator.",
};

export interface ComposeMusicRequest {
  prompt: string;
  music_length_ms: number;
}

/** Build (and validate) the Eleven Music compose request body. */
export function buildMusicComposeRequest(
  prompt: string,
  lengthMs: number,
): ComposeMusicRequest {
  if (!prompt || !prompt.trim()) {
    throw new Error("buildMusicComposeRequest: prompt is required");
  }
  const clamped = Math.max(MUSIC_MIN_MS, Math.min(MUSIC_MAX_MS, Math.round(lengthMs)));
  return { prompt: prompt.trim(), music_length_ms: clamped };
}

export interface ComposeMusicResult {
  audio: Buffer;
  /** Length actually requested (ms). */
  lengthMs: number;
}

/**
 * Compose a music track and return the MP3 buffer. Records a cost_event
 * (provider 'elevenlabs', stage 'assembly'). Pricing placeholder: ~$0.50/min
 * of generated audio (reconcile against invoice).
 */
export async function composeMusic(
  prompt: string,
  lengthMs: number,
  opts: { propertyId?: string | null } = {},
): Promise<ComposeMusicResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY env var is not set");

  const body = buildMusicComposeRequest(prompt, lengthMs);

  const res = await fetch(ELEVENLABS_MUSIC_API, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs Music failed (${res.status}): ${errText}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());

  // Cost: ~$0.50/min → 50¢ per 60_000 ms, rounded up.
  const minutes = body.music_length_ms / 60_000;
  const costCents = Math.ceil(minutes * 50);
  await recordCostEvent({
    propertyId: opts.propertyId ?? null,
    stage: "assembly",
    provider: "elevenlabs",
    unitsConsumed: Math.round(body.music_length_ms / 1000),
    unitType: "credits",
    costCents,
    metadata: { kind: "music_generation", music_length_ms: body.music_length_ms },
  }).catch((e) => console.error("[elevenlabs-music] cost_event insert failed:", e));

  return { audio, lengthMs: body.music_length_ms };
}
