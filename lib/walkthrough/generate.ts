/**
 * lib/walkthrough/generate.ts
 *
 * Opt-in "walkthrough" pipeline mode (migration 103, pipeline_mode='walkthrough').
 * Generates ONE continuous multi-reference walkthrough video from a
 * property's photos via Bytedance Seedance 2.0 "reference-to-video"
 * (Atlas Cloud SKU `seedance-reference-walkthrough`) — bypassing the
 * per-scene v1/v1.1 pipeline entirely.
 *
 * ASYNC BY DESIGN: the Atlas render takes ~500s wall-clock, which exceeds
 * Vercel's 300s maxDuration. `submitWalkthrough()` only SUBMITS the job and
 * returns immediately; `pollWalkthrough()` is a separate, cheap status check
 * meant to be called repeatedly (studio UI polling / a future cron) until
 * the render finalizes. Neither function may block on the full render.
 *
 * State lives entirely on `properties.walkthrough_*` (no scenes rows) so a
 * crashed/redeployed process can resume just by re-polling — no in-memory
 * state, matching the project's resumability requirement.
 *
 * Write guard: mirrors lib/assembly/finalize.ts:194-196 — paid provider
 * calls (and Bunny hosting) only happen when VERCEL_ENV==='production' OR
 * LE_ALLOW_NONPROD_WRITES==='true' (shared DB / shared Bunny library across
 * envs).
 *
 * Cost tracking: every completed render writes exactly one cost_events row
 * via recordCostEvent (provider='atlas'), computed from the SKU's
 * priceCentsPerSecond × the actual requested duration — NOT from
 * AtlasProvider.checkStatus()'s `costCents`, which returns the SKU
 * descriptor's fixed `priceCentsPerClip` (a 5-second-clip baseline) and
 * silently undercounts cost for this SKU's longer, duration-variable
 * renders (confirmed against scripts/probe-walkthrough.ts's 12s/56¢ probe:
 * 56¢ is the 5s baseline, not 12s-actual cost). recordCostEvent's insert
 * error is never swallowed — a cost-write failure must surface, not fail
 * silently (P0 per project convention).
 *
 * ── Cinematic walkthrough v2 (2026-07-02) — the 4 defect classes + the law ──
 *
 * Three paid Seedance 2.0 reference-to-video test cycles (v1/v2/v3, see
 * docs/HANDOFF.md 2026-07-01/02 entries and
 * /Users/oliverhelgemo/.claude/jobs/bcc0c194/tmp/walkthrough-v{1,2,3}-input.json)
 * proved ONE law: the model is FAITHFUL exactly where a reference photo
 * covers the camera's view, and FABRICATES everywhere else. That fabrication
 * shows up as four distinct, empirically observed defect classes:
 *
 *   1. Invented doorways/openings — the camera passes through a wall,
 *      window, or closed door that no reference photo shows as an opening
 *      (v1's "fake wall-exit").
 *   2. Off-reference geometry fabrication — furniture, fixtures, or an
 *      entire room layout invented for a view no photo covers (v3's door
 *      reveal showed a dining table, kitchen, and stone fireplace that
 *      exist in zero of the source photos — the living-room reference was
 *      shot FROM that zone, never INTO it from the entry).
 *   3. On-image text hallucination — house numbers/signage are a coin flip
 *      (v1: "6016" for a real "5019"; v3: "5018"). Never trust rendered
 *      text; avoid photos with prominent legible numbers/signage.
 *   4. Reverse-traversal/backtrack distortion — smear-morph warping when the
 *      camera revisits an already-shown space or is asked to cram too many
 *      transitions into too short a duration (v1's kitchen smear at 5s).
 *
 * THE COVERAGE LAW (product decision, Oliver, 2026-07-02): walk a doorway
 * only if a reference photo visibly covers it — otherwise FADE between
 * zones. No third option, so the model never gets the chance to invent
 * geometry. This is exactly what lib/walkthrough/spatial.ts's
 * analyzeSpatialGraph() + planRoute() implement for the future
 * multi-segment path (spatial analysis → per-zone segments → crossfades).
 * This module (generate.ts) still runs the SINGLE-generation mode — the
 * multi-segment orchestration stays in the probe
 * (scripts/probe-walkthrough-cinematic.ts) until the segmented look is
 * approved — but WALKTHROUGH_PROMPT_BASE below is upgraded to the validated
 * forward-only skeleton (defect classes 1 and 4) and reference photos are
 * capped tighter (WALKTHROUGH_MAX_REFERENCE_IMAGES) to reduce how much
 * uncovered fabrication a single render has room to commit (defect class 2).
 * A future session promotes the segmented engine into this module once v2
 * is approved on real renders.
 */

