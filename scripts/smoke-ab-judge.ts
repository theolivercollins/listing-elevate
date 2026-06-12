/**
 * Smoke test for the delivery A/B Gemini judge (lib/delivery/judge.ts).
 *
 * Verifies the REAL media path: clip bytes are fetched, uploaded via the
 * Gemini Files API (polled to ACTIVE), judged, and the per-clip rubric
 * scores printed. Differentiated scores between two different clips are
 * the evidence that Gemini actually watched pixels (an HTTPS fileUri
 * passthrough — the old bug — would error or score blind).
 *
 * Run:
 *   pnpm exec tsx scripts/smoke-ab-judge.ts <clipA.mp4 url> <clipB.mp4 url>
 *
 * With no args, pulls two real clip_url values from the scenes table
 * (read-only query; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required).
 * Requires GEMINI_API_KEY or GOOGLE_API_KEY. Writes one qc cost_event
 * (cost tracking is first-class — even smoke calls are recorded), tagged
 * metadata.subtype='ab_judge' with delivery_run_id='smoke-ab-judge'.
 */

import 'dotenv/config';
import { judgePair, scoreTotal, pickWinner } from '../lib/delivery/judge.js';
import { getSupabase } from '../lib/client.js';

async function resolveClips(argv: string[]): Promise<{ a: string; b: string; sceneId: string | null; propertyId: string | null }> {
  if (argv.length >= 2) return { a: argv[0], b: argv[1], sceneId: null, propertyId: null };
  console.log('[clips] No URLs passed — querying scenes for two real clips (read-only)…');
  const { data, error } = await getSupabase()
    .from('scenes')
    .select('id, property_id, clip_url')
    .not('clip_url', 'is', null)
    .order('id', { ascending: false })
    .limit(2);
  if (error) throw new Error(`scenes query failed: ${error.message}`);
  if (!data || data.length < 2) throw new Error('Need at least 2 scenes with clip_url; pass two mp4 URLs as args instead.');
  return {
    a: data[0].clip_url as string,
    b: data[1].clip_url as string,
    sceneId: data[0].id as string,
    propertyId: data[0].property_id as string,
  };
}

async function main() {
  console.log('=== Delivery A/B judge smoke test ===\n');
  if (!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)) {
    console.error('GEMINI_API_KEY / GOOGLE_API_KEY missing — cannot run.');
    process.exit(1);
  }

  const { a, b, sceneId, propertyId } = await resolveClips(process.argv.slice(2));
  console.log(`[clips] A: ${a}`);
  console.log(`[clips] B: ${b}\n`);

  console.log('[judge] Uploading both clips via Gemini Files API + judging…');
  const t0 = Date.now();
  const scores = await judgePair(
    a, b,
    'Smoke test — two real-estate clips, not necessarily the same room. Score each on its own merits.',
    'smoke-ab-judge',
    sceneId ?? 'smoke-scene',
    propertyId, // null when URLs were passed explicitly (Lab-style cost_event)
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[judge] OK in ${elapsed}s\n`);
  console.log('=== Scores ===');
  console.log(`  A: ${JSON.stringify(scores.a)}  total=${scores.a ? scoreTotal(scores.a) : 'n/a'}`);
  console.log(`  B: ${JSON.stringify(scores.b)}  total=${scores.b ? scoreTotal(scores.b) : 'n/a'}`);
  console.log(`  Winner (deterministic): ${pickWinner(scores.a, scores.b)}`);
  console.log('\nSmoke test PASSED');
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
