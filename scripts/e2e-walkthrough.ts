#!/usr/bin/env -S npx tsx
/**
 * scripts/e2e-walkthrough.ts
 *
 * Standalone PAID end-to-end verification of the walkthrough pipeline
 * (migration 103, pipeline_mode='walkthrough'). Imports and exercises the
 * REAL production module `lib/walkthrough/generate.ts`
 * (`submitWalkthrough`, `pollWalkthrough`) — it does NOT re-implement Atlas
 * submit/poll/finalize logic — and queries Supabase directly (via the same
 * service-role client the module uses, `lib/db.ts`'s `getSupabase()`) to
 * assert DB and cost_events state at each step.
 *
 * This is a MONEY-SPENDING script: it fires exactly one real Atlas Cloud
 * Seedance 2.0 reference-to-video render (~15s @ 1080p) against the given
 * property's photos and polls it to completion (can take up to ~20 minutes
 * wall-clock). It exists to prove, end-to-end, that:
 *   - submitWalkthrough() is idempotent while a job is in flight (no
 *     double-submit / double-bill on repeat calls),
 *   - pollWalkthrough()'s atomic finalize-claim is safe under concurrency
 *     (two simultaneous polls never both run the paid finalize path),
 *   - exactly ONE cost_events row is ever written per Atlas jobId, and
 *   - the final hosted video URL is real, reachable, and downloadable.
 *
 * Usage:
 *   ATLASCLOUD_API_KEY=... LE_ALLOW_NONPROD_WRITES=true \
 *     /path/to/main/repo/node_modules/.bin/tsx scripts/e2e-walkthrough.ts [propertyId]
 *
 * propertyId defaults to a30212b2-088a-40a2-9c7a-f4ec16d04e45 (San Massimo —
 * the same property used by scripts/probe-assembly-bitrate.ts).
 *
 * Exit code: 0 if every numbered check PASSes, 1 if any check FAILs (or the
 * pipeline aborts early because a prerequisite check failed).
 *
 * NOTE: this script has NOT been run by the authoring agent — Oliver runs it
 * (see project convention: paid/spend-triggering scripts are never run by
 * the agent that writes them).
 */

// ─── env bootstrap ──────────────────────────────────────────────────────────
// Mirrors scripts/probe-assembly-bitrate.ts's manual loader rather than a
// bare `import "dotenv/config"`: this script must resolve `.env` from the
// REPO ROOT regardless of the operator's current working directory, because
// this file lives in a git worktree that has no `.env` (and no
// node_modules) of its own — see project memory
// "Worktrees have no node_modules" / "Background seats need worktree
// isolation". Loading relative to import.meta.url instead of process.cwd()
// makes this script correct whether it's launched from the worktree, the
// main repo, or anywhere else, as long as the main repo's `.env` exists on
// disk at the expected relative path.
import * as fs from "node:fs";
import * as path from "node:path";

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

import { getSupabase } from "../lib/db.js";
import { submitWalkthrough, pollWalkthrough } from "../lib/walkthrough/generate.js";

// ─── config ─────────────────────────────────────────────────────────────────

const DEFAULT_PROPERTY_ID = "a30212b2-088a-40a2-9c7a-f4ec16d04e45";
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

const STEP_LABELS: Record<number, string> = {
  1: "Snapshot baseline + clean-start reset of walkthrough_* fields",
  2: "submitWalkthrough() #1 → processing + jobId",
  3: "In-flight guard: submitWalkthrough() #2 returns SAME jobId",
  4: "DB assert: processing / job_id set / video_url null",
  5: "Poll loop to terminal status (complete|failed, 20min cap)",
  6: "Atomic-claim: two concurrent pollWalkthrough() calls, neither throws",
  7: "DB assert: complete + walkthrough_video_url set",
  8: "Exactly-once cost: cost_events count for jobId === 1",
  9: "Sequential idempotency: post-complete poll, cost count still 1",
  10: "Download final video, verify non-trivial size on disk",
};

// ─── tiny test harness ──────────────────────────────────────────────────────

interface StepResult {
  n: number;
  label: string;
  ok: boolean;
  detail?: string;
  skipped?: boolean;
}

const results: StepResult[] = [];
let lastAttempted = 0;

class AbortPipeline extends Error {}

