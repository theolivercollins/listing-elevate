/**
 * One-off: add up-correction calibration examples to balance the 38 already-
 * inserted down-correct seeds. Pulls from prompt_lab_iterations rows where
 * Oliver rated ≥4★ but judge said ≤3 — these tell the judge "this clip is
 * actually good; you under-rated it" (the opposite signal from the down-corr).
 *
 * v1.5-fewshot at n=25 over-corrected DOWN (per-bucket means dropped 0.6-0.8
 * across all human ratings, including the 5★ bucket) because the calibration
 * set was only low-end. With both directions covered, the few-shot signal
 * should be selective rather than global.
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

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const dryRun = !process.argv.includes("--write");
console.log(dryRun ? "DRY RUN (use --write to insert)" : "WRITE MODE");

const { data: rows, error } = await sb
  .from("prompt_lab_iterations")
  .select("id, rating, judge_rating_overall, judge_rating_json, director_output_json, analysis_json, prompt_lab_sessions!inner(archetype)")
  .not("rating", "is", null)
  .not("judge_rating_overall", "is", null);
if (error) throw error;

const upCorr = (rows ?? []).filter((r: any) => Number(r.rating) >= 4 && Number(r.judge_rating_overall) <= 3);
console.log(`up-correct candidates: ${upCorr.length}`);

const { data: existing } = await sb.from("judge_calibration_examples").select("iteration_id");
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

function buildUpCorrection(judge: JudgeRubric, humanRating: number): JudgeRubric {
  // Up-correct: Oliver ≥4, judge ≤3. The clip is fundamentally fine — the
  // judge under-rated overall. Preserve the judge's per-axis values (which
  // probably already had at least one axis at 3-4) and override only what
  // matters: overall + reasoning. Drop any motion-defect flag the judge
  // added, since Oliver's high rating implies motion executed correctly.
  const flags = (judge.hallucination_flags ?? []).filter(
    (f) => f !== "motion_too_static" && f !== "too_slow" && f !== "wrong_motion_direction" &&
           f !== "overshoot_target" && f !== "undershoot_target" && f !== "other_motion_defect",
  );
  return {
    // Bump motion_faithfulness up to humanRating only if it's currently low
    // enough to require a defect flag (i.e. ≤2). Otherwise leave it.
    motion_faithfulness: judge.motion_faithfulness <= 2 ? (humanRating as 1|2|3|4|5) : judge.motion_faithfulness,
    geometry_coherence: judge.geometry_coherence,
    room_consistency: judge.room_consistency,
    hallucination_flags: flags as JudgeRubric["hallucination_flags"],
    confidence: 5,
    reasoning: `Oliver rated this ${humanRating}★ overall. Judge's ${judge.overall}★ verdict was deflated. The motion verb executed correctly and the clip is high-quality — use this as a calibration anchor: when execution is this clean, overall must reflect it.`,
    overall: humanRating as 1|2|3|4|5,
  };
}

const newRows: any[] = [];
let skippedNoJudgeJson = 0;
for (const r of upCorr as any[]) {
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
    oliver_correction_json: buildUpCorrection(judgeJson, Number(r.rating)),
    correction_reason: `Auto-derived up-correction from prompt_lab_iterations.rating (${r.rating}★) on 2026-05-06; judge said ${judgeJson.overall}★. v1.5-fewshot-balanced calibration seed.`,
    room_type: roomType,
    camera_movement: cameraMovement,
  });
}

console.log(`\n${newRows.length} new rows to insert (${skippedNoJudgeJson} skipped — missing judge_rating_json)`);

const byBucket = new Map<string, number>();
for (const r of newRows) byBucket.set(`${r.room_type}/${r.camera_movement}`, (byBucket.get(`${r.room_type}/${r.camera_movement}`) ?? 0) + 1);
console.log("by bucket:");
for (const [k, n] of [...byBucket].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

if (newRows.length === 0) { console.log("\nnothing to insert."); process.exit(0); }
if (dryRun) {
  console.log("\nfirst row preview:");
  console.log(JSON.stringify(newRows[0], null, 2));
  console.log("\nrerun with --write to insert.");
  process.exit(0);
}

const { error: iErr } = await sb.from("judge_calibration_examples").insert(newRows);
if (iErr) { console.error(iErr); process.exit(1); }
console.log(`✓ inserted ${newRows.length} up-correction rows.`);
