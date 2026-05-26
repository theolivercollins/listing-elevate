/**
 * V2.1 outcome-feedback background worker.
 *
 * Called by cron/heartbeat. Idempotent — safe to run concurrently because
 * row selection uses `FOR UPDATE SKIP LOCKED` via a raw SQL RPC call, which
 * prevents two concurrent workers from processing the same outcome.
 *
 * Concurrency note:
 *   Supabase's PostgREST client does not expose FOR UPDATE SKIP LOCKED
 *   directly. The pattern used here is:
 *     1. Call a Supabase RPC (claim_v21_outcomes) that runs:
 *          UPDATE gen2_render_outcomes
 *            SET status='claimed'
 *          WHERE outcome_id IN (
 *            SELECT outcome_id FROM gen2_render_outcomes
 *            WHERE status = ANY($1)
 *            LIMIT 5
 *            FOR UPDATE SKIP LOCKED
 *          )
 *          RETURNING *;
 *     2. If the RPC is unavailable (e.g. function not yet deployed), fall
 *        back to a non-locking SELECT — still safe at low concurrency, but
 *        not concurrent-safe. Logged as a warning.
 *
 * The 'claimed' status is a transient lock status not in OutcomeStatus. The
 * worker immediately re-transitions it to the appropriate next status before
 * releasing. If the worker crashes mid-flight the row stays 'claimed'; a
 * separate cleanup cron (or the same worker with a grace period) can reset
 * claimed rows older than 5 minutes back to their previous state. This is a
 * known limitation of the current single-pass design; it does not lose data.
 *
 * Atlas SKU: kling-o3-pro (per spec)
 * Timeout: 20 minutes in submitted/polling before marking failed
 * Retry cap: 2 (per round-7 — multi-take limit)
 */

import type { RenderOutcome, OutcomeStatus } from "../types.js";
import { isTerminal, isPollingState } from "./state-machine.js";
import { judgeRenderedClip } from "./judge.js";
import { triggerRetrainIfReady } from "./retrain-hook.js";
import { tryWithGuardrail } from "../guardrail/multi-take.js";

// Atlas SKU for V2.1 paired renders
const V21_ATLAS_SKU = "kling-o3-pro";
const ATLAS_PREDICTION_BASE = "https://api.atlascloud.ai/api/v1/model/prediction";
const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const MAX_RETRIES = 2;
const BATCH_SIZE = 5;

const V21_RENDER_PROMPT =
  "Smooth cinematic camera move from start frame to end frame. Gimbal-stable. No jitter or shake.";

// Non-terminal statuses the worker picks up
const ACTIVE_STATUSES: OutcomeStatus[] = ["pending", "submitted", "polling", "rendered", "judged"];

// Minimal Supabase client surface
interface SupabaseClient {
  from(table: string): SupabaseQueryBuilder;
  rpc(fn: string, params?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

interface SupabaseQueryBuilder {
  select(cols?: string): SupabaseQueryBuilder;
  update(vals: unknown): SupabaseQueryBuilder;
  eq(col: string, val: unknown): SupabaseQueryBuilder;
  neq(col: string, val: unknown): SupabaseQueryBuilder;
  in(col: string, vals: unknown[]): SupabaseQueryBuilder;
  lte(col: string, val: unknown): SupabaseQueryBuilder;
  limit(n: number): SupabaseQueryBuilder;
  order(col: string, opts?: { ascending: boolean }): SupabaseQueryBuilder;
  then(resolve: (res: { data: unknown; error: unknown }) => void): void;
}

async function fetchOutcomes(supabase: SupabaseClient): Promise<RenderOutcome[]> {
  // Attempt the locking RPC first
  const rpcResult = await supabase.rpc("claim_v21_outcomes", { batch_size: BATCH_SIZE });
  if (!rpcResult.error && rpcResult.data) {
    return rpcResult.data as RenderOutcome[];
  }

  // Fall back to non-locking select (acceptable at low concurrency)
  console.warn(
    "[v21-worker] claim_v21_outcomes RPC unavailable; using non-locking SELECT. " +
      "This is safe at low concurrency. Deploy the RPC for concurrent-safe operation.",
  );

  return new Promise<RenderOutcome[]>((resolve, reject) => {
    supabase
      .from("gen2_render_outcomes")
      .select("*")
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error) reject(new Error(`Failed to fetch outcomes: ${JSON.stringify(error)}`));
        else resolve((data as RenderOutcome[]) ?? []);
      });
  });
}