import { getSupabase, getSelectedPhotos, getPhotosForProperty, recordCostEvent } from "../db.js";
import type { Photo } from "../types.js";
import {
  AtlasProvider,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  atlasClipCostCents,
} from "../providers/atlas.js";
import { hostVideoOnBunny, isBunnyConfigured } from "../providers/bunny-stream.js";
import { WALKTHROUGH_SKELETON_PROMPT } from "./spatial.js";

const SKU = "seedance-reference-walkthrough" as const;

// Cinematic v2 upgrade (2026-07-02): the validated forward-only skeleton,
// generalized for an arbitrary photo count/order (single-generation mode has
// no per-zone segmentation yet — that's spatial.ts's planRoute(), still
// probe-only). Variable content (the image-order manifest) is appended AFTER
// this stable block by buildWalkthroughPrompt(), per the project's
// cache-friendly-prompt-structure convention (stable prefix first, variable
// content last) — shared verbatim with spatial.ts's per-segment prompts so
// the two modes never drift apart on the winning language.
const WALKTHROUGH_PROMPT_BASE =
  `${WALKTHROUGH_SKELETON_PROMPT} Begin outside the property and move forward through the spaces shown in the reference photos, in the order listed below, entering through the front door and continuing into the interior. Prioritize accurate, coverage-true navigation over cinematic flourish.`;

const WALKTHROUGH_DURATION_SECONDS = 15;
const WALKTHROUGH_RESOLUTION = "1080p" as const;
const MIN_REFERENCE_IMAGES = 2;
// Cinematic v2 (2026-07-02): tightened from SEEDANCE_MAX_REFERENCE_IMAGES (9)
// to 5 — fewer references per single-shot render means fewer forced
// transitions the model has to invent in the gaps between what's actually
// photographed (defect class 2: off-reference geometry fabrication). The
// segmented engine (spatial.ts) is the real fix; this is a blast-radius
// reduction for the still-live single-generation mode.
const WALKTHROUGH_MAX_REFERENCE_IMAGES = 5;

export interface SubmitWalkthroughResult {
  status: "processing" | "skipped";
  jobId?: string;
  reason?: string;
}

export interface PollWalkthroughResult {
  status: "processing" | "complete" | "failed" | "idle";
  videoUrl?: string;
  error?: string;
}

/** Mirrors lib/assembly/finalize.ts:194-196 — see that file's docblock for
 *  the shared-resource rationale (Supabase + Bunny are shared across the
 *  3 branch envs; only prod, or an explicit opt-in flag, may spend/write). */
function writesAllowed(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.LE_ALLOW_NONPROD_WRITES === "true"
  );
}

/** True when `room_type` looks like an exterior/front shot. */
function isExteriorRoom(roomType: string | null): boolean {
  return !!roomType && /exterior|front/i.test(roomType);
}

/** True when `room_type` looks like an aerial shot — never useful for a
 *  ground-level continuous walkthrough; dropped from the reference set. */
function isAerialRoom(roomType: string | null): boolean {
  return !!roomType && /aerial/i.test(roomType);
}

