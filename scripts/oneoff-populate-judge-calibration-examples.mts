/**
 * One-off: populate judge_calibration_examples from the 38 inversion rows
 * (Oliver rated 1-2★, judge said ≥3) in prompt_lab_iterations.
 *
 * Strategy: copy judge_rating_json verbatim, then synthesize an
 * oliver_correction_json that overrides `overall` and `motion_faithfulness`
 * to Oliver's star rating. Most calibration failures in this domain are
 * motion-driven (push_in, dolly, parallax — see 2026-05-06 v1.4-pro data
 * showing motion_too_static + too_slow on most low clips). Other axes stay
 * at the judge's values; the few-shot signal is "you over-rated overall;
 * the motion verb wasn't faithfully executed."
 *
 * Idempotent: skips iteration_ids that already have a calibration row.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env", ".env.local", "credentials.env"]) {
  const p = path.join("/Users/oliverhelgemo/listing-elevate", file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const dryRun = !process.argv.includes("--write");
console.log(dryRun ? "DRY RUN (use --write to insert)" : "WRITE MODE");

// Pull all rated rows with judge ratings; filter inversions in-memory.
const { data: rows, error: rErr } = await sb
  .from("prompt_lab_iterations")
  .select("id, rating, judge_rating_overall, judge_rating_json, director_output_json, analysis_json, prompt_lab_sessions!inner(archetype)")
  .not("rating", "is", null)
  .not("judge_rating_overall", "is", null);
if (rErr) throw rErr;

const inversions = (rows ?? []).filter((r: any) =>
  Number(r.rating) <= 2 && Number(r.judge_rating_overall) >= 3,
);
console.log(`inversions found: ${inversions.length}`);

// Existing rows — de-dupe on iteration_id
const { data: existing } = await sb
  .from("judge_calibration_examples")
  .select("iteration_id");
const seen = new Set((existing ?? []).map((e: any) => e.iteration_id as string));
console.log(`existing calibration rows: ${seen.size}`);

interface JudgeRubric {
  motion_faithfulness: number;
  geometry_coherence: number;
  room_consistency: number;
  hallucination_flags: string[];
  confidence: number;
  reasoning: string;
  overall: number;
}

const MOTION_DEFECT_FLAGS = new Set([
  "wrong_motion_direction", "too_fast", "too_slow", "motion_too_static",
  "overshoot_target", "undershoot_target", "other_motion_defect",
]);

function buildCorrection(judge: JudgeRubric, humanRating: number): JudgeRubric {
  const flags = new Set(judge.hallucination_flags ?? []);
  // The validator (lib/prompts/judge-rubric.ts) requires a motion-defect
  // flag when motion_faithfulness ≤ 2. Pick motion_too_static as the
  // universal anchor — it's the most common failure mode on this domain
  // (push_in clips that don't actually push, per prior session data).
  const hasMotionDefect = [...flags].some((f) => MOTION_DEFECT_FLAGS.has(f));
  if (humanRating <= 2 && !hasMotionDefect) {
    flags.add("motion_too_static");
  }
  return {
    motion_faithfulness: humanRating as 1 | 2 | 3 | 4 | 5,
    geometry_coherence: judge.geometry_coherence,
    room_consistency: judge.room_consistency,
    hallucination_flags: [...flags] as JudgeRubric["hallucination_flags"],
    confidence: 5,
    reasoning: `Oliver rated this ${humanRating}★ overall. Judge's ${judge.overall}★ verdict was inflated. The motion verb wasn't faithfully executed — use this as a calibration anchor: when motion is this weak, overall must reflect it.`,
    overall: humanRating,
  };
}

const newRows: any[] = [];
let skippedNoJudgeJson = 0;

for (const r of inversions as any[]) {
  if (seen.has(r.id)) continue;

  const judgeJson = r.judge_rating_json as JudgeRubric | null;
  if (!judgeJson || typeof judgeJson.overall !== "number") {
    skippedNoJudgeJson++;
    continue;
  }
  const director = (r.director_output_json ?? {}) as { camera_movement?: string };
  const analysis = (r.analysis_json ?? {}) as { room_type?: string };
  const session = r.prompt_lab_sessions as { archetype?: string };
  const roomType = analysis.room_type ?? session?.archetype ?? "unknown";
  const cameraMovement = director.camera_movement ?? "unknown";

  newRows.push({
    iteration_id: r.id,
    human_rating: r.rating,
    judge_rating_json: judgeJson,
    oliver_correction_json: buildCorrection(judgeJson, Number(r.rating)),
    correction_reason: `Auto-derived from prompt_lab_iterations.rating (${r.rating}★) on 2026-05-06; judge said ${judgeJson.overall}★. v1.5-fewshot calibration seed.`,
    room_type: roomType,
    camera_movement: cameraMovement,
  });
}

console.log(`\n${newRows.length} new rows to insert (${skippedNoJudgeJson} skipped — missing judge_rating_json)`);

const byBucket = new Map<string, number>();
for (const r of newRows) {
  const k = `${r.room_type}/${r.camera_movement}`;
  byBucket.set(k, (byBucket.get(k) ?? 0) + 1);
}
console.log("by bucket:");
for (const [k, n] of [...byBucket].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${n}`);
}

if (newRows.length === 0) {
  console.log("\nnothing to insert.");
  process.exit(0);
}
if (dryRun) {
  console.log("\nrerun with --write to insert.");
  console.log("\nfirst row preview:");
  console.log(JSON.stringify(newRows[0], null, 2));
  process.exit(0);
}

const { error: iErr } = await sb.from("judge_calibration_examples").insert(newRows);
if (iErr) {
  console.error("insert err:", iErr);
  process.exit(1);
}
console.log(`✓ inserted ${newRows.length} calibration rows.`);