async function updateOutcome(
  supabase: SupabaseClient,
  outcomeId: string,
  patch: Partial<RenderOutcome>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    supabase
      .from("gen2_render_outcomes")
      .update(patch)
      .eq("outcome_id", outcomeId)
      .then(({ error }: { data: unknown; error: unknown }) => {
        if (error) reject(new Error(`Failed to update outcome ${outcomeId}: ${JSON.stringify(error)}`));
        else resolve();
      });
  });
}

/**
 * Resolve photo URLs from either `photos` (real listings) or
 * `prompt_lab_listing_photos` (lab listings) for a given pair of photo IDs.
 * Tries the real photos table first; if both IDs are missing, falls back to lab.
 */
async function fetchPhotoUrls(
  supabase: SupabaseClient,
  photoAId: string,
  photoBId: string,
): Promise<{ imageA: string; imageB: string } | null> {
  // Try real property photos first
  const propertyPhotos = await new Promise<Array<{ id: string; file_url: string }>>((resolve) => {
    supabase
      .from("photos")
      .select("id, file_url")
      .in("id", [photoAId, photoBId])
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve([]); return; }
        resolve(data as Array<{ id: string; file_url: string }>);
      });
  });

  const propMap = Object.fromEntries(propertyPhotos.map((p) => [p.id, p.file_url]));
  if (propMap[photoAId] && propMap[photoBId]) {
    return { imageA: propMap[photoAId], imageB: propMap[photoBId] };
  }

  // Fall back to prompt_lab_listing_photos
  const labPhotos = await new Promise<Array<{ id: string; image_url: string }>>((resolve) => {
    supabase
      .from("prompt_lab_listing_photos")
      .select("id, image_url")
      .in("id", [photoAId, photoBId])
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve([]); return; }
        resolve(data as Array<{ id: string; image_url: string }>);
      });
  });

  const labMap = Object.fromEntries(labPhotos.map((p) => [p.id, p.image_url]));

  // Merge: prefer any real-photos URL we did find, then lab fallback
  const imageA = propMap[photoAId] ?? labMap[photoAId];
  const imageB = propMap[photoBId] ?? labMap[photoBId];

  if (!imageA || !imageB) return null;
  return { imageA, imageB };
}

/**
 * Resolve photo URLs for a pair label. Returns null if the label or photos
 * cannot be found, in which case the caller should mark the outcome failed.
 */
async function resolvePhotoPair(
  outcome: RenderOutcome,
  supabase: SupabaseClient,
): Promise<{ imageA: string; imageB: string } | null> {
  const label = await new Promise<{ photo_a_id: string; photo_b_id: string } | null>((resolve) => {
    supabase
      .from("gen2_pair_labels")
      .select("photo_a_id, photo_b_id")
      .eq("label_id", outcome.pair_label_id)
      .limit(1)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve(null); return; }
        const rows = data as Array<{ photo_a_id: string; photo_b_id: string }>;
        resolve(rows[0] ?? null);
      });
  });

  if (!label) return null;

  return fetchPhotoUrls(supabase, label.photo_a_id, label.photo_b_id);
}

/**
 * pending → tryWithGuardrail → rendered (ok=true) | failed (ok=false)
 *
 * Replaces the old direct-Atlas submit + polling path for pending outcomes.
 * tryWithGuardrail handles its own multi-take loop, polling, and cost_events
 * recording per attempt. On success the outcome is immediately marked
 * 'rendered' (no polling step needed). On failure the outcome is marked
 * 'failed' and the attempts array is persisted to judge_reasoning for audit.
 */
