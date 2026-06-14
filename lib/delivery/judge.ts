/**
 * Operator delivery — Gemini A/B pairwise judge.
 *
 * Once a delivery property's scenes settle, the poll-scenes cron invokes
 * runJudgePass instead of runAssembly. Each ready pair (A clip + B clip)
 * is scored by Gemini on a 4-dimension rubric; the winner is computed
 * DETERMINISTICALLY from the scores (never trusted from the model's own
 * "winner" output). Clips are uploaded through the Gemini Files API first —
 * HTTPS fileUri passthrough is unsupported on the Developer API. Degraded
 * pairs auto-win the surviving variant and judge failures default to A; in
 * BOTH cases the winner is marked winner_source='default' with a
 * gemini_scores.judge_error marker (only truly judged pairs get 'gemini').
 * Failed pairs are skipped (operator regenerates at checkpoint A).
 *
 * Gemini conventions mirror lib/providers/gemini-judge.ts: @google/genai,
 * GEMINI_API_KEY ?? GOOGLE_API_KEY, responseMimeType 'application/json',
 * temperature 0.1, fence-stripping, geminiCostCents pricing, cost_event on
 * failure too (stage 'qc', metadata.delivery_run_id).
 */

import { GoogleGenAI } from '@google/genai';
import { getSupabase } from '../client.js';
import { recordCostEvent, log, updatePropertyStatus } from '../db.js';
import { geminiCostCents } from '../providers/gemini-judge.js';
import { uploadVideoToGeminiFiles, deleteGeminiFile, type UploadedGeminiFile } from '../providers/gemini-files.js';
import { getRun, getVariantsForRun, advanceRun, updateRun } from './runs.js';
import { variantPairStatus } from './variants.js';
import { withJudgeRetry } from '../judge/retry.js';
import type { SceneVariantRow, DeliveryRunRow } from '../types/operator-studio.js';

const AB_JUDGE_MODEL_DEFAULT = 'gemini-2.5-flash';

export interface VariantScores {
  motion_quality: number;
  artifacts: number;
  realism: number;
  composition: number;
}

export function scoreTotal(s: VariantScores): number {
  return s.motion_quality + s.artifacts + s.realism + s.composition;
}

/** Deterministic winner: higher total; tie -> A; missing side loses. */
export function pickWinner(a: VariantScores | null, b: VariantScores | null): 'A' | 'B' {
  if (!b) return 'A';
  if (!a) return 'B';
  return scoreTotal(b) > scoreTotal(a) ? 'B' : 'A';
}

