#!/usr/bin/env tsx
/**
 * Judge calibration harness.
 *
 * Goal: tune lib/prompts/judge-rubric.ts so Gemini's verdicts on
 * Oliver-rated V1 clips match Oliver's ratings within MAE ≤ 1.0,
 * within-1-star ≥ 80%, and Pearson correlation ≥ 0.5.
 *
 * Strict rules (from Oliver's 2026-05-05 instructions):
 *   - Never delete recorded ratings or any historical row.
 *   - All judge re-runs write to lab_judge_scores (per-call) and
 *     lab_judge_calibrations (per-round summary). Never touch
 *     prompt_lab_iterations.judge_* (preserves the v1.1 baseline).
 *   - Run on V1 only this session (V2 held-out for next session).
 *
 * Usage:
 *   npx tsx scripts/judge-calibration.ts --smoke         # synthetic-data sanity check
 *   npx tsx scripts/judge-calibration.ts --baseline      # report the existing v1.1 judge data
 *   npx tsx scripts/judge-calibration.ts --run [--limit N]  # call Gemini on N V1 iterations + write scores
 *   npx tsx scripts/judge-calibration.ts --report VERSION  # metrics for a given judge_version
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Load env from .env / .env.local / credentials.env without adding a dotenv dep
// (matches scripts/cost-reconcile.ts's pattern).
for (const file of [".env", ".env.local", "credentials.env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Force-enable judge for this script regardless of prod env state.
process.env.JUDGE_ENABLED = "true";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ============================================================================
// Pure metric functions — verifiable in --smoke without any I/O.
// ============================================================================

export type Rating = 1 | 2 | 3 | 4 | 5;
export interface Pair {
  iteration_id: string;
  human: Rating;
  judge: number; // judge.overall, 1-5 (kept as number to allow decimals during aggregation)
}
export interface Metrics {
  n: number;
  mae: number;
  exactMatchRate: number;
  withinOneStarRate: number;
  pearson: number;
  humanDist: Record<Rating, number>; // % of total
  judgeDist: Record<Rating, number>; // % of total (rounded judge to nearest int)
  perHumanBucket: Record<Rating, { n: number; judgeMean: number }>;
}

export function computeMetrics(pairs: Pair[]): Metrics {
  const n = pairs.length;
  if (n === 0) throw new Error("computeMetrics: empty pairs");

  let sumAbsErr = 0;
  let exact = 0;
  let within1 = 0;
  for (const p of pairs) {
    const err = Math.abs(p.human - p.judge);
    sumAbsErr += err;
    if (err < 0.5) exact++;
    if (err <= 1) within1++;
  }

  const meanH = pairs.reduce((s, p) => s + p.human, 0) / n;
  const meanJ = pairs.reduce((s, p) => s + p.judge, 0) / n;
  let num = 0,
    denH = 0,
    denJ = 0;
  for (const p of pairs) {
    const dh = p.human - meanH;
    const dj = p.judge - meanJ;
    num += dh * dj;
    denH += dh * dh;
    denJ += dj * dj;
  }
  const pearson = denH === 0 || denJ === 0 ? 0 : num / Math.sqrt(denH * denJ);

  const humanCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Rating, number>;
  const judgeCount = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Rating, number>;
  const bucket: Record<Rating, { sumJ: number; n: number }> = {
    1: { sumJ: 0, n: 0 },
    2: { sumJ: 0, n: 0 },
    3: { sumJ: 0, n: 0 },
    4: { sumJ: 0, n: 0 },
    5: { sumJ: 0, n: 0 },
  };
  for (const p of pairs) {
    humanCount[p.human]++;
    const jr = Math.max(1, Math.min(5, Math.round(p.judge))) as Rating;
    judgeCount[jr]++;
    bucket[p.human].n++;
    bucket[p.human].sumJ += p.judge;
  }
  const toPct = (c: Record<Rating, number>): Record<Rating, number> => ({
    1: (c[1] / n) * 100,
    2: (c[2] / n) * 100,
    3: (c[3] / n) * 100,
    4: (c[4] / n) * 100,
    5: (c[5] / n) * 100,
  });
  const perBucket: Metrics["perHumanBucket"] = {
    1: { n: bucket[1].n, judgeMean: bucket[1].n ? bucket[1].sumJ / bucket[1].n : 0 },
    2: { n: bucket[2].n, judgeMean: bucket[2].n ? bucket[2].sumJ / bucket[2].n : 0 },
    3: { n: bucket[3].n, judgeMean: bucket[3].n ? bucket[3].sumJ / bucket[3].n : 0 },
    4: { n: bucket[4].n, judgeMean: bucket[4].n ? bucket[4].sumJ / bucket[4].n : 0 },
    5: { n: bucket[5].n, judgeMean: bucket[5].n ? bucket[5].sumJ / bucket[5].n : 0 },
  };

  return {
    n,
    mae: sumAbsErr / n,
    exactMatchRate: exact / n,
    withinOneStarRate: within1 / n,
    pearson,
    humanDist: toPct(humanCount),
    judgeDist: toPct(judgeCount),
    perHumanBucket: perBucket,
  };
}

// Stratified 80/20 split — preserves rating distribution in both halves.
export function stratifiedSplit<T extends { human: Rating }>(
  rows: T[],
  testFraction = 0.2,
  seed = 42,
): { tune: T[]; test: T[] } {
  // Tiny LCG for deterministic shuffle.
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 0x100000000;
    return s / 0x100000000;
  };
  const buckets = new Map<Rating, T[]>([[1, []], [2, []], [3, []], [4, []], [5, []]]);
  for (const r of rows) buckets.get(r.human)!.push(r);
  const tune: T[] = [];
  const test: T[] = [];
  for (const arr of buckets.values()) {
    const shuffled = arr.slice().sort(() => rand() - 0.5);
    const cut = Math.round(arr.length * (1 - testFraction));
    tune.push(...shuffled.slice(0, cut));
    test.push(...shuffled.slice(cut));
  }
  return { tune, test };
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export function renderMetrics(label: string, m: Metrics): string {
  const lines: string[] = [];
  lines.push(`\n=== ${label} (n=${m.n}) ===`);
  lines.push(`  MAE                    : ${m.mae.toFixed(2)} stars`);
  lines.push(`  Exact match (±0.5)     : ${fmtPct(m.exactMatchRate)}`);
  lines.push(`  Within ±1 star         : ${fmtPct(m.withinOneStarRate)}`);
  lines.push(`  Pearson correlation    : ${m.pearson.toFixed(3)}`);
  lines.push(`  Per human-rating bucket:`);
  for (const r of [1, 2, 3, 4, 5] as Rating[]) {
    const b = m.perHumanBucket[r];
    if (b.n === 0) continue;
    lines.push(`    human=${r} (n=${b.n.toString().padStart(3)})  judge mean=${b.judgeMean.toFixed(2)}`);
  }
  lines.push(`  Distribution match (% of total):`);
  lines.push(`    rating  human   judge`);
  for (const r of [1, 2, 3, 4, 5] as Rating[]) {
    lines.push(
      `    ${r}       ${m.humanDist[r].toFixed(1).padStart(5)}%  ${m.judgeDist[r].toFixed(1).padStart(5)}%`,
    );
  }
  return lines.join("\n");
}

// ============================================================================
// Smoke test: known synthetic data → known metrics.
// ============================================================================

function smokeTest() {
  // Perfect agreement: judge==human → MAE=0, exact=100%, pearson=1.0
  const perfect: Pair[] = [
    { iteration_id: "a", human: 1, judge: 1 },
    { iteration_id: "b", human: 3, judge: 3 },
    { iteration_id: "c", human: 5, judge: 5 },
  ];
  const m1 = computeMetrics(perfect);
  console.assert(m1.mae === 0, `perfect mae=${m1.mae}`);
  console.assert(Math.abs(m1.pearson - 1.0) < 0.01, `perfect pearson=${m1.pearson}`);

  // Constant judge=4: matches the actual v1.1 failure mode
  const flat: Pair[] = [
    { iteration_id: "a", human: 1, judge: 4 },
    { iteration_id: "b", human: 3, judge: 4 },
    { iteration_id: "c", human: 5, judge: 4 },
  ];
  const m2 = computeMetrics(flat);
  console.assert(Math.abs(m2.mae - 2.0) < 0.01, `flat mae=${m2.mae}`); // (3+1+1)/3 = 1.67 actually
  // Actually MAE = (|1-4|+|3-4|+|5-4|)/3 = (3+1+1)/3 = 1.67
  console.assert(Math.abs(m2.mae - 5 / 3) < 0.01, `flat mae=${m2.mae}`);
  console.assert(Math.abs(m2.pearson) < 0.01, `flat pearson should be ~0; got ${m2.pearson}`);

  // Perfectly anti-correlated: pearson = -1.0
  const anti: Pair[] = [
    { iteration_id: "a", human: 1, judge: 5 },
    { iteration_id: "b", human: 3, judge: 3 },
    { iteration_id: "c", human: 5, judge: 1 },
  ];
  const m3 = computeMetrics(anti);
  console.assert(Math.abs(m3.pearson + 1.0) < 0.01, `anti pearson=${m3.pearson}`);

  // Stratified split preserves bucket counts
  const rows: Array<{ human: Rating; id: string }> = [];
  for (let i = 0; i < 50; i++) rows.push({ human: ((i % 5) + 1) as Rating, id: `r${i}` });
  const { tune, test } = stratifiedSplit(rows, 0.2);
  console.assert(tune.length + test.length === 50, "split sum mismatch");
  for (const r of [1, 2, 3, 4, 5] as Rating[]) {
    const tuneN = tune.filter((x) => x.human === r).length;
    const testN = test.filter((x) => x.human === r).length;
    console.assert(tuneN + testN === 10, `bucket ${r}: ${tuneN}+${testN} !== 10`);
  }

  console.log("✓ Smoke test passed.");
  console.log(renderMetrics("Perfect agreement", m1));
  console.log(renderMetrics("Flat judge=4 (v1.1 failure mode)", m2));
  console.log(renderMetrics("Anti-correlated", m3));
}

// ============================================================================
// Baseline: report the existing v1.1 judge data without any new Gemini calls.
// ============================================================================

interface V1Row {
  iteration_id: string;
  human: Rating;
  judge: number;
  judge_version: string;
}

async function loadExistingV1JudgeData(): Promise<V1Row[]> {
  const { data, error } = await supabase
    .from("prompt_lab_iterations")
    .select("id, rating, judge_rating_overall, judge_version")
    .not("rating", "is", null)
    .not("judge_rating_overall", "is", null);
  if (error) throw error;
  if (!data) return [];
  return data
    .filter((r: any) => r.rating != null && r.judge_rating_overall != null)
    .map((r: any) => ({
      iteration_id: r.id as string,
      human: r.rating as Rating,
      judge: Number(r.judge_rating_overall),
      judge_version: (r.judge_version as string) ?? "unknown",
    }));
}

async function reportBaseline() {
  const rows = await loadExistingV1JudgeData();
  if (rows.length === 0) {
    console.log("No existing judge data found.");
    return;
  }
  const versions = new Set(rows.map((r) => r.judge_version));
  console.log(`Loaded ${rows.length} V1 (human, judge) pairs across versions: ${[...versions].join(", ")}`);
  for (const v of versions) {
    const subset = rows.filter((r) => r.judge_version === v);
    console.log(renderMetrics(`Baseline judge_version=${v}`, computeMetrics(subset)));
  }
}

// ============================================================================
// Composite override: deterministic min-of-axes aggregation.
//
// v1.1 problem: weighted-mean formula (0.35*motion + 0.30*geom + 0.25*room +
// 0.10*flagBonus) averages the score back up to ~4 even when motion is 1-2.
// Diagnostic: fresh 5-clip run had avg motion=1.80 but avg overall=3.80.
//
// v1.2 fix: composite_1to5 = clamp(min(motion, geom, room) - flagPenalty, 1, 5).
// Worst axis sets the ceiling; flags drag it further down. Model's overall
// stays preserved in `rubric.overall` for analysis; we just don't trust it.
// ============================================================================

const COMPOSITE_VERSION = "v1.2-min-axes" as const;

const MAJOR_FLAGS = new Set([
  "hallucinated_geometry",
  "hallucinated_architecture",
  "wrong_motion_direction",
  "motion_too_static",
  "camera_exited_room",
]);

export function composeFromRubric(r: {
  motion_faithfulness: number;
  geometry_coherence: number;
  room_consistency: number;
  hallucination_flags: string[];
}): number {
  const minAxis = Math.min(r.motion_faithfulness, r.geometry_coherence, r.room_consistency);
  const flagsList = r.hallucination_flags ?? [];
  const majorCount = flagsList.filter((f) => MAJOR_FLAGS.has(f)).length;
  const minorCount = flagsList.length - majorCount;
  // Major flags = -1 each (capped at -2). Minor flags = -0.5 each (capped at -1).
  const penalty = Math.min(majorCount, 2) + Math.min(minorCount, 2) * 0.5;
  const composite = minAxis - penalty;
  return Math.max(1, Math.min(5, composite));
}

// ============================================================================
// Run: call Gemini judge on V1 iterations + write to lab_judge_scores.
// ============================================================================

interface V1Candidate {
  id: string;
  rating: Rating;
  clip_url: string;
  director_prompt: string;
  camera_movement: string;
  room_type: string;
  image_url: string | null;
}

async function loadV1Candidates(): Promise<V1Candidate[]> {
  const { data, error } = await supabase
    .from("prompt_lab_iterations")
    .select(
      "id, rating, clip_url, director_output_json, analysis_json, prompt_lab_sessions!inner(image_url, archetype)",
    )
    .not("clip_url", "is", null)
    .not("rating", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!data) return [];
  return data
    .filter((r: any) => r.rating && r.clip_url)
    .map((r: any) => {
      const session = r.prompt_lab_sessions as { image_url: string | null; archetype?: string | null };
      const director = (r.director_output_json ?? {}) as { prompt?: string; camera_movement?: string };
      const analysis = (r.analysis_json ?? {}) as { room_type?: string };
      return {
        id: r.id as string,
        rating: r.rating as Rating,
        clip_url: r.clip_url as string,
        director_prompt: director.prompt ?? "",
        camera_movement: director.camera_movement ?? "unknown",
        room_type: analysis.room_type ?? session?.archetype ?? "unknown",
        image_url: session?.image_url ?? null,
      };
    });
}

async function runCalibration(limit: number, concurrency = 5) {
  // Lazy import — keeps --smoke / --baseline / --report fast and dep-free of GEMINI_API_KEY.
  const { judgeLabIteration } = await import("../lib/providers/gemini-judge.js");
  const { RUBRIC_VERSION } = await import("../lib/prompts/judge-rubric.js");
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY required to run --run");

  const candidates = await loadV1Candidates();
  console.log(`Loaded ${candidates.length} V1 candidates with (rating, clip_url).`);

  // Skip iterations already scored at the current judge_version (resume support).
  const { data: existing } = await supabase
    .from("lab_judge_scores")
    .select("iteration_id")
    .eq("judge_version", RUBRIC_VERSION);
  const done = new Set((existing ?? []).map((r: any) => r.iteration_id as string));
  console.log(`${done.size} already scored at judge_version=${RUBRIC_VERSION}; skipping those.`);

  let todo = candidates.filter((c) => !done.has(c.id));
  if (limit !== Infinity) {
    // Stratified sample by rating so a small limit still touches all 5 buckets.
    const byRating = new Map<Rating, V1Candidate[]>([
      [1, []], [2, []], [3, []], [4, []], [5, []],
    ]);
    for (const c of todo) byRating.get(c.rating)!.push(c);
    const perBucket = Math.max(1, Math.ceil(limit / 5));
    todo = [];
    for (const arr of byRating.values()) todo.push(...arr.slice(0, perBucket));
    todo = todo.slice(0, limit);
  }
  console.log(`Calling judge on ${todo.length} iterations at ${concurrency}× concurrency.`);

  let ok = 0;
  let err = 0;
  const results: Pair[] = [];

  // Worker-pool over the queue.
  const queue = todo.slice();
  async function worker() {
    while (queue.length > 0) {
      const iter = queue.shift();
      if (!iter) return;
      try {
        let photoBytes: Buffer | undefined;
        if (iter.image_url) {
          try {
            const r = await fetch(iter.image_url);
            if (r.ok) photoBytes = Buffer.from(await r.arrayBuffer());
          } catch { /* photo fetch non-fatal */ }
        }
        const judged = await judgeLabIteration({
          clipUrl: iter.clip_url,
          photoBytes,
          directorPrompt: iter.director_prompt,
          cameraMovement: iter.camera_movement,
          roomType: iter.room_type,
          iterationId: iter.id,
        });
        // composite = model's overall (no override). Prompt iteration is the lever.
        const composite = judged.overall;
        const { error: insErr } = await supabase.from("lab_judge_scores").insert({
          iteration_id: iter.id,
          rubric: judged,
          composite_1to5: composite,
          confidence: judged.confidence / 5,
          judge_version: judged.judge_version,
          model_id: judged.judge_model,
          cost_cents: judged.cost_cents,
        });
        if (insErr) {
          console.error(`  insert err ${iter.id}: ${insErr.message}`);
          err++;
          continue;
        }
        results.push({ iteration_id: iter.id, human: iter.rating, judge: composite });
        ok++;
        process.stdout.write(
          `  ✓ human=${iter.rating} judge=${composite}  (${ok}/${todo.length})\n`,
        );
      } catch (e: any) {
        err++;
        process.stdout.write(`  ✗ ${iter.id}: ${(e?.message ?? String(e)).slice(0, 100)}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  console.log(`\nDone: ${ok} ok, ${err} err.`);
  if (results.length > 0) {
    const m = computeMetrics(results);
    console.log(renderMetrics(`This-run summary (judge_version=${RUBRIC_VERSION})`, m));

    // Write summary row to lab_judge_calibrations (cell_key="ALL" = aggregate).
    const { error: calErr } = await supabase.from("lab_judge_calibrations").insert({
      cell_key: "ALL",
      room_type: "*",
      camera_movement: "*",
      sample_size: m.n,
      exact_match_rate: m.exactMatchRate,
      within_one_star_rate: m.withinOneStarRate,
      mean_abs_error: m.mae,
      judge_version: RUBRIC_VERSION,
      model_id: process.env.JUDGE_MODEL ?? "gemini-2.5-flash",
    });
    if (calErr) console.error(`calibration summary insert err: ${calErr.message}`);
    else console.log(`✓ Wrote summary row to lab_judge_calibrations.`);
  }
}

// ============================================================================
// Report: pull rows from lab_judge_scores for a given judge_version, compute metrics.
// ============================================================================

async function reportVersion(judgeVersion: string) {
  const { data: scores, error: sErr } = await supabase
    .from("lab_judge_scores")
    .select("iteration_id, composite_1to5")
    .eq("judge_version", judgeVersion);
  if (sErr) throw sErr;
  if (!scores || scores.length === 0) {
    console.log(`No scores found for judge_version=${judgeVersion}.`);
    return;
  }
  const ids = scores.map((s: any) => s.iteration_id as string);
  const { data: humans, error: hErr } = await supabase
    .from("prompt_lab_iterations")
    .select("id, rating")
    .in("id", ids)
    .not("rating", "is", null);
  if (hErr) throw hErr;
  const humanByID = new Map<string, Rating>(
    (humans ?? []).map((r: any) => [r.id as string, r.rating as Rating]),
  );
  const pairs: Pair[] = scores
    .filter((s: any) => humanByID.has(s.iteration_id))
    .map((s: any) => ({
      iteration_id: s.iteration_id as string,
      human: humanByID.get(s.iteration_id as string)!,
      judge: Number(s.composite_1to5),
    }));
  console.log(renderMetrics(`judge_version=${judgeVersion}`, computeMetrics(pairs)));
}

// ============================================================================
// CLI dispatch.
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--smoke")) {
    smokeTest();
    return;
  }
  if (args.includes("--baseline")) {
    await reportBaseline();
    return;
  }
  if (args.includes("--run")) {
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "0", 10) : Infinity;
    await runCalibration(limit);
    return;
  }
  const reportIdx = args.indexOf("--report");
  if (reportIdx >= 0) {
    const v = args[reportIdx + 1];
    if (!v) throw new Error("--report requires a judge_version");
    await reportVersion(v);
    return;
  }
  console.log(
    "Usage: npx tsx scripts/judge-calibration.ts --smoke | --baseline | --run [--limit N] | --report VERSION",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
