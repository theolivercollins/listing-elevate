/**
 * Smoke test for the AI voiceover pipeline.
 *
 * Runs: Compass scrape → Claude script → ElevenLabs TTS
 * Does NOT persist to a property row.
 *
 * Run:
 *   APIFY_API_TOKEN=... ELEVENLABS_API_KEY=... ANTHROPIC_API_KEY=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm exec tsx scripts/smoke-voiceover.ts
 *
 * Without real API keys this script will error on the scrape step and print
 * the error. Set SMOKE_FAKE=1 to skip the live scrape and use a hardcoded
 * description instead.
 */

import "dotenv/config";
import { scrapeCompassDescription } from "../lib/voiceover/scrape-compass.js";
import { generateVoiceoverScript } from "../lib/voiceover/generate-script.js";
import { generateVoiceoverAudio } from "../lib/voiceover/generate-audio.js";

// A recently-listed property on Compass (search: compass.com/homes/for-sale/Miami-FL)
const COMPASS_URL =
  "https://www.compass.com/listing/80-sw-8th-street-miami-fl-33130/1640000000/";

const FAKE_DESCRIPTION =
  "Stunning corner residence in the heart of Brickell. Floor-to-ceiling glass " +
  "showcases sweeping Biscayne Bay views. Chef kitchen with quartz waterfall " +
  "island, Sub-Zero appliances, and gas range. Primary suite with spa bath, " +
  "two walk-ins, and private terrace. Concierge building. Steps to Mary Brickell " +
  "Village and the Financial District.";

const DURATION_SEC = 30 as const;
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

async function main() {
  console.log("=== Voiceover pipeline smoke test ===\n");

  let description: string;

  if (process.env.SMOKE_FAKE === "1") {
    console.log("[scrape] SMOKE_FAKE=1 — skipping live Apify scrape");
    description = FAKE_DESCRIPTION;
    console.log(`[scrape] Using hardcoded description (${description.length} chars)\n`);
  } else {
    console.log(`[scrape] Scraping: ${COMPASS_URL}`);
    try {
      const scrapeResult = await scrapeCompassDescription(COMPASS_URL, null);
      description = scrapeResult.description;
      console.log(`[scrape] OK — ${description.length} chars scraped\n`);
    } catch (err) {
      console.error(`[scrape] FAILED: ${err instanceof Error ? err.message : err}`);
      console.log("[scrape] Tip: set SMOKE_FAKE=1 to bypass the live scrape\n");
      process.exit(1);
    }
  }

  console.log(`[script] Generating ${DURATION_SEC}s script with Claude Sonnet 4.6…`);
  let script: string;
  let wordCount: number;
  try {
    const scriptResult = await generateVoiceoverScript({
      description,
      durationSec: DURATION_SEC,
      address: "80 SW 8th St, Miami FL",
      packageLabel: "Just Listed",
      propertyId: null,
    });
    script = scriptResult.script;
    wordCount = scriptResult.wordCount;
    console.log(`[script] OK — ${wordCount} words`);
    console.log(`[script] Text: "${script}"\n`);
  } catch (err) {
    console.error(`[script] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`[audio] Generating TTS with ElevenLabs (voice ${VOICE_ID})…`);
  let audioUrl: string;
  let durationMs: number;
  try {
    const audioResult = await generateVoiceoverAudio({
      script,
      voiceId: VOICE_ID,
      propertyId: null,
      storageFolder: "preview/smoke-test",
    });
    audioUrl = audioResult.audioUrl;
    durationMs = audioResult.durationMs;
    console.log(`[audio] OK — ${durationMs}ms estimated`);
    console.log(`[audio] URL: ${audioUrl}\n`);
  } catch (err) {
    console.error(`[audio] FAILED: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Cost summary
  const scriptChars = script.length;
  const elevenlabsCents = Math.ceil((scriptChars / 1000) * 30);
  const apifyCents = process.env.SMOKE_FAKE === "1" ? 0 : 1;
  const anthropicCentsApprox = 0.03; // ~500 input + 100 output tokens at Sonnet 4.6 rates
  const totalCents = apifyCents + anthropicCentsApprox + elevenlabsCents;

  console.log("=== Cost summary ===");
  console.log(`  Apify scrape:      ${apifyCents}¢`);
  console.log(`  Anthropic script:  ~${anthropicCentsApprox}¢`);
  console.log(`  ElevenLabs TTS:    ${elevenlabsCents}¢  (${scriptChars} chars)`);
  console.log(`  Total:             ~${totalCents.toFixed(2)}¢ per generation`);
  console.log("\nSmoke test PASSED");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