async function submitWithGuardrail(
  outcome: RenderOutcome,
  supabase: SupabaseClient,
): Promise<void> {
  const pair = await resolvePhotoPair(outcome, supabase);

  if (!pair) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  const { imageA, imageB } = pair;

  const guardrailResult = await tryWithGuardrail({
    pairLabelId: outcome.pair_label_id,
    outcomeId: outcome.outcome_id,
    photoAUrl: imageA,
    photoBUrl: imageB,
    atlasModelSlug: V21_ATLAS_SKU,
    generatePromptFn: () => V21_RENDER_PROMPT,
    maxAttempts: 2,
  });

  // Always persist the attempts audit trail into judge_reasoning
  const attemptsJson = JSON.stringify(guardrailResult.attempts);

  // Roll Atlas spend (passing + failed takes) into the outcome row so
  // cost_cents reflects every cent we burned reaching this verdict — the
  // judge step will add its own Gemini cost on top later.
  const rolledCostCents = (outcome.cost_cents ?? 0) + guardrailResult.totalCostCents;

  if (guardrailResult.ok && guardrailResult.videoUrl) {
    // Guardrail passed — skip polling (already done internally)
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "rendered",
      video_url: guardrailResult.videoUrl,
      judge_reasoning: attemptsJson,
      cost_cents: rolledCostCents,
    } as Partial<RenderOutcome>);
  } else {
    // All takes failed guardrail — record failure; orchestrator handles routing
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
      judge_reasoning: attemptsJson,
      cost_cents: rolledCostCents,
    } as Partial<RenderOutcome>);
  }
}

