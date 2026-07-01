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
 */

import { getSupabase, getSelectedPhotos, getPhotosForProperty, recordCostEvent } from "../db.js";
import type { Photo } from "../types.js";
import {
  AtlasProvider,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  atlasClipCostCents,
} from "../providers/atlas.js";
import { hostVideoOnBunny, isBunnyConfigured } from "../providers/bunny-stream.js";

const SKU = "seedance-reference-walkthrough" as const;

const WALKTHROUGH_PROMPT_BASE =
  "Using all provided listing photos as references, generate a SINGLE CONTINUOUS first-person walkthrough beginning outside the property and smoothly entering through the front door. Move the camera in ONE uninterrupted continuous path through the entire home, revealing each space in logical order as if filmed on a stabilized gimbal. Preserve exact architecture, room layouts, furniture, decor, colors, materials and lighting from the references. Maintain consistent spatial relationships and realistic room connections. Prioritize accurate continuous navigation over cinematic effects. Bright inviting atmosphere, photorealistic, realistic depth and parallax. Absolutely NO cuts, NO teleporting between rooms, NO shot changes, no floating camera, no people, no text, no added objects, no redesigned spaces, no distortion, no camera shake. One seamless continuous tour from exterior to every major interior space.";

const WALKTHROUGH_DURATION_SECONDS = 15;
const WALKTHROUGH_RESOLUTION = "1080p" as const;
const MIN_REFERENCE_IMAGES = 2;

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
 * drop aerial shots, and cap to the model's max reference-image count.
 */
export function orderAndFilterPhotos(photos: Photo[]): Photo[] {
  const usable = photos.filter((p) => !isAerialRoom(p.room_type));
  const exterior = usable.filter((p) => isExteriorRoom(p.room_type));
  const interior = usable.filter((p) => !isExteriorRoom(p.room_type));
  return [...exterior, ...interior].slice(0, SEEDANCE_MAX_REFERENCE_IMAGES);
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

/** Full prompt: ordered manifest line first, then the validated base prompt. */
export function buildWalkthroughPrompt(photos: Photo[]): string {
  return `${buildManifest(photos)}\n\n${WALKTHROUGH_PROMPT_BASE}`;
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
    const { error: updateErr } = await supabase
      .from("properties")
      .update({
        walkthrough_status: "failed",
        walkthrough_error: errMsg,
        walkthrough_updated_at: new Date().toISOString(),
      })
      .eq("id", propertyId);
    if (updateErr) throw updateErr;
    return { status: "failed", error: errMsg };
  }

  // result.status === "complete"
  if (!result.videoUrl) {
    const errMsg = `Atlas job ${jobId} reported complete but returned no video URL`;
    const { error: updateErr } = await supabase
      .from("properties")
      .update({
        walkthrough_status: "failed",
        walkthrough_error: errMsg,
        walkthrough_updated_at: new Date().toISOString(),
      })
      .eq("id", propertyId);
    if (updateErr) throw updateErr;
    return { status: "failed", error: errMsg };
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