export function parseJudgeJson(raw: string): { a: VariantScores | null; b: VariantScores | null } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`A/B judge returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const p = parsed as { a?: VariantScores; b?: VariantScores };
  return { a: p.a ?? null, b: p.b ?? null };
}

const AB_SYSTEM_PROMPT = `You compare two AI-generated real-estate video clips (A then B) rendered from the same source photo and prompt.
Score EACH clip 1-5 on: motion_quality (smooth, intentional camera motion), artifacts (5 = none), realism (faithful to the photographed space, no invented geometry), composition.
Return ONLY JSON: {"a":{"motion_quality":n,"artifacts":n,"realism":n,"composition":n},"b":{...}}`;

export async function judgePair(
  clipA: string,
  clipB: string,
  prompt: string,
  runId: string,
  sceneId: string,
  propertyId: string | null,
): Promise<{ a: VariantScores | null; b: VariantScores | null }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY required for A/B judge');
  const model = process.env.AB_JUDGE_MODEL ?? AB_JUDGE_MODEL_DEFAULT;
  const genai = new GoogleGenAI({ apiKey });
  // fileData.fileUri does NOT accept HTTPS passthrough on the Developer API
  // (GCS/Files-API/YouTube only — see gemini-analyzer.ts). Clips must be
  // uploaded via the Files API first; an upload/processing failure throws,
  // which the caller marks winner_source='default' — never silently judge
  // against the raw URL.
  let fileA: UploadedGeminiFile | null = null;
  let fileB: UploadedGeminiFile | null = null;
  try {
    fileA = await uploadVideoToGeminiFiles(genai, clipA);
    fileB = await uploadVideoToGeminiFiles(genai, clipB);
    const resp = await genai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { text: `Director prompt: ${prompt}\nClip A is the first video, clip B the second. Score both.` },
          { fileData: { fileUri: fileA.uri, mimeType: fileA.mimeType } },
          { fileData: { fileUri: fileB.uri, mimeType: fileB.mimeType } },
        ],
      }],
      config: { systemInstruction: AB_SYSTEM_PROMPT, responseMimeType: 'application/json', temperature: 0.1 },
    });
    // Text extraction mirrors gemini-judge.ts (resp.text with candidates fallback).
    const rawText =
      resp.text ??
      (resp as unknown as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ??
      '';
    const scores = parseJudgeJson(rawText);
    const usage = (resp as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    const costCents = geminiCostCents(model, usage?.promptTokenCount ?? 0, usage?.candidatesTokenCount ?? 0);
    await recordCostEvent({
      propertyId, sceneId, stage: 'qc', provider: 'google',
      unitsConsumed: 1, unitType: 'tokens', costCents,
      metadata: {
        delivery_run_id: runId, scene_id: sceneId, subtype: 'ab_judge', judge_model: model,
        prompt_tokens: usage?.promptTokenCount ?? 0, output_tokens: usage?.candidatesTokenCount ?? 0,
      },
    }).catch((e) => console.error('[delivery/judge] cost_event failed:', e));
    return scores;
  } catch (err) {
    // Failure still writes a cost_event (gemini-judge.ts convention) so any
    // partial API consumption stays visible during reconciliation.
    await recordCostEvent({
      propertyId, sceneId, stage: 'qc', provider: 'google',
      unitsConsumed: 1, unitType: 'tokens', costCents: 0,
      metadata: {
        delivery_run_id: runId, scene_id: sceneId, subtype: 'ab_judge',
        judge_error: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => {});
    throw err;
  } finally {
    // Best-effort cleanup; uploaded files auto-expire in 48h regardless.
    if (fileA) await deleteGeminiFile(genai, fileA.name);
    if (fileB) await deleteGeminiFile(genai, fileB.name);
  }
}

/** True for the expected CAS/state-machine concurrency noise from advanceRun
 *  ('stage moved' = lost the CAS; 'illegal transition' = another actor already
 *  advanced between our getRun and the CAS). Anything else is a real error. */
function isBenignAdvanceRace(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /stage moved|illegal transition/.test(msg);
}

/**
 * Judge pass — invoked by the poll-scenes cron once a delivery property's
 * scenes settle (and re-attempted via sweepActiveJudgePasses while B variants
 * are still in flight). Returns {ready:false} while any pair is still pending
 * (next tick retries). On completion: winners set (winner_source='gemini'
 * for judged pairs, 'default' + gemini_scores.judge_error for degraded /
 * judge-failure pairs), draft order stored on the run, stage -> checkpoint_a.
 */
export async function runJudgePass(runId: string): Promise<{ ready: boolean }> {
  const supabase = getSupabase();
  const run = await getRun(runId);
  if (!run) throw new Error(`runJudgePass: run not found: ${runId}`);
  if (run.stage !== 'generating' && run.stage !== 'judging') return { ready: true }; // already past

  const variants = await getVariantsForRun(runId);
  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, scene_number, photo_id, prompt, clip_url, generation_cost_cents, status')
    .eq('property_id', run.property_id);

  // Sync A rows from the scenes table (the scene IS variant A — Task 10
  // creates the row at submit time; this is where its clip_url lands).
  for (const scene of scenes ?? []) {
    const a = variants.find((v) => v.scene_id === scene.id && v.variant === 'A');
    if (!a) continue;
    if (!a.clip_url && scene.clip_url) {
      await supabase.from('scene_variants')
        .update({ clip_url: scene.clip_url, cost_cents: scene.generation_cost_cents ?? null, updated_at: new Date().toISOString() })
        .eq('id', a.id);
      a.clip_url = scene.clip_url as string;
    } else if (!a.clip_url && !a.error && scene.status === 'needs_review') {
      // Scene render terminally failed (needs_review with no clip). Without
      // this, variantPairStatus sees the A row as in-flight forever and the
      // run stalls in 'generating'. Mark it degraded so the pair settles.
      await supabase.from('scene_variants')
        .update({ error: 'scene render failed (needs_review, no clip)', degraded: true, updated_at: new Date().toISOString() })
        .eq('id', a.id);
      a.error = 'scene render failed (needs_review, no clip)';
      (a as SceneVariantRow).degraded = true;
    }
  }

  // All pairs must be settled (ready/degraded/failed — not pending). A run
  // with NO variant rows yet (submission still in flight) is never judged.
  const judgeable = (scenes ?? []).filter((s) => variants.some((v) => v.scene_id === s.id));
  const pairs = judgeable.map((s) => ({
    scene: s,
    a: variants.find((v) => v.scene_id === s.id && v.variant === 'A') ?? null,
    b: variants.find((v) => v.scene_id === s.id && v.variant === 'B') ?? null,
  }));
  if (pairs.length === 0) return { ready: false };
  if (pairs.some((p) => variantPairStatus(p.a, p.b) === 'pending')) return { ready: false };

  if (run.stage === 'generating') {
    try {
      await advanceRun(runId, 'judging');
    } catch (err) {
      if (!isBenignAdvanceRace(err)) throw err;
    }
  }

  for (const { scene, a, b } of pairs) {
    const status = variantPairStatus(a, b);
    if (status === 'failed') continue; // operator regenerates at checkpoint A
    // Preserve a manual operator winner pick: once the operator has flipped the
    // winner for this pair (winner_source='operator'), a re-judge — the cron
    // sweep, a Back-to-judging, or an explicit Rerun — must NOT silently
    // overwrite that deliberate choice. Leave the pair exactly as set.
    if (a?.winner_source === 'operator' || b?.winner_source === 'operator') continue;
    let winner: 'A' | 'B';
    // winner_source='gemini' is reserved for pairs Gemini ACTUALLY watched.
    // Anything that wins without judging (degraded pair, judge failure) is
    // marked winner_source='default' + a judge_error marker in gemini_scores
    // so ML training can exclude unjudged pairs.
    let winnerSource: 'gemini' | 'default' = 'gemini';
    let judgeError: string | null = null;
    if (status === 'degraded') {
      winner = a?.clip_url ? 'A' : 'B';
      winnerSource = 'default';
      judgeError = 'degraded pair — no judging possible';
    } else {
      try {
        // withJudgeRetry retries transient Gemini failures (429/5xx/network)
        // up to 3 times with exponential backoff before letting the error
        // propagate to the catch block below. Only after all retries are
        // exhausted (or on a permanent error) does winner default to A.
        const scores = await withJudgeRetry(() =>
          judgePair(a!.clip_url!, b!.clip_url!, String(scene.prompt ?? ''), runId, scene.id as string, run.property_id)
        );
        await supabase.from('scene_variants').update({ gemini_scores: scores.a, updated_at: new Date().toISOString() }).eq('id', a!.id);
        await supabase.from('scene_variants').update({ gemini_scores: scores.b, updated_at: new Date().toISOString() }).eq('id', b!.id);
        winner = pickWinner(scores.a, scores.b);
      } catch (err) {
        // Judge failure degrades gracefully: A wins by DEFAULT (not a Gemini
        // verdict), error preserved on the row for ML exclusion.
        await log(run.property_id, 'qc', 'warn',
          `A/B judge failed for scene ${scene.scene_number}; defaulting winner=A: ${err instanceof Error ? err.message : String(err)}`,
          { delivery_run_id: runId }, scene.id as string);
        winner = 'A';
        winnerSource = 'default';
        judgeError = err instanceof Error ? err.message : String(err);
      }
    }
    const winnerRow = winner === 'A' ? a : b;
    const loserRow = winner === 'A' ? b : a;
    if (winnerRow) {
      const update: Record<string, unknown> = { winner: true, winner_source: winnerSource, updated_at: new Date().toISOString() };
      if (judgeError !== null) update.gemini_scores = { judge_error: judgeError };
      await supabase.from('scene_variants').update(update).eq('id', winnerRow.id);
    }
    if (loserRow) {
      await supabase.from('scene_variants')
        .update({ winner: false, updated_at: new Date().toISOString() })
        .eq('id', loserRow.id);
    }
  }

  // Draft order (Task 12's helper) + advance.
  const { draftOrderForRun } = await import('./order.js');
  const order = await draftOrderForRun(runId);
  await updateRun(runId, { scene_order: order } as Partial<DeliveryRunRow>);
  try {
    await advanceRun(runId, 'checkpoint_a');
  } catch (err) {
    if (!isBenignAdvanceRace(err)) throw err;
  }
  await log(run.property_id, 'qc', 'info', `A/B judging complete; ${order.length} winners ordered; checkpoint A ready`, { delivery_run_id: runId });
  return { ready: true };
}

/**
 * Cron sweep: re-attempt judge passes for runs still in generating/judging.
 *
 * Needed because poll-scenes' finalize loop only fires for properties that
 * had PENDING scene rows this tick — once every A clip is collected, the
 * property drops out of that loop, but B variants typically land later via
 * pollPendingVariants. Without this sweep the run would stall in
 * 'generating' forever. runJudgePass self-guards (returns ready:false while
 * pairs are pending), so calling it every tick is safe.
 *
 * On completion, mirrors the finalize-loop gate's property flip to
 * needs_review (skipped when the property already reached a terminal state).
 */
export async function sweepActiveJudgePasses(): Promise<{ swept: number; advanced: number }> {
  const supabase = getSupabase();
  const { data: runs } = await supabase
    .from('delivery_runs')
    .select('id, property_id, stage')
    .in('stage', ['generating', 'judging']);
  let advanced = 0;
  for (const run of runs ?? []) {
    try {
      const { ready } = await runJudgePass(run.id as string);
      if (!ready) continue;
      advanced++;
      const { data: prop } = await supabase
        .from('properties')
        .select('status, created_at, pipeline_started_at')
        .eq('id', run.property_id)
        .maybeSingle();
      if (!prop || prop.status === 'complete' || prop.status === 'failed' || prop.status === 'needs_review') continue;
      const startTs = (prop as { pipeline_started_at?: string | null }).pipeline_started_at ?? prop.created_at;
      const { data: scenes } = await supabase
        .from('scenes').select('clip_url').eq('property_id', run.property_id);
      await updatePropertyStatus(run.property_id, 'needs_review', {
        processing_time_ms: Date.now() - new Date(startTs as string).getTime(),
        thumbnail_url: (scenes ?? []).find((s) => s.clip_url)?.clip_url ?? null,
      } as never);
    } catch (err) {
      console.error(`[delivery/judge] sweep failed for run ${run.id}:`, err);
    }
  }
  return { swept: (runs ?? []).length, advanced };
}
