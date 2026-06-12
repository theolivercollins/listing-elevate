#!/usr/bin/env -S npx tsx
/**
 * scripts/probe-assembly-bitrate.ts
 *
 * Phase 0 measurement — assembly-quality investigation (2026-06-11).
 *
 * Three paid probes, each writing cost_events with
 *   metadata.probe = '2026-06-11-assembly-quality' and metadata.test = true
 *
 * P1 (~48¢): ONE Atlas kling-v3-pro render from a 16:9-cropped source image.
 * P2 (~13¢ + ~28¢): Creatomate 2-clip concat at 1920×1080 then 2880×1620.
 * P3 (~20¢): Shotstack quality:'high' 2-clip concat at 1080p/fps:24.
 *
 * Gate A: 1.5× Creatomate ≥ 11 Mbps AND bpp_ratio ≥ 0.8× baseline.
 * Gate B (only if A fails): Shotstack ≥ 10 Mbps.
 *
 * Usage:
 *   LE_ALLOW_NONPROD_WRITES=true \
 *     /path/to/repo/node_modules/.bin/tsx scripts/probe-assembly-bitrate.ts
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Load .env from repo root
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
import { ATLAS_MODELS, atlasClipCostCents } from "../lib/providers/atlas.js";
import { ensureSourceAspectRatio } from "../lib/services/source-aspect.js";
import { creatomateCostCents } from "../lib/providers/creatomate.js";
import { shotstackCostCents, resolveShotstackConfig } from "../lib/providers/shotstack.js";

const PROBE_META = { probe: "2026-06-11-assembly-quality", test: true } as const;

// San Massimo stored clips (2026-06-11 run)
const CLIP_1 = "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/a30212b2-088a-40a2-9c7a-f4ec16d04e45/clips/scene_1_v1.mp4";
const CLIP_2 = "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-videos/a30212b2-088a-40a2-9c7a-f4ec16d04e45/variants/scene_2_B.mp4";

// Source images for P1 (paired scene 1 start+end photos)
const P1_SOURCE = "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/3daba7bf-b6af-4142-8c99-2b0bc3b9a3ac/raw/1781202324207_8_zzDJI_20260520092802_0583_D.jpg";
const P1_END = "https://vrhmaeywqsohlztoouxu.supabase.co/storage/v1/object/public/property-photos/3daba7bf-b6af-4142-8c99-2b0bc3b9a3ac/raw/1781202322513_0_1IMG_0093__1_.jpg";

const BUDGET_CAP_CENTS = 170;
const GATE_A_MBPS = 11;
const GATE_A_BPP_RATIO = 0.8;
const GATE_B_MBPS = 10;

// ─── ffprobe ──────────────────────────────────────────────────────────────────

interface FfprobeResult {
  width: number; height: number; fps: number;
  videoBitrateMbps: number; codec: string; durationSeconds: number;
}

async function ffprobeUrl(url: string, label: string): Promise<FfprobeResult> {
  console.log(`  [ffprobe] downloading ${label} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ffprobe fetch failed HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(os.tmpdir(), `probe-${Date.now()}-${label.replace(/[^a-z0-9]/gi,"_")}.mp4`);
  fs.writeFileSync(tmp, buf);
  try {
    const out = spawnSync("ffprobe", [
      "-v","error","-select_streams","v:0",
      "-show_entries","stream=width,height,r_frame_rate,bit_rate,codec_name,duration",
      "-of","json", tmp,
    ], { encoding: "utf8" });
    if (out.status !== 0) throw new Error(`ffprobe exited ${out.status}: ${out.stderr}`);
    const parsed = JSON.parse(out.stdout) as { streams: Array<{ width?:number; height?:number; r_frame_rate?:string; bit_rate?:string; codec_name?:string; duration?:string }> };
    const s = parsed.streams[0] ?? {};
    const [fn, fd] = (s.r_frame_rate ?? "24/1").split("/").map(Number);
    const fps = fd ? fn/fd : fn;
    return {
      width: s.width ?? 0, height: s.height ?? 0, fps,
      videoBitrateMbps: s.bit_rate ? parseInt(s.bit_rate,10)/1e6 : 0,
      codec: s.codec_name ?? "?",
      durationSeconds: parseFloat(s.duration ?? "0"),
    };
  } finally {
    fs.unlinkSync(tmp);
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Creatomate ───────────────────────────────────────────────────────────────

async function submitCreatomate(clips: string[], w: number, h: number): Promise<string> {
  const key = process.env.CREATOMATE_API_KEY;
  if (!key) throw new Error("CREATOMATE_API_KEY not set");
  const body = { output_format:"mp4", width:w, height:h, duration:null, elements:clips.map(source=>({type:"video",source,track:1})), render_scale:1 };
  const r = await fetch("https://api.creatomate.com/v2/renders", { method:"POST", headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (!r.ok) throw new Error(`Creatomate submit failed: ${r.status} ${await r.text()}`);
  const d = (await r.json()) as { id?: string };
  if (!d.id) throw new Error("Creatomate: no render ID");
  return d.id;
}

async function pollCreatomate(id: string): Promise<{ url: string; durationSeconds: number }> {
  const key = process.env.CREATOMATE_API_KEY!;
  const deadline = Date.now() + 360_000;
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const r = await fetch(`https://api.creatomate.com/v2/renders/${id}`, { headers:{ Authorization:`Bearer ${key}` } });
    if (!r.ok) throw new Error(`Creatomate poll: ${r.status}`);
    const d = (await r.json()) as { status:string; url?:string; duration?:number; error_message?:string };
    console.log(`  [creatomate] ${id.slice(0,8)}: ${d.status} (#${n})`);
    if (d.status === "succeeded") { if (!d.url) throw new Error("no URL"); return { url: d.url, durationSeconds: d.duration ?? 0 }; }
    if (d.status === "failed") throw new Error(`Creatomate failed: ${d.error_message}`);
    await sleep(8_000);
  }
  throw new Error(`Creatomate ${id} timed out`);
}

// ─── Shotstack ────────────────────────────────────────────────────────────────

async function submitShotstack(clips: string[]): Promise<{ jobId: string; environment: "stage"|"v1" }> {
  const { environment, apiKey } = resolveShotstackConfig();
  const baseUrl = `https://api.shotstack.io/edit/${environment}`;
  const payload = {
    timeline: { background:"#000000", tracks:[{ clips:clips.map(src=>({ asset:{ type:"video", src }, start:"auto", length:"auto" })) }] },
    output: { format:"mp4", resolution:"1080", aspectRatio:"16:9", quality:"high", fps:24 },
  };
  const r = await fetch(`${baseUrl}/render`, { method:"POST", headers:{"x-api-key":apiKey,"Content-Type":"application/json"}, body:JSON.stringify(payload) });
  if (!r.ok) throw new Error(`Shotstack submit: ${r.status} ${await r.text()}`);
  const d = (await r.json()) as { success:boolean; response?:{ id:string } };
  if (!d.success || !d.response?.id) throw new Error(`Shotstack rejected: ${JSON.stringify(d)}`);
  return { jobId: d.response.id, environment };
}

async function pollShotstack(jobId: string, env: "stage"|"v1"): Promise<{ url:string; durationSeconds:number }> {
  const { apiKey } = resolveShotstackConfig();
  const baseUrl = `https://api.shotstack.io/edit/${env}`;
  const deadline = Date.now() + 360_000;
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const r = await fetch(`${baseUrl}/render/${jobId}`, { headers:{"x-api-key":apiKey} });
    if (!r.ok) throw new Error(`Shotstack poll: ${r.status}`);
    const d = (await r.json()) as { success:boolean; response?:{ status:string; url?:string; duration?:number; error?:string } };
    const rr = d.response;
    if (!rr) throw new Error("Empty Shotstack response");
    console.log(`  [shotstack] ${jobId.slice(0,8)}: ${rr.status} (#${n})`);
    if (rr.status === "done") { if (!rr.url) throw new Error("no URL"); return { url:rr.url, durationSeconds:rr.duration ?? 0 }; }
    if (rr.status === "failed") throw new Error(`Shotstack failed: ${rr.error}`);
    await sleep(8_000);
  }
  throw new Error(`Shotstack ${jobId} timed out`);
}

// ─── Atlas poll ───────────────────────────────────────────────────────────────

async function pollAtlas(jobId: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + 360_000;
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    const r = await fetch(`https://api.atlascloud.ai/api/v1/model/prediction/${jobId}`, { headers:{ Authorization:`Bearer ${apiKey}` } });
    if (!r.ok) throw new Error(`Atlas poll: HTTP ${r.status}`);
    const d = (await r.json()) as { code:number; data?: { status?:string; outputs?:unknown }|null };
    const status = d.data?.status ?? "unknown";
    console.log(`  [atlas] ${status} (#${n})`);
    if (status === "succeeded" || status === "completed" || status === "success") {
      const outputs = d.data?.outputs as Array<string|{url?:string}>|{url?:string}|string|null|undefined;
      let url: string|null = null;
      if (typeof outputs === "string") url = outputs;
      else if (Array.isArray(outputs)) { const f=outputs[0]; url = typeof f==="string"?f:(f as {url?:string})?.url??null; }
      else if (outputs && typeof outputs === "object") url = (outputs as {url?:string}).url??null;
      if (!url) throw new Error(`Atlas job ${jobId} completed with no output URL`);
      return url;
    }
    if (status === "failed" || status === "error") throw new Error(`Atlas job ${jobId} failed`);
    await sleep(10_000);
  }
  throw new Error(`Atlas ${jobId} timed out`);
}

// ─── addendum writer ──────────────────────────────────────────────────────────

function writeAddendum(lines: string[], totalCents: number, gateA?: boolean, gateB?: boolean|null): void {
  const verdict =
    gateA === true  ? "Gate A PASS — Creatomate supersampling selected" :
    gateB === true  ? "Gate A FAIL, Gate B PASS — Shotstack for code-gen assembly" :
    gateB === false ? "Gate A FAIL, Gate B FAIL — STOP, escalate to Oliver" :
                     "INCOMPLETE — budget cap hit before all gates evaluated";

  const docPath = path.resolve(scriptDir, "..", "docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md");
  const text = [
    "", "---", "",
    "## Addendum (2026-06-11, probe-assembly-bitrate.ts): paid probe results",
    "",
    `**Gate verdict: ${verdict}**  `,
    `Total probe spend: ${totalCents}¢ ($${(totalCents/100).toFixed(2)}) of $1.70 authorized budget  `,
    "Cost events queryable: `SELECT * FROM cost_events WHERE metadata->>'probe' = '2026-06-11-assembly-quality';`",
    "",
    ...lines, "",
  ].join("\n");

  fs.appendFileSync(docPath, text, "utf8");
  console.log("\nAddendum written → docs/sessions/2026-06-11-assembly-quality-drop-diagnosis.md");
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV !== "production" && process.env.LE_ALLOW_NONPROD_WRITES !== "true") {
    console.error("ABORT: Set LE_ALLOW_NONPROD_WRITES=true to write cost_events locally.");
    process.exit(1);
  }

  let totalCents = 0;
  const lines: string[] = [];

  // ── P1: Atlas kling-v3-pro ────────────────────────────────────────────────
  console.log("\n=== P1: Atlas kling-v3-pro (16:9-cropped source) ===");
  const atlasKey = process.env.ATLASCLOUD_API_KEY;
  if (!atlasKey) throw new Error("ATLASCLOUD_API_KEY not set");

  console.log("  Cropping source images to 16:9...");
  const croppedStart = await ensureSourceAspectRatio(P1_SOURCE);
  const croppedEnd   = await ensureSourceAspectRatio(P1_END);
  console.log(`  start: ${croppedStart.slice(-60)}`);
  console.log(`  end:   ${croppedEnd.slice(-60)}`);

  const klingDesc = ATLAS_MODELS["kling-v3-pro"];
  const atlasBody = {
    model: klingDesc.slug, image: croppedStart, end_image: croppedEnd,
    prompt: "Smooth cinematic dolly across exterior of a luxury home at golden hour, stable camera, photorealistic",
    duration: 5, aspect_ratio: "16:9",
    negative_prompt: "shaky camera, handheld, wobble, vibration, jitter, camera shake, rolling shutter",
  };

  console.log("  Submitting to Atlas...");
  const atlasSubmit = await fetch("https://api.atlascloud.ai/api/v1/model/generateVideo", {
    method: "POST",
    headers: { Authorization: `Bearer ${atlasKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(atlasBody),
  });
  const atlasResp = (await atlasSubmit.json()) as { code:number; message?:string; msg?:string; data?:{ id?:string }|null };
  if (atlasResp.code !== 200 || !atlasResp.data?.id) {
    throw new Error(`Atlas submit failed: code=${atlasResp.code} ${atlasResp.message ?? atlasResp.msg}`);
  }
  const atlasJobId = atlasResp.data.id;
  console.log(`  Job: ${atlasJobId}`);

  const p1Url = await pollAtlas(atlasJobId, atlasKey);
  console.log(`  URL: ${p1Url}`);

  const p1 = await ffprobeUrl(p1Url, "P1-atlas-kling-v3-pro");
  console.log(`  ${p1.width}x${p1.height} ${p1.fps.toFixed(2)}fps ${p1.videoBitrateMbps.toFixed(2)} Mbps (${p1.codec})`);

  const p1Cost = atlasClipCostCents("kling-v3-pro", 5);
  await recordCostEvent({ propertyId: null, stage:"generation", provider:"atlas", unitsConsumed:1, unitType:"renders", costCents:p1Cost, metadata:{ ...PROBE_META, model:"kling-v3-pro", jobId:atlasJobId, outputResolution:`${p1.width}x${p1.height}` } });
  totalCents += p1Cost;
  console.log(`  Cost: ${p1Cost}¢ | total: ${totalCents}¢`);

  const p1Pass = Math.abs(p1.width-1920)<=8 && Math.abs(p1.height-1080)<=8;
  lines.push("### P1 — Atlas kling-v3-pro (16:9-cropped source, 5s)");
  lines.push(`- Source: 16:9-cropped via ensureSourceAspectRatio (drone exterior + paired end photo)`);
  lines.push(`- Atlas job: ${atlasJobId}`);
  lines.push(`- Output URL: ${p1Url}`);
  lines.push(`- **Resolution: ${p1.width}×${p1.height}** (1920×1080 ±8px → **${p1Pass?"PASS":"FAIL"}**)`);
  lines.push(`- FPS: ${p1.fps.toFixed(2)}, Codec: ${p1.codec}, Duration: ${p1.durationSeconds.toFixed(2)}s`);
  lines.push(`- **Video bitrate: ${p1.videoBitrateMbps.toFixed(2)} Mbps**`);
  lines.push(`- Cost: ${p1Cost}¢`);
  lines.push(`- Adversarial panel live-probe requirement: **${p1Pass?"CLOSED — 16:9 source → 1920×1080 confirmed":"OPEN — unexpected resolution"}`);

  if (totalCents >= BUDGET_CAP_CENTS) { writeAddendum(lines, totalCents); return; }

  // ── P2a: Creatomate 1920×1080 ────────────────────────────────────────────
  console.log("\n=== P2a: Creatomate 1920×1080 (baseline) ===");
  const p2aId = await submitCreatomate([CLIP_1, CLIP_2], 1920, 1080);
  console.log(`  Render: ${p2aId}`);
  const { url: p2aUrl, durationSeconds: p2aDur } = await pollCreatomate(p2aId);
  const p2a = await ffprobeUrl(p2aUrl, "P2a-creatomate-1080p");
  console.log(`  ${p2a.width}x${p2a.height} ${p2a.fps.toFixed(2)}fps ${p2a.videoBitrateMbps.toFixed(2)} Mbps`);

  const p2aCost = creatomateCostCents(p2aDur > 0 ? p2aDur : 10);
  await recordCostEvent({ propertyId:null, stage:"assembly", provider:"creatomate", unitsConsumed:1, unitType:"renders", costCents:p2aCost, metadata:{ ...PROBE_META, canvas:"1920x1080", renderId:p2aId, measuredBitrateMbps:parseFloat(p2a.videoBitrateMbps.toFixed(2)) } });
  totalCents += p2aCost;
  console.log(`  Cost: ${p2aCost}¢ | total: ${totalCents}¢`);

  lines.push("\n### P2a — Creatomate 1920×1080 concat (baseline)");
  lines.push(`- Clips: scene_1_v1.mp4 + scene_2_B.mp4`);
  lines.push(`- Canvas: 1920×1080, render_scale:1, duration:null`);
  lines.push(`- Render ID: ${p2aId}`);
  lines.push(`- Output URL: ${p2aUrl}`);
  lines.push(`- **Resolution: ${p2a.width}×${p2a.height}**, FPS: ${p2a.fps.toFixed(2)}, Codec: ${p2a.codec}`);
  lines.push(`- **Video bitrate: ${p2a.videoBitrateMbps.toFixed(2)} Mbps** (duration: ${p2aDur.toFixed(2)}s)`);
  lines.push(`- Creatomate credit charge (est. at ${process.env.CREATOMATE_CENTS_PER_MINUTE??'76'}¢/min): ${p2aCost}¢`);

  if (totalCents >= BUDGET_CAP_CENTS) { writeAddendum(lines, totalCents); return; }

  // ── P2b: Creatomate 2880×1620 ────────────────────────────────────────────
  console.log("\n=== P2b: Creatomate 2880×1620 (1.5× supersampling) ===");
  const p2bId = await submitCreatomate([CLIP_1, CLIP_2], 2880, 1620);
  console.log(`  Render: ${p2bId}`);
  const { url: p2bUrl, durationSeconds: p2bDur } = await pollCreatomate(p2bId);
  const p2b = await ffprobeUrl(p2bUrl, "P2b-creatomate-1620p");
  console.log(`  ${p2b.width}x${p2b.height} ${p2b.fps.toFixed(2)}fps ${p2b.videoBitrateMbps.toFixed(2)} Mbps`);

  // 2880×1620 has 2.25× the pixel area of 1920×1080 — scale credit estimate accordingly.
  const p2bCost = Math.round(creatomateCostCents(p2bDur > 0 ? p2bDur : 10) * 2.25);
  await recordCostEvent({ propertyId:null, stage:"assembly", provider:"creatomate", unitsConsumed:1, unitType:"renders", costCents:p2bCost, metadata:{ ...PROBE_META, canvas:"2880x1620", renderId:p2bId, measuredBitrateMbps:parseFloat(p2b.videoBitrateMbps.toFixed(2)), note:"cost_estimated_verify_dashboard" } });
  totalCents += p2bCost;
  console.log(`  Cost (est.): ${p2bCost}¢ | total: ${totalCents}¢`);

  const baselineBpp = (p2a.videoBitrateMbps*1e6) / (p2a.width*p2a.height*p2a.fps);
  const ssampleBpp  = (p2b.videoBitrateMbps*1e6) / (p2b.width*p2b.height*p2b.fps);
  const bppRatio = ssampleBpp / (baselineBpp || 1);
  const gateA = p2b.videoBitrateMbps >= GATE_A_MBPS && bppRatio >= GATE_A_BPP_RATIO;

  lines.push("\n### P2b — Creatomate 2880×1620 concat (1.5× supersampling)");
  lines.push(`- Canvas: 2880×1620, render_scale:1, duration:null`);
  lines.push(`- Render ID: ${p2bId}`);
  lines.push(`- Output URL: ${p2bUrl}`);
  lines.push(`- **Resolution: ${p2b.width}×${p2b.height}**, FPS: ${p2b.fps.toFixed(2)}, Codec: ${p2b.codec}`);
  lines.push(`- **Video bitrate: ${p2b.videoBitrateMbps.toFixed(2)} Mbps** (duration: ${p2bDur.toFixed(2)}s)`);
  lines.push(`- Credit charge ESTIMATED (2.25× pixel area, verify in Creatomate dashboard): ${p2bCost}¢`);
  lines.push(`- Baseline bpp: ${baselineBpp.toExponential(3)} b/px/frame @ ${p2a.videoBitrateMbps.toFixed(2)} Mbps`);
  lines.push(`- Supersample bpp: ${ssampleBpp.toExponential(3)} b/px/frame @ ${p2b.videoBitrateMbps.toFixed(2)} Mbps`);
  lines.push(`- bpp ratio (1.5× / baseline): ${bppRatio.toFixed(3)} (threshold ≥${GATE_A_BPP_RATIO})`);
  lines.push(`- **Gate A: ${gateA?"PASS":"FAIL"}** (requires ≥${GATE_A_MBPS} Mbps AND bpp_ratio ≥${GATE_A_BPP_RATIO})`);
  if (gateA) {
    lines.push(`  - PASS: Creatomate supersampling is viable.`);
    lines.push(`  - ACTION: update creatomateCostCents() for 2880×1620 (~2.25× credits); update assembly canvas in buildCreatomateTimeline/buildCreatomateConcatScript.`);
  }

  if (totalCents >= BUDGET_CAP_CENTS) { writeAddendum(lines, totalCents, gateA, null); return; }

  // ── P3: Shotstack quality:'high' ────────────────────────────────────────
  console.log("\n=== P3: Shotstack quality:'high' 1080p/fps:24 ===");
  const { jobId: ssJob, environment: ssEnv } = await submitShotstack([CLIP_1, CLIP_2]);
  console.log(`  Job: ${ssJob} (${ssEnv})`);
  const { url: p3Url, durationSeconds: p3Dur } = await pollShotstack(ssJob, ssEnv);
  const p3 = await ffprobeUrl(p3Url, "P3-shotstack-high");
  console.log(`  ${p3.width}x${p3.height} ${p3.fps.toFixed(2)}fps ${p3.videoBitrateMbps.toFixed(2)} Mbps`);

  const p3Cost = shotstackCostCents(p3Dur > 0 ? p3Dur : 10);
  await recordCostEvent({ propertyId:null, stage:"assembly", provider:"shotstack", unitsConsumed:1, unitType:"renders", costCents:p3Cost, metadata:{ ...PROBE_META, renderId:ssJob, environment:ssEnv, quality:"high", resolution:"1080", fps:24, measuredBitrateMbps:parseFloat(p3.videoBitrateMbps.toFixed(2)) } });
  totalCents += p3Cost;
  console.log(`  Cost: ${p3Cost}¢ | total: ${totalCents}¢`);

  const gateB: boolean|null = !gateA ? p3.videoBitrateMbps >= GATE_B_MBPS : null;

  lines.push("\n### P3 — Shotstack quality:'high' 1080p/fps:24");
  lines.push(`- Clips: scene_1_v1.mp4 + scene_2_B.mp4`);
  lines.push(`- Payload: quality:'high', resolution:'1080', fps:24, aspectRatio:'16:9'`);
  lines.push(`- Shotstack environment: ${ssEnv}`);
  lines.push(`- Job ID: ${ssJob}`);
  lines.push(`- Output URL: ${p3Url}`);
  lines.push(`- **Resolution: ${p3.width}×${p3.height}**, FPS: ${p3.fps.toFixed(2)}, Codec: ${p3.codec}`);
  lines.push(`- **Video bitrate: ${p3.videoBitrateMbps.toFixed(2)} Mbps** (duration: ${p3Dur.toFixed(2)}s)`);
  lines.push(`- Cost: ${p3Cost}¢ (1-min floor @ ${process.env.SHOTSTACK_CENTS_PER_MINUTE??"20"}¢/min)`);
  if (gateB !== null) {
    lines.push(`- **Gate B: ${gateB?"PASS":"FAIL"}** (Gate A failed → Shotstack must reach ≥${GATE_B_MBPS} Mbps)`);
    if (gateB) lines.push(`  - PASS: Route code-gen assembly to Shotstack. Parity work needed for overlays/music/voiceover.`);
    else lines.push(`  - FAIL: Neither approach is measurably better. STOP — escalate to Oliver.`);
  } else {
    lines.push(`- Gate B: N/A (Gate A passed)`);
  }

  writeAddendum(lines, totalCents, gateA, gateB);
  console.log(`\n=== DONE === Total: ${totalCents}¢ ($${(totalCents/100).toFixed(2)})`);
}

main().catch(e => { console.error("PROBE FAILED:", e); process.exit(1); });