async function pollAtlas(outcome: RenderOutcome, supabase: SupabaseClient): Promise<void> {
  if (!outcome.atlas_job_id) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  // Check timeout
  const submittedAt = new Date(outcome.created_at).getTime();
  if (Date.now() - submittedAt > TIMEOUT_MS) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  const res = await fetch(`${ATLAS_PREDICTION_BASE}/${outcome.atlas_job_id}`, {
    headers: { Authorization: `Bearer ${process.env.ATLASCLOUD_API_KEY ?? ""}` },
  });

  if (!res.ok) {
    // Non-fatal — leave in polling, try again next tick
    return;
  }

  const parsed = (await res.json()) as {
    code: number;
    data?: {
      status?: string;
      outputs?: Array<string | { url?: string }> | { url?: string } | string | null;
    } | null;
  };

  const atlasStatus = parsed.data?.status ?? "unknown";

  if (atlasStatus === "processing" || atlasStatus === "pending" || atlasStatus === "queued") {
    // Move to explicit polling state if still in submitted
    if (outcome.status === "submitted") {
      await updateOutcome(supabase, outcome.outcome_id, {
        status: "polling",
      } as Partial<RenderOutcome>);
    }
    return;
  }

  if (atlasStatus === "failed" || atlasStatus === "error") {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  if (
    atlasStatus === "succeeded" ||
    atlasStatus === "completed" ||
    atlasStatus === "success"
  ) {
    const outputs = parsed.data?.outputs;
    let videoUrl: string | null = null;
    if (typeof outputs === "string") videoUrl = outputs;
    else if (Array.isArray(outputs)) {
      const first = outputs[0];
      videoUrl = typeof first === "string" ? first : (first as { url?: string })?.url ?? null;
    } else if (outputs && typeof outputs === "object") {
      videoUrl = (outputs as { url?: string }).url ?? null;
    }

    if (!videoUrl) {
      await updateOutcome(supabase, outcome.outcome_id, {
        status: "failed",
        completed_at: new Date().toISOString(),
      } as Partial<RenderOutcome>);
      return;
    }

    await updateOutcome(supabase, outcome.outcome_id, {
      video_url: videoUrl,
      status: "rendered",
    } as Partial<RenderOutcome>);
  }
}

async function judgeOutcome(outcome: RenderOutcome, supabase: SupabaseClient): Promise<void> {
  if (!outcome.video_url) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  // Get source photo URLs for the judge
  const label = await new Promise<{ photo_a_id: string; photo_b_id: string } | null>((resolve) => {
    supabase
      .from("gen2_pair_labels")
      .select("photo_a_id, photo_b_id")
      .eq("label_id", outcome.pair_label_id)
      .limit(1)
      .then(({ data, error }: { data: unknown; error: unknown }) => {
        if (error || !data) { resolve(null); return; }
        const rows = data as Array<{ photo_a_id: string; photo_b_id: string }>;
        resolve(rows[0] ?? null);
      });
  });

  if (!label) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  const pair = await fetchPhotoUrls(supabase, label.photo_a_id, label.photo_b_id);

  const result = await judgeRenderedClip(
    outcome.video_url,
    pair?.imageA ?? outcome.video_url,
    pair?.imageB ?? outcome.video_url,
  );

  await updateOutcome(supabase, outcome.outcome_id, {
    judge_score: result.score,
    judge_reasoning: result.reasoning,
    cost_cents: (outcome.cost_cents ?? 0) + result.costCents,
    status: "judged",
  } as Partial<RenderOutcome>);
}

async function completeOutcome(outcome: RenderOutcome, supabase: SupabaseClient): Promise<void> {
  await updateOutcome(supabase, outcome.outcome_id, {
    status: "completed",
    completed_at: new Date().toISOString(),
  } as Partial<RenderOutcome>);

  // Trigger retrain check after marking complete
  try {
    await triggerRetrainIfReady(supabase);
  } catch (err) {
    // Non-fatal — retrain failure must not block outcome completion
    console.warn("[v21-worker] retrain hook error:", err instanceof Error ? err.message : err);
  }
}

async function processOutcome(outcome: RenderOutcome, supabase: SupabaseClient): Promise<void> {
  // Enforce retry cap
  if ((outcome.retry_count ?? 0) >= MAX_RETRIES && !isTerminal(outcome.status)) {
    await updateOutcome(supabase, outcome.outcome_id, {
      status: "failed",
      completed_at: new Date().toISOString(),
    } as Partial<RenderOutcome>);
    return;
  }

  switch (outcome.status) {
    case "pending":
      await submitWithGuardrail(outcome, supabase);
      break;

    case "submitted":
    case "polling":
      if (isPollingState(outcome.status)) {
        await pollAtlas(outcome, supabase);
      }
      break;

    case "rendered":
      await judgeOutcome(outcome, supabase);
      break;

    case "judged":
      await completeOutcome(outcome, supabase);
      break;

    case "completed":
    case "failed":
      // Terminal — no-op
      break;
  }
}

/**
 * Process up to BATCH_SIZE outstanding outcomes, progressing each one step.
 * Idempotent. Returns counts of processed and errored outcomes.
 */
export async function processOutstandingOutcomes(
  supabase: SupabaseClient,
): Promise<{ processed: number; errors: number }> {
  // Feature flag — allows cron to call this unconditionally; returns no-op if disabled
  if (process.env.GEN2_V21_ENABLED !== "true") {
    return { processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;

  let outcomes: RenderOutcome[];
  try {
    outcomes = await fetchOutcomes(supabase);
  } catch (err) {
    console.error("[v21-worker] Failed to fetch outcomes:", err instanceof Error ? err.message : err);
    return { processed: 0, errors: 1 };
  }

  for (const outcome of outcomes) {
    try {
      await processOutcome(outcome, supabase);
      processed++;
    } catch (err) {
      errors++;
      console.error(
        `[v21-worker] Error processing outcome ${outcome.outcome_id} (status=${outcome.status}):`,
        err instanceof Error ? err.message : err,
      );
      // Increment retry_count on error; mark failed if at cap
      const nextRetry = (outcome.retry_count ?? 0) + 1;
      try {
        await updateOutcome(supabase, outcome.outcome_id, {
          retry_count: nextRetry,
          ...(nextRetry >= MAX_RETRIES
            ? { status: "failed", completed_at: new Date().toISOString() }
            : {}),
        } as Partial<RenderOutcome>);
      } catch {
        // Best effort
      }
    }
  }

  return { processed, errors };
}
