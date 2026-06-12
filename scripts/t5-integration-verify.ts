#!/usr/bin/env -S npx tsx
/**
 * scripts/t5-integration-verify.ts
 *
 * T5 integration verification (2026-06-11).
 *
 * Calls buildCreatomateConcatScript from the SHIPPED code path to generate a
 * 2880x1620 RenderScript, submits it to Creatomate via /v2/renders (same body
 * shape as submitRenderScript), ffprobes the output, and asserts bitrate >= 11 Mbps.
 *
 * Writes one cost_event with:
 *   metadata.probe = '2026-06-11-assembly-quality'
 *   metadata.test  = true
 *   metadata.step  = 't5-integration-verify'
 *
 * Gate: output bitrate must be >= T5_GATE_MBPS (11 Mbps) - same threshold the
 * adversarial panel required for Gate A (Creatomate supersampling path).
 *
 * Usage:
 *   LE_ALLOW_NONPROD_WRITES=true \
 *     /path/to/repo/node_modules/.bin/tsx scripts/t5-integration-verify.ts
 *
 * Estimated cost: ~$0.50-$1.70 (2x5s clips at 2880x1620 for ~10s duration).
 * Budget ceiling: T5_BUDGET_CAP_CENTS (150c = $1.50 - hard abort before submit).
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Load .env from repo root (worktree shares the root .env via the parent dir)
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const envPath = path.resolve(scriptDir, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

import { recordCostEvent } from "../lib/db.js";
import {
  buildCreatomateConcatScript,
  creatomateCostCents,
} from "../lib/providers/creatomate.js";

// --- Constants ---------------------------------------------------------------

const T5_GATE_MBPS = 11;
const T5_BUDGET_CAP_CENTS = 200; // 171c estimate for 10s @ 2880x1620; cap at $2 // hard abort if estimated cost exceeds this
const PROBE_META = {
  probe: "2026-06-11-assembly-quality",
  test: true,
  step: "t5-integration-verify",
} as const;

// Same two clips used in P2a/P2b -- stored in Supabase Storage, publicly accessible.
const CLIP_1 =
  "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/a30212b2-088a-40a2-9c7a-f4ec16d04e45/clips/scene_1_v1.mp4";
const CLIP_2 =
  "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/a30212b2-088a-40a2-9c7a-f4ec16d04e45/variants/scene_2_B.mp4";

const SESSION_DOC = path.resolve(
  scriptDir,
  "..",
  "docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md",
);

// --- ffprobe -----------------------------------------------------------------

interface FfprobeResult {
  width: number;
  height: number;
  fps: number;
  videoBitrateMbps: number;
  codec: string;
  durationSeconds: number;
}

async function ffprobeUrl(url: string, label: string): Promise<FfprobeResult> {
  console.log(`  [ffprobe] downloading ${label} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ffprobe fetch failed HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(
    os.tmpdir(),
    `t5-probe-${Date.now()}-${label.replace(/[^a-z0-9]/gi, "_")}.mp4`,
  );
  fs.writeFileSync(tmp, buf);
  try {
    const out = spawnSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,bit_rate,codec_name,duration",
        "-of", "json",
        tmp,
      ],
      { encoding: "utf8" },
    );
    if (out.status !== 0)
      throw new Error(`ffprobe exited ${out.status ?? "?"}: ${out.stderr}`);
    const parsed = JSON.parse(out.stdout) as {
      streams: Array<{
        width?: number;
        height?: number;
        r_frame_rate?: string;
        bit_rate?: string;
        codec_name?: string;
        duration?: string;
      }>;
    };
    const s = parsed.streams[0] ?? {};
    const [fn, fd] = (s.r_frame_rate ?? "24/1").split("/").map(Number);
    const fps = fd ? fn / fd : fn;
    return {
      width: s.width ?? 0,
      height: s.height ?? 0,
      fps,
      videoBitrateMbps: s.bit_rate ? parseInt(s.bit_rate, 10) / 1e6 : 0,
      codec: s.codec_name ?? "?",
      durationSeconds: parseFloat(s.duration ?? "0"),
    };
  } finally {
    fs.unlinkSync(tmp);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- Creatomate polling -------------------------------------------------------

async function pollCreatomate(
  id: string,
  apiKey: string,
): Promise<{ url: string; durationSeconds: number }> {
  const deadline = Date.now() + 360_000;
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const r = await fetch(`https://api.creatomate.com/v2/renders/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`Creatomate poll: ${r.status}`);
    const d = (await r.json()) as {
      status: string;
      url?: string;
      duration?: number;
      error_message?: string;
    };
    console.log(`  [creatomate] ${id.slice(0, 8)}: ${d.status} (#${n})`);
    if (d.status === "succeeded") {
      if (!d.url) throw new Error("Creatomate succeeded but no URL");
      return { url: d.url, durationSeconds: d.duration ?? 0 };
    }
    if (d.status === "failed")
      throw new Error(`Creatomate render failed: ${d.error_message ?? "unknown"}`);
    await sleep(8_000);
  }
  throw new Error(`Creatomate ${id} timed out after 360s`);
}

// --- main --------------------------------------------------------------------

async function main(): Promise<void> {
  if (
    process.env.VERCEL_ENV !== "production" &&
    process.env.LE_ALLOW_NONPROD_WRITES !== "true"
  ) {
    console.error(
      "ABORT: Set LE_ALLOW_NONPROD_WRITES=true to write cost_events locally.",
    );
    process.exit(1);
  }

  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) throw new Error("CREATOMATE_API_KEY not set");

  // Step 1: build RenderScript via the SHIPPED function
  console.log("\n=== T5: buildCreatomateConcatScript -> Creatomate v2/renders ===");
  const renderScript = buildCreatomateConcatScript([CLIP_1, CLIP_2], "16:9");
  console.log(
    `  Shipped canvas: ${renderScript.width}x${renderScript.height} (ASSEMBLY_SUPERSAMPLE=${process.env.ASSEMBLY_SUPERSAMPLE ?? "unset -> default 1.5"})`,
  );

  if (renderScript.width !== 2880 || renderScript.height !== 1620) {
    throw new Error(
      `ASSERTION FAILED: expected 2880x1620 canvas from shipped code, got ${renderScript.width}x${renderScript.height}. Check ASSEMBLY_SUPERSAMPLE env var.`,
    );
  }
  console.log("  Canvas assertion: 2880x1620 PASS");

  // Budget safety: estimate cost before submitting
  const estimatedCents = creatomateCostCents(10, "16:9");
  console.log(`  Estimated cost: ${estimatedCents}c ($${(estimatedCents / 100).toFixed(2)})`);
  if (estimatedCents > T5_BUDGET_CAP_CENTS) {
    throw new Error(
      `ABORT: estimated cost ${estimatedCents}c exceeds T5 cap ${T5_BUDGET_CAP_CENTS}c`,
    );
  }

  // Step 2: submit via /v2/renders (same body shape as submitRenderScript)
  console.log("  Submitting to Creatomate /v2/renders ...");
  const submitBody = { ...renderScript, render_scale: 1 };
  const r = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submitBody),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Creatomate submit failed: ${r.status} ${err}`);
  }
  const d = (await r.json()) as { id?: string } | Array<{ id?: string }>;
  const render = Array.isArray(d) ? d[0] : d;
  if (!render?.id) throw new Error("Creatomate submit returned no ID");
  const renderId = render.id;
  console.log(`  Render ID: ${renderId}`);

  // Step 3: poll
  const { url, durationSeconds } = await pollCreatomate(renderId, apiKey);
  console.log(`  Output URL: ${url}`);
  console.log(`  Duration: ${durationSeconds.toFixed(2)}s`);

  // Step 4: ffprobe
  const probe = await ffprobeUrl(url, "t5-creatomate-2880x1620");
  console.log(
    `  ffprobe: ${probe.width}x${probe.height} ${probe.fps.toFixed(2)}fps ${probe.videoBitrateMbps.toFixed(2)} Mbps (${probe.codec})`,
  );

  // Step 5: write cost_event
  const actualCents = creatomateCostCents(
    durationSeconds > 0 ? durationSeconds : 10,
    "16:9",
  );
  await recordCostEvent({
    propertyId: null,
    stage: "assembly",
    provider: "creatomate",
    unitsConsumed: 1,
    unitType: "renders",
    costCents: actualCents,
    metadata: {
      ...PROBE_META,
      canvas: `${renderScript.width}x${renderScript.height}`,
      renderId,
      measuredBitrateMbps: parseFloat(probe.videoBitrateMbps.toFixed(2)),
      outputResolution: `${probe.width}x${probe.height}`,
      durationSeconds: parseFloat(durationSeconds.toFixed(2)),
    },
  });
  console.log(`  cost_event written: ${actualCents}c`);

  // Step 6: gate
  const gatePass = probe.videoBitrateMbps >= T5_GATE_MBPS;
  const resolutionPass = probe.width === 2880 && probe.height === 1620;

  console.log(`\n=== T5 Gate Verdict ===`);
  console.log(`  Resolution: ${probe.width}x${probe.height} (expected 2880x1620): ${resolutionPass ? "PASS" : "FAIL"}`);
  console.log(`  Bitrate: ${probe.videoBitrateMbps.toFixed(2)} Mbps (threshold >=11 Mbps): ${gatePass ? "PASS" : "FAIL"}`);

  // Step 7: append to session doc
  const verdictStr = gatePass && resolutionPass
    ? "PASS -- shipped code path confirmed at >=11 Mbps 2880x1620"
    : "FAIL -- see numbers below";

  const addendum = [
    "",
    "---",
    "",
    `## Addendum (2026-06-11, t5-integration-verify.ts): shipped code path probe`,
    "",
    `**T5 Gate verdict: ${verdictStr}**  `,
    `Cost_event written: ${actualCents}c ($${(actualCents / 100).toFixed(2)})  `,
    "Cost events queryable: `SELECT * FROM cost_events WHERE metadata->>'probe' = '2026-06-11-assembly-quality' AND metadata->>'step' = 't5-integration-verify';`",
    "",
    "### T5 probe -- buildCreatomateConcatScript path (2880x1620)",
    "",
    `- Clips: scene_1_v1.mp4 + scene_2_B.mp4 (same San Massimo lab clips as P2a/P2b)`,
    `- Canvas from shipped buildCreatomateConcatScript: ${renderScript.width}x${renderScript.height}`,
    `- Render ID: ${renderId}`,
    `- Output URL: ${url}`,
    `- **Resolution: ${probe.width}x${probe.height}** (expected 2880x1620: **${resolutionPass ? "PASS" : "FAIL"}**)`,
    `- FPS: ${probe.fps.toFixed(2)}, Codec: ${probe.codec}, Duration: ${probe.durationSeconds.toFixed(2)}s`,
    `- **Video bitrate: ${probe.videoBitrateMbps.toFixed(2)} Mbps** (threshold >=11 Mbps: **${gatePass ? "PASS" : "FAIL"}**)`,
    `- Cost: ${actualCents}c`,
    "",
    "### Quality progression summary (before -> after)",
    "",
    `| Render | Canvas | Bitrate | Status |`,
    `|---|---|---|---|`,
    `| Diagnosed run (before fix) | 1920x1080 | 5.96 Mbps | baseline problem |`,
    `| P2a probe (same-day baseline) | 1920x1080 | 9.91 Mbps | measured |`,
    `| P2b probe (1.5x supersample) | 2880x1620 | 19.18 Mbps | Gate A PASS |`,
    `| **T5 shipped path** | **2880x1620** | **${probe.videoBitrateMbps.toFixed(2)} Mbps** | **${gatePass && resolutionPass ? "PASS" : "FAIL"}** |`,
    "",
  ].join("\n");

  fs.appendFileSync(SESSION_DOC, addendum, "utf8");
  console.log("  [doc] appended to docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md");

  if (!gatePass || !resolutionPass) {
    console.error("\nT5 FAILED: gate not met -- do not promote branch");
    process.exit(1);
  }

  console.log(
    `\nT5 COMPLETE: ${probe.videoBitrateMbps.toFixed(2)} Mbps at ${probe.width}x${probe.height} -- shipped code path confirmed.`,
  );
  console.log(`Cost: ${actualCents}c | Render ID: ${renderId}`);
}

main().catch((e) => {
  console.error("T5 FAILED:", e);
  process.exit(1);
});
