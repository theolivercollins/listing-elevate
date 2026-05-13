import * as fs from "fs";
import * as path from "path";
const envPath = path.join("/Users/oliverhelgemo/listing-elevate/.env");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
);

async function main() {
  console.log("=================================================================");
  console.log("PROMPT-COLLAPSE FIX — POST-DEPLOY VERIFICATION");
  console.log("=================================================================");

  // ── PROD PROMPT BODY ──
  const { data: rev } = await sb.from("prompt_revisions")
    .select("version, body_hash, source, source_override_id, created_at")
    .eq("prompt_name", "director").eq("source", "lab_promotion")
    .order("version", { ascending: false }).limit(1);
  console.log("\n[A] Active prod director prompt:");
  if (rev?.[0]) {
    console.log(`    ✓ version=${rev[0].version} source=lab_promotion hash=${rev[0].body_hash}`);
    console.log(`      → patched body (c0708a98) is what prod resolves on every render`);
  } else {
    console.log("    ✗ NO lab_promotion row — prod is using baseline compile-time DIRECTOR_SYSTEM");
  }

  // ── LATEST PROPERTY RENDER ──
  const { data: props } = await sb.from("properties")
    .select("id, status, created_at, updated_at")
    .order("created_at", { ascending: false }).limit(1);
  if (!props?.[0]) { console.log("\nNo properties found at all."); return; }
  const p = props[0];
  console.log(`\n[B] Most recent property: ${p.id}`);
  console.log(`    status=${p.status}  created=${p.created_at}  updated=${p.updated_at}`);

  // ── SIGNAL 1 — Director prompt resolution ──
  const { data: resolveLog } = await sb.from("pipeline_logs")
    .select("created_at, message")
    .eq("property_id", p.id)
    .ilike("message", "Director prompt resolved from lab promotion%")
    .order("created_at", { ascending: false }).limit(1);
  console.log("\n[1] Did prod pick up the patched director prompt?");
  if (resolveLog?.[0]) console.log(`    ✓ ${resolveLog[0].message}  (${resolveLog[0].created_at})`);
  else console.log(`    — no row found. Either: (a) render predates deploy, or (b) resolution silently fell back to compile-time baseline.`);

  // ── SIGNAL 2 — Per-photo retrieval fired ──
  const { data: retrievalLog } = await sb.from("pipeline_logs")
    .select("created_at, message")
    .eq("property_id", p.id)
    .ilike("message", "Per-photo retrieval:%")
    .order("created_at", { ascending: false }).limit(1);
  console.log("\n[2] Did per-photo retrieval fire & find recipes/exemplars?");
  if (retrievalLog?.[0]) {
    const m = retrievalLog[0].message;
    const mm = m.match(/(\d+)\/(\d+) photos got retrieval blocks \((\d+) recipes, (\d+) exemplars, (\d+) losers\)/);
    if (mm) {
      const [, hit, total, recipes, exemplars, losers] = mm;
      console.log(`    ✓ ${hit}/${total} photos got retrieval blocks`);
      console.log(`      recipes=${recipes}  exemplars=${exemplars}  losers=${losers}`);
      if (Number(recipes) + Number(exemplars) + Number(losers) === 0) {
        console.log(`    ⚠ EMPTY bundles — prod photos likely lack image_embedding. Backfill needed:`);
        console.log(`      pnpm exec tsx scripts/backfill-image-embeddings.ts --target photos --write`);
      } else if (Number(hit) < Number(total)) {
        console.log(`    ⚠ ${Number(total) - Number(hit)} photos returned empty bundles (missing image_embedding for those rows)`);
      }
    } else {
      console.log(`    — ${m}`);
    }
  } else {
    console.log(`    — no row found. Render either predates deploy or didn't reach scripting stage yet.`);
  }

  // ── SIGNAL 3 — DA.3 prompt rewrite (only if overrides fired) ──
  const { data: da3Logs } = await sb.from("pipeline_logs")
    .select("created_at, message, metadata")
    .eq("property_id", p.id)
    .ilike("message", "DA.3 override:%")
    .order("created_at", { ascending: false }).limit(5);
  console.log("\n[3] DA.3 prompt-rewrite (only fires when validator overrides motion):");
  if (!da3Logs?.length) console.log(`    — no DA.3 overrides on this render (normal — only fires on motion_headroom violations)`);
  else for (const r of da3Logs) {
    const md = r.metadata as { original_prompt?: string; rewritten_prompt?: string; original?: string; replacement?: string } | null;
    console.log(`    ✓ ${r.message}`);
    if (md?.rewritten_prompt) {
      console.log(`        original_prompt:  "${md.original_prompt?.slice(0, 80)}"`);
      console.log(`        rewritten_prompt: "${md.rewritten_prompt?.slice(0, 80)}"`);
    } else {
      console.log(`        ⚠ metadata.rewritten_prompt missing — prompt-rewrite guard didn't deploy correctly`);
    }
  }

  // ── SIGNAL 4 — Motion variety in scene table ──
  const { data: scenes } = await sb.from("scenes")
    .select("scene_number, camera_movement, prompt")
    .eq("property_id", p.id).order("scene_number");
  console.log(`\n[4] Motion variety in scene table (the actual quality signal):`);
  if (!scenes?.length) console.log(`    — no scenes yet`);
  else {
    const counts: Record<string, number> = {};
    for (const s of scenes) counts[s.camera_movement] = (counts[s.camera_movement] ?? 0) + 1;
    const distinct = Object.keys(counts).length;
    const maxCount = Math.max(...Object.values(counts));
    console.log(`    ${scenes.length} scenes, ${distinct} distinct camera_movements, max ${maxCount}× same motion`);
    for (const [m, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const flag = n > 3 ? "  ⚠ over-clustered" : "";
      console.log(`      ${n}× ${m}${flag}`);
    }
    const verdict =
      distinct >= 5 && maxCount <= 3 ? "✓ HEALTHY (≥5 motions, no motion >3×)" :
      distinct >= 4 ? "~ marginal" : "✗ STILL COLLAPSED";
    console.log(`    verdict: ${verdict}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