/**
 * Order photos exterior → interior (stable within each group, preserving
 * the incoming order — already rank/aesthetic sorted by getSelectedPhotos),
 * drop aerial shots, and cap to WALKTHROUGH_MAX_REFERENCE_IMAGES (5) — a
 * tighter cap than the model's own max (SEEDANCE_MAX_REFERENCE_IMAGES, 9);
 * see the cinematic-v2 docblock at the top of this file for why.
 */
export function orderAndFilterPhotos(photos: Photo[]): Photo[] {
  const usable = photos.filter((p) => !isAerialRoom(p.room_type));
  const exterior = usable.filter((p) => isExteriorRoom(p.room_type));
  const interior = usable.filter((p) => !isExteriorRoom(p.room_type));
  const cap = Math.min(WALKTHROUGH_MAX_REFERENCE_IMAGES, SEEDANCE_MAX_REFERENCE_IMAGES);
  return [...exterior, ...interior].slice(0, cap);
}

function roomLabel(photo: Photo): string {
  if (!photo.room_type) return "room";
  return photo.room_type.replace(/_/g, " ");
}

/** "Image order: 1=exterior front, 2=living room, ..., N=kitchen." */
export function buildManifest(photos: Photo[]): string {
  const parts = photos.map((p, i) => `${i + 1}=${roomLabel(p)}`);
  return `Image order: ${parts.join(", ")}.`;
}

/**
 * Full prompt: the stable forward-only skeleton first, the ordered image
 * manifest last — cache-friendly-prompt-structure convention (stable
 * prefix, variable content last), and matches spatial.ts's per-segment
 * prompt shape (WALKTHROUGH_SKELETON_PROMPT + variable content appended).
 */
export function buildWalkthroughPrompt(photos: Photo[]): string {
  return `${WALKTHROUGH_PROMPT_BASE}\n\n${buildManifest(photos)}`;
}

/**
 * Submits the walkthrough render job and returns immediately. Does NOT wait
 * for the render (~500s) — call `pollWalkthrough()` afterward, repeatedly,
 * to observe completion.
 */