async function step<T>(n: number, fn: () => Promise<T>): Promise<T> {
  lastAttempted = n;
  const label = STEP_LABELS[n];
  process.stdout.write(`\n[${n}] ${label} ... `);
  try {
    const value = await fn();
    console.log("PASS");
    results.push({ n, label, ok: true });
    return value;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("FAIL");
    console.error(`    -> ${msg}`);
    results.push({ n, label, ok: false, detail: msg });
    throw new AbortPipeline(`check ${n} failed: ${msg}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── preflight (not a numbered check — a hard abort before spending money) ──

function preflight(): void {
  const problems: string[] = [];

  if (!process.env.ATLASCLOUD_API_KEY) {
    problems.push(
      "ATLASCLOUD_API_KEY is not set. This script calls the live Atlas Cloud API and costs money — " +
        "export ATLASCLOUD_API_KEY (see ~/credentials.md) before running.",
    );
  }

  const writesAllowed =
    process.env.VERCEL_ENV === "production" || process.env.LE_ALLOW_NONPROD_WRITES === "true";
  if (!writesAllowed) {
    problems.push(
      "Write guard is closed: submitWalkthrough()/pollWalkthrough() will no-op / skip on non-prod. " +
        "Set LE_ALLOW_NONPROD_WRITES=true to run this against the shared dev DB (this WILL spend real " +
        "money and write real cost_events rows).",
    );
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    problems.push(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment (checked .env at " +
        `${envPath} and process.env). getSupabase() will throw without these.`,
    );
  }

  if (problems.length) {
    console.error("ABORT — preflight failed:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const propertyId = process.argv[2]?.trim() || DEFAULT_PROPERTY_ID;

  console.log("=== Walkthrough pipeline E2E verification ===");
  console.log(`Property ID: ${propertyId}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s, timeout: ${POLL_TIMEOUT_MS / 60000}min`);

  preflight();

  const supabase = getSupabase();

  let jobId = "";
  let finalVideoUrl: string | undefined;

  // ── 1. Snapshot baseline + clean-start reset ──
  await step(1, async () => {
    const { count: baselineAtlasCostCount, error: countErr } = await supabase
      .from("cost_events")
      .select("id", { count: "exact", head: true })
      .eq("provider", "atlas");
    if (countErr) throw countErr;
    console.log(`\n    baseline cost_events(provider=atlas) count = ${baselineAtlasCostCount ?? "?"}`);

    const { data: propRow, error: propErr } = await supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .single();
    if (propErr) throw new Error(`property lookup failed: ${propErr.message}`);
    assert(propRow, `no property row found for id=${propertyId}`);

    const { error: resetErr } = await supabase
      .from("properties")
      .update({
        walkthrough_status: null,
        walkthrough_job_id: null,
        walkthrough_video_url: null,
        walkthrough_error: null,
        walkthrough_updated_at: null,
      })
      .eq("id", propertyId);
    if (resetErr) throw new Error(`clean-start reset failed: ${resetErr.message}`);
    console.log(`    walkthrough_* fields reset to null for ${propertyId}`);
  });

  // ── 2. submitWalkthrough() #1 ──
  await step(2, async () => {
    const result = await submitWalkthrough(propertyId);
    console.log(`\n    result = ${JSON.stringify(result)}`);
    assert(
      result.status === "processing",
      `expected status='processing', got '${result.status}'${result.reason ? ` (reason: ${result.reason})` : ""}`,
    );
    assert(typeof result.jobId === "string" && result.jobId.length > 0, "expected a non-empty jobId");
    jobId = result.jobId;
    console.log(`    jobId = ${jobId}`);
  });

  // ── 3. In-flight guard: second submit must return the SAME jobId ──
  await step(3, async () => {
    const result2 = await submitWalkthrough(propertyId);
    console.log(`\n    result = ${JSON.stringify(result2)}`);
    assert(
      result2.status === "processing",
      `expected status='processing' on re-submit, got '${result2.status}'`,
    );
    assert(
      result2.jobId === jobId,
      `in-flight guard failed: expected SAME jobId '${jobId}', got '${result2.jobId}' — a second Atlas job may have been launched (double-billing)`,
    );
  });

  // ── 4. DB assert after submit ──
  await step(4, async () => {
    const { data, error } = await supabase
      .from("properties")
      .select("walkthrough_status, walkthrough_job_id, walkthrough_video_url")
      .eq("id", propertyId)
      .single();
    if (error) throw error;
    console.log(`\n    row = ${JSON.stringify(data)}`);
    assert(data?.walkthrough_status === "processing", `expected walkthrough_status='processing', got '${data?.walkthrough_status}'`);
    assert(data?.walkthrough_job_id === jobId, `expected walkthrough_job_id='${jobId}', got '${data?.walkthrough_job_id}'`);
    assert(data?.walkthrough_video_url === null, `expected walkthrough_video_url=null, got '${data?.walkthrough_video_url}'`);
  });

  // ── 5. Poll loop to terminal status ──
  let reachedComplete = false;
  await step(5, async () => {
    const start = Date.now();
    let pollCount = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      pollCount += 1;
      const elapsedMs = Date.now() - start;
      if (elapsedMs > POLL_TIMEOUT_MS) {
        throw new Error(`poll loop timed out after ${(elapsedMs / 60000).toFixed(1)}min (${pollCount} polls)`);
      }
      const result = await pollWalkthrough(propertyId);
      console.log(
        `\n    [poll ${pollCount}, t+${(elapsedMs / 1000).toFixed(0)}s] status=${result.status}` +
          (result.videoUrl ? ` videoUrl=${result.videoUrl}` : "") +
          (result.error ? ` error=${result.error}` : ""),
      );
      if (result.status === "complete") {
        finalVideoUrl = result.videoUrl;
        reachedComplete = true;
        return;
      }
      if (result.status === "failed") {
        throw new Error(`Atlas job ${jobId} failed: ${result.error ?? "(no error message returned)"}`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  });

  // ── 6. Atomic-claim / idempotency under concurrency ──
  // pollWalkthrough() finalizes (download + Bunny host + cost record + DB
  // commit) synchronously inside a single call, so by the time step 5 above
  // observed 'complete' the finalize claim has already been won and
  // released. Per the spec's fallback: fire two concurrent polls right after
  // completion and assert neither throws (and both read the already-
  // finalized state cleanly, i.e. no re-entrant finalize).
  await step(6, async () => {
    assert(reachedComplete, "cannot run concurrency check — job never reached 'complete'");
    const [r1, r2] = await Promise.all([pollWalkthrough(propertyId), pollWalkthrough(propertyId)]);
    console.log(`\n    concurrent poll #1 = ${JSON.stringify(r1)}`);
    console.log(`    concurrent poll #2 = ${JSON.stringify(r2)}`);
    assert(r1.status === "complete", `concurrent poll #1 expected 'complete', got '${r1.status}'`);
    assert(r2.status === "complete", `concurrent poll #2 expected 'complete', got '${r2.status}'`);
  });

  // ── 7. DB assert: complete + video URL set ──
  await step(7, async () => {
    const { data, error } = await supabase
      .from("properties")
      .select("walkthrough_status, walkthrough_video_url")
      .eq("id", propertyId)
      .single();
    if (error) throw error;
    console.log(`\n    row = ${JSON.stringify(data)}`);
    assert(data?.walkthrough_status === "complete", `expected walkthrough_status='complete', got '${data?.walkthrough_status}'`);
    assert(
      typeof data?.walkthrough_video_url === "string" && data.walkthrough_video_url.length > 0,
      `expected a non-empty walkthrough_video_url, got '${data?.walkthrough_video_url}'`,
    );
    finalVideoUrl = data.walkthrough_video_url as string;
  });

  // ── 8. Exactly-once cost ──
  await step(8, async () => {
    const { data, error } = await supabase
      .from("cost_events")
      .select("id, cost_cents, units_consumed, unit_type, metadata")
      .eq("provider", "atlas")
      .contains("metadata", { jobId });
    if (error) throw error;
    console.log(`\n    matching cost_events rows = ${data?.length ?? 0}`);
    assert(
      data?.length === 1,
      `expected EXACTLY 1 cost_events row for jobId='${jobId}', found ${data?.length ?? 0} — double-charge (or zero-charge) bug`,
    );
    const row = data[0];
    console.log(`    cost row: cost_cents=${row.cost_cents} ($${((row.cost_cents as number) / 100).toFixed(2)}), units_consumed=${row.units_consumed}, unit_type=${row.unit_type}`);
    assert(
      typeof row.cost_cents === "number" && row.cost_cents > 0,
      `cost_cents must be a positive number, got '${row.cost_cents}' (P0: null/zero cost is never acceptable)`,
    );
  });

  // ── 9. Sequential idempotency (post-complete poll) ──
  await step(9, async () => {
    const result = await pollWalkthrough(propertyId);
    console.log(`\n    post-complete poll result = ${JSON.stringify(result)}`);
    assert(result.status === "complete", `expected status='complete' on post-complete poll, got '${result.status}'`);

    const { data, error } = await supabase
      .from("cost_events")
      .select("id", { count: undefined })
      .eq("provider", "atlas")
      .contains("metadata", { jobId });
    if (error) throw error;
    console.log(`    cost_events rows for jobId after extra poll = ${data?.length ?? 0}`);
    assert(
      data?.length === 1,
      `sequential idempotency violated: expected cost_events count to STAY at 1, found ${data?.length ?? 0}`,
    );
  });

  // ── 10. Download the final video ──
  await step(10, async () => {
    assert(finalVideoUrl, "no finalVideoUrl captured from steps 5/7");
    const res = await fetch(finalVideoUrl);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText} for ${finalVideoUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const destDir = path.resolve(scriptDir, "..", "tmp");
    const destPath = path.join(destDir, `e2e-walkthrough-${safeJobId}.mp4`);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(destPath, buf);

    const mb = (buf.length / 1e6).toFixed(2);
    console.log(`\n    saved ${mb} MB to ${destPath}`);
    assert(buf.length > 100_000, `downloaded file is suspiciously small (${buf.length} bytes) — likely not a real video`);
  });
}

// ─── run + summarize ────────────────────────────────────────────────────────

main()
  .catch((e) => {
    if (!(e instanceof AbortPipeline)) {
      // Unexpected error outside the step() harness (preflight, setup, etc.)
      console.error("\nUNEXPECTED ERROR:", e);
    }
  })
  .finally(() => {
    for (let n = lastAttempted + 1; n <= 10; n++) {
      results.push({ n, label: STEP_LABELS[n], ok: false, skipped: true });
    }

    console.log("\n=== Summary ===");
    for (const r of results.sort((a, b) => a.n - b.n)) {
      const tag = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
      console.log(`  [${tag}] ${r.n}. ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      console.log("\nALL CHECKS PASSED");
      process.exit(0);
    } else {
      console.log(`\n${failed.length} CHECK(S) FAILED / SKIPPED — see above`);
      process.exit(1);
    }
  });