export async function submitWalkthrough(propertyId: string): Promise<SubmitWalkthroughResult> {
  if (!writesAllowed()) {
    return {
      status: "skipped",
      reason: "writes disabled on non-prod (set LE_ALLOW_NONPROD_WRITES=true)",
    };
  }

  // In-flight guard: a submit already processing/finalizing and recently
  // updated means a paid Atlas job is already running — return it instead of
  // firing a second render (double-billing). A stale walkthrough_updated_at
  // (>20min) means the prior job is presumed stuck/abandoned, so we fall
  // through and allow a fresh submit.
  const { data: existing, error: existingErr } = await getSupabase()
    .from("properties")
    .select("walkthrough_status, walkthrough_job_id, walkthrough_updated_at")
    .eq("id", propertyId)
    .single();
  if (existingErr) throw existingErr;

  const existingStatus = (existing?.walkthrough_status as string | null) ?? null;
  const existingJobId = (existing?.walkthrough_job_id as string | null) ?? null;
  const existingUpdatedAt = (existing?.walkthrough_updated_at as string | null) ?? null;
  const IN_FLIGHT_TTL_MS = 20 * 60 * 1000;
  if (
    (existingStatus === "processing" || existingStatus === "finalizing") &&
    existingJobId &&
    existingUpdatedAt &&
    Date.now() - new Date(existingUpdatedAt).getTime() < IN_FLIGHT_TTL_MS
  ) {
    return { status: "processing", jobId: existingJobId };
  }

  let photos = await getSelectedPhotos(propertyId);
  if (photos.length < MIN_REFERENCE_IMAGES) {
    photos = await getPhotosForProperty(propertyId);
  }

  const ordered = orderAndFilterPhotos(photos);
  if (ordered.length < MIN_REFERENCE_IMAGES) {
    return {
      status: "skipped",
      reason: `not enough usable photos for a walkthrough (${ordered.length} usable, need at least ${MIN_REFERENCE_IMAGES})`,
    };
  }

  const prompt = buildWalkthroughPrompt(ordered);
  const referenceImageUrls = ordered.map((p) => p.file_url);

  const provider = new AtlasProvider(SKU);
  const job = await provider.generateReferenceClip({
    referenceImageUrls,
    prompt,
    durationSeconds: WALKTHROUGH_DURATION_SECONDS,
    resolution: WALKTHROUGH_RESOLUTION,
  });

  const { error } = await getSupabase()
    .from("properties")
    .update({
      walkthrough_job_id: job.jobId,
      walkthrough_status: "processing",
      walkthrough_error: null,
      // Null out the previous render so a "Regenerate" doesn't show stale
      // video while the new job is in flight.
      walkthrough_video_url: null,
      walkthrough_updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);
  if (error) throw error;

  return { status: "processing", jobId: job.jobId };
}

/**
 * Cheap status check — safe to call repeatedly from a route with a small
 * maxDuration. On first observing a terminal Atlas status it finalizes:
 * complete → download + host on Bunny + record cost + persist URL;
 * failed → persist the error. Subsequent calls after finalization read the
 * already-persisted state and make no further provider calls (idempotent,
 * avoids double-billing).
 *
 * `walkthrough_status` is a free-text column (no enum, no migration needed
 * for new values). Possible values: 'processing' | 'finalizing' | 'complete'
 * | 'failed'. 'finalizing' is a transient, non-terminal claim state: it lets
 * a compare-and-swap update pick exactly one winner among concurrent polls
 * to run the paid download+host+cost-record+commit sequence, so treat it as
 * processing-like everywhere except the claim itself.
 */
export async function pollWalkthrough(propertyId: string): Promise<PollWalkthroughResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("properties")
    .select("walkthrough_job_id, walkthrough_status, walkthrough_video_url, walkthrough_error")
    .eq("id", propertyId)
    .single();
  if (error) throw error;

  const jobId = (data?.walkthrough_job_id as string | null) ?? null;
  const status = (data?.walkthrough_status as string | null) ?? null;

  if (!jobId) {
    return { status: "idle" };
  }
  if (status === "complete") {
    return { status: "complete", videoUrl: (data?.walkthrough_video_url as string | null) ?? undefined };
  }
  if (status === "failed") {
    return { status: "failed", error: (data?.walkthrough_error as string | null) ?? undefined };
  }

  const provider = new AtlasProvider(SKU);
  const result = await provider.checkStatus(jobId);

  if (result.status === "processing") {
    return { status: "processing" };
  }

  if (result.status === "failed") {
    const errMsg = result.error ?? `Atlas job ${jobId} failed`;
    // Non-prod without the opt-in flag must not mutate the shared DB —
    // report the failure to the caller without persisting it; a prod poll
    // (or a later poll with the flag set) will observe the same Atlas
    // status and persist it then.
    if (writesAllowed()) {
      const { error: updateErr } = await supabase
        .from("properties")
        .update({
          walkthrough_status: "failed",
          walkthrough_error: errMsg,
          walkthrough_updated_at: new Date().toISOString(),
        })
        .eq("id", propertyId)
        .in("walkthrough_status", ["processing", "finalizing"]);
      if (updateErr) throw updateErr;
    }
    return { status: "failed", error: errMsg };
  }

  // result.status === "complete"
  if (!result.videoUrl) {
    const errMsg = `Atlas job ${jobId} reported complete but returned no video URL`;
    if (writesAllowed()) {
      const { error: updateErr } = await supabase
        .from("properties")
        .update({
          walkthrough_status: "failed",
          walkthrough_error: errMsg,
          walkthrough_updated_at: new Date().toISOString(),
        })
        .eq("id", propertyId)
        .in("walkthrough_status", ["processing", "finalizing"]);
      if (updateErr) throw updateErr;
    }
    return { status: "failed", error: errMsg };
  }

  // Everything below this point is the paid finalize sequence (CAS claim,
  // Bunny host, cost insert, final commit) — never run it from a non-prod
  // caller without the opt-in flag. The Atlas job stays complete-but-
  // unclaimed on their end; a prod poll (or a later poll with the flag set)
  // will claim and finalize it. See module docblock's write-guard note.
  if (!writesAllowed()) {
    return { status: "processing" };
  }

  // Atomic finalize claim: at most one concurrent poll may proceed past this
  // point to run the paid download + Bunny host + cost record + final
  // commit. The compare-and-swap only succeeds for a caller that observes
  // status==='processing', or a stale 'finalizing' claim (>3min old — the
  // previous claimant crashed mid-finalize and never committed). Every other
  // concurrent poll gets 0 rows back here and reports "processing" instead
  // of re-running the paid work.
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("properties")
    .update({ walkthrough_status: "finalizing", walkthrough_updated_at: nowIso })
    .eq("id", propertyId)
    .or(
      `walkthrough_status.eq.processing,and(walkthrough_status.eq.finalizing,walkthrough_updated_at.lt.${staleIso})`,
    )
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed?.length) {
    // Another poll already owns finalization (or just finished it — a
    // subsequent poll will observe status==='complete' via the early return
    // above). Do not race the claimer.
    return { status: "processing" };
  }

  let finalUrl = result.videoUrl;

  // Host on Bunny Stream (shared CDN across envs). A Bunny outage/misconfig
  // must never block finalizing the walkthrough — fall back to the raw
  // Atlas provider URL, matching lib/assembly/finalize.ts's convention.
  if (writesAllowed() && isBunnyConfigured()) {
    try {
      const bytes = await provider.downloadClip(result.videoUrl);
      const hosted = await hostVideoOnBunny(`walkthrough_${propertyId}`, bytes);
      finalUrl = hosted.mp4Url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[walkthrough] bunny host failed — keeping provider URL", {
        propertyId,
        jobId,
        msg,
      });
    }
  }

  // Idempotent cost insert, keyed on the Atlas jobId stored in metadata.
  // Backstop against a crash between the cost insert and the final status
  // commit below: if a retry re-enters this path (e.g. via a stale
  // 'finalizing' claim reclaim), we must not double-bill the same render.
  const { data: existingCostRows, error: costLookupErr } = await supabase
    .from("cost_events")
    .select("id")
    .eq("provider", "atlas")
    .contains("metadata", { jobId })
    .limit(1);
  if (costLookupErr) throw costLookupErr;

  if (!existingCostRows?.length) {
    // Cost recording is never optional and never silenced — recordCostEvent
    // throws on insert failure, and that throw is intentionally left to
    // propagate to the caller (route handler surfaces a 500) rather than
    // being caught and swallowed here. See module docblock for why we compute
    // costCents from duration × priceCentsPerSecond instead of trusting
    // checkStatus()'s fixed-clip costCents for this duration-variable SKU.
    const costCents = atlasClipCostCents(SKU, WALKTHROUGH_DURATION_SECONDS) || result.costCents || 0;
    await recordCostEvent({
      propertyId,
      stage: "generation",
      provider: "atlas",
      costCents,
      unitsConsumed: result.providerUnits,
      unitType: result.providerUnitType ?? null,
      metadata: {
        sku: SKU,
        jobId,
        durationSeconds: WALKTHROUGH_DURATION_SECONDS,
        resolution: WALKTHROUGH_RESOLUTION,
        bunnyHosted: finalUrl !== result.videoUrl,
      },
    });
  }

  const { error: finalizeErr } = await supabase
    .from("properties")
    .update({
      walkthrough_status: "complete",
      walkthrough_video_url: finalUrl,
      walkthrough_error: null,
      walkthrough_updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);
  if (finalizeErr) throw finalizeErr;

  return { status: "complete", videoUrl: finalUrl };
}
