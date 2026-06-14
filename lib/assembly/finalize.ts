/**
 * Assembly Finalize Step
 *
 * Called after each successful provider render. Responsibilities:
 *   1. Download the provider MP4 byte-for-byte via fetch.
 *   2. Host the final video on Bunny Stream and return Bunny's direct MP4 CDN
 *      URL — eliminating the latent data-loss risk of provider-hosted URLs with
 *      undocumented retention periods, and moving delivery onto Bunny's cheap
 *      CDN (≈$0.005/GB) instead of Supabase Storage (≈$0.09/GB).
 *   3. Compute delivered_bitrate_kbps from downloaded file size (no ffprobe
 *      in production — pure arithmetic). Emit a warn-level console.warn when
 *      the bitrate is below the pixel-scaled floor (ASSEMBLY_MIN_KBPS env,
 *      default 9 000 kbps at 1920×1080). Never blocks delivery.
 *   4. On any failure (download, Bunny unconfigured, OR Bunny host error) falls
 *      back gracefully to the provider URL — zero-HITL is maintained: a Bunny
 *      outage must NEVER block delivery.
 *
 * Kill switch: set LE_ASSEMBLY_FINALIZE=off to bypass the step entirely.
 * Write guard: Bunny hosting only happens when VERCEL_ENV==='production'
 *   OR LE_ALLOW_NONPROD_WRITES==='true' (shared-resource safety per project
 *   convention — non-prod still downloads + computes bitrate, just no host).
 *
 * Cost tracking: finalize itself emits no cost_events row. The caller
 * (pipeline.ts) records the Bunny Stream cost via bunnyStreamCostCents(outputBytes)
 * using the returned outputBytes — same shape as the assembly provider cost it
 * already emits after this step.
 *
 * Rollback: LE_ASSEMBLY_FINALIZE=off or revert this file + the pipeline.ts
 *   call sites. The caller's horizontal_video_url / vertical_video_url will
 *   revert to the raw provider URL (pre-finalize behavior).
 */

import { hostVideoOnBunny, isBunnyConfigured, deleteBunnyVideo, validateBunnyMp4Url } from "../providers/bunny-stream.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinalizeParams {
  /** Owning property. Used in the Bunny title and log messages. */
  propertyId: string;
  /** Output orientation — determines the orientation segment of the Bunny title. */
  aspectRatio: "16:9" | "9:16";
  /** The URL returned by Creatomate / Shotstack after a successful render. */
  providerUrl: string;
  /** Render duration in seconds — required for bitrate computation. */
  durationSeconds: number;
  /**
   * Version suffix encoded in the Bunny title (e.g. 1 → final_horizontal_v1_<id>).
   * Both call sites in pipeline.ts pass the literal 1. Bunny creates a fresh
   * video object per upload (distinct GUID), so reruns produce distinct hosted
   * objects rather than overwriting in place — the caller persists the newest
   * URL. Wire a real run/attempt counter here when per-rerun history is needed.
   */
  version: number;
}

export interface FinalizeResult {
  /**
   * The URL to store in horizontal_video_url / vertical_video_url.
   * On success this is Bunny's direct MP4 CDN URL (directly fetchable — the
   * download endpoint and inline SPA player need a real MP4, not HLS/iframe).
   * On any failure (download, Bunny unconfigured, host error, or
   * kill-switch/guard) this is the original providerUrl — graceful
   * degradation, never null.
   */
  url: string;
  /**
   * Computed bitrate in kbps from (outputBytes * 8 / durationSeconds / 1000).
   * Null when the download step was skipped (kill switch) or failed.
   */
  bitrateKbps: number | null;
  /**
   * Raw byte count of the downloaded MP4. Null when download was skipped or
   * failed. Used by the caller to (a) log assembly cost_event metadata and
   * (b) compute the Bunny Stream cost_events row via bunnyStreamCostCents().
   */
  outputBytes: number | null;
  /**
   * True when hostVideoOnBunny was actually called — meaning real Bunny API
   * charges were incurred (createVideo + upload + encode) even if url fell
   * back to providerUrl (e.g. HEAD check failed after a successful upload).
   * The caller MUST emit a cost_events row whenever this is true, regardless
   * of whether url === providerUrl. Only false on kill-switch, env guard,
   * download failure, or Bunny unconfigured.
   */
  bunnyWasCalled: boolean;
}

// ---------------------------------------------------------------------------
// Bitrate floor
// ---------------------------------------------------------------------------

/**
 * Default minimum acceptable bitrate for a 1920×1080 assembly output.
 * 9 000 kbps ≈ 9 Mbps — above Creatomate's native ~6 Mbps ceiling and
 * matching the lower bound seen on Shotstack high-quality renders.
 * Derived from the 2026-06-11 ffprobe audit: source clips 48–53 Mbps;
 * assembled Creatomate output 5.96 Mbps; assembled Shotstack TBD.
 *
 * Override with ASSEMBLY_MIN_KBPS env var (integer kbps; 0 disables check).
 */
const DEFAULT_MIN_KBPS_AT_1080P = 9_000;

/**
 * Compute the bitrate floor for the given aspect ratio.
 *
 * Horizontal (16:9): Creatomate renders at a 2880×1620 supersampled canvas,
 * producing ~19 Mbps — well above the 9 Mbps floor.
 *
 * Vertical (9:16): Creatomate renders at the native 1080×1920 canvas (no
 * supersample). Its bitrate ceiling is ~6 Mbps, which is BELOW the 9 Mbps
 * horizontal floor. Applying the same floor to vertical would cause a
 * guaranteed warn on every single vertical render — pure log noise with no
 * actionable signal. Until a supersampled vertical path is implemented,
 * the vertical floor is disabled (returns 0) unless ASSEMBLY_MIN_KBPS is
 * explicitly set by the operator.
 *
 * Override with ASSEMBLY_MIN_KBPS env var (integer kbps; 0 disables check;
 * applies to BOTH orientations when set).
 */
function bitrateFloorKbps(aspectRatio: '16:9' | '9:16'): number {
  const envVal = process.env.ASSEMBLY_MIN_KBPS;
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  // Vertical stays at Creatomate's ~6 Mbps ceiling (no supersample); disable
  // the floor to avoid guaranteed-firing log noise on every vertical render.
  if (aspectRatio === '9:16') return 0;
  return DEFAULT_MIN_KBPS_AT_1080P;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Finalize an assembly render by hosting the provider MP4 on Bunny Stream and
 * computing delivery telemetry. Always resolves — never rejects (a Bunny
 * outage must never block delivery; zero-HITL is a hard product requirement).
 */
export async function finalizeAssemblyRender(
  params: FinalizeParams,
): Promise<FinalizeResult> {
  const { propertyId, aspectRatio, providerUrl, durationSeconds, version } = params;

  // ── Kill switch ───────────────────────────────────────────────────────────
  if ((process.env.LE_ASSEMBLY_FINALIZE ?? "").toLowerCase() === "off") {
    return { url: providerUrl, bitrateKbps: null, outputBytes: null, bunnyWasCalled: false };
  }

  const orientation = aspectRatio === "16:9" ? "horizontal" : "vertical";
  const bunnyTitle = `final_${orientation}_v${version}_${propertyId}`;

  // ── Download ──────────────────────────────────────────────────────────────
  let videoBytes: Uint8Array;
  try {
    const resp = await fetch(providerUrl);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} fetching ${providerUrl}`);
    }
    videoBytes = new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[assembly-finalize] download failed — keeping provider URL", { msg, providerUrl });
    return { url: providerUrl, bitrateKbps: null, outputBytes: null, bunnyWasCalled: false };
  }

  const outputBytes = videoBytes.byteLength;

  // ── Bitrate telemetry (compute always; warn below floor; never block) ─────
  const bitrateKbps = durationSeconds > 0
    ? Math.round((outputBytes * 8) / durationSeconds / 1000)
    : null;

  const floor = bitrateFloorKbps(aspectRatio);
  if (floor > 0 && bitrateKbps !== null && bitrateKbps < floor) {
    console.warn(
      "[assembly-finalize] low bitrate warning — assembly output below quality floor",
      {
        propertyId,
        aspectRatio,
        bitrateKbps,
        floorKbps: floor,
        outputBytes,
        durationSeconds,
        providerUrl,
      },
    );
  }

  // ── Env write guard ───────────────────────────────────────────────────────
  const canWrite =
    process.env.VERCEL_ENV === "production" ||
    process.env.LE_ALLOW_NONPROD_WRITES === "true";

  if (!canWrite) {
    // Non-prod without the override flag — skip the Bunny host; return provider
    // URL. Bitrate is still computed above so dev environments can observe it
    // in logs without writing to the shared Bunny library.
    return { url: providerUrl, bitrateKbps, outputBytes, bunnyWasCalled: false };
  }

  // ── Host on Bunny Stream ──────────────────────────────────────────────────
  // A Bunny outage or misconfig must NEVER block delivery (zero-HITL hard
  // requirement): fall back to the provider URL on any failure.
  if (!isBunnyConfigured()) {
    console.warn("[assembly-finalize] Bunny Stream not configured — keeping provider URL", {
      propertyId,
      bunnyTitle,
    });
    return { url: providerUrl, bitrateKbps, outputBytes, bunnyWasCalled: false };
  }

  try {
    const hosted = await hostVideoOnBunny(bunnyTitle, videoBytes);
    // Validate the MP4 URL before persisting — sends the Referer header required
    // by Bunny library 679131's referrer allow-listing (server-side fetches have
    // no Referer by default → 403). If MP4 Fallback is also disabled, Bunny
    // returns status FINISHED but the rendition URL 404s — either way a bad URL
    // must never become horizontal_video_url (zero-HITL guarantee).
    const mp4Valid = await validateBunnyMp4Url(hosted.mp4Url);
    if (!mp4Valid) {
      console.warn(
        "[assembly-finalize] mp4Url HEAD check failed — falling back to provider URL",
        { mp4Url: hosted.mp4Url, propertyId, bunnyTitle },
      );
      // Clean up the orphaned Bunny object — upload succeeded but the rendition
      // URL is inaccessible or 403. Best-effort: a delete failure is non-fatal.
      deleteBunnyVideo(hosted.guid).catch(() => {});
      return { url: providerUrl, bitrateKbps, outputBytes, bunnyWasCalled: true };
    }
    return { url: hosted.mp4Url, bitrateKbps, outputBytes, bunnyWasCalled: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[assembly-finalize] bunny host failed — keeping provider URL", {
      msg,
      propertyId,
      bunnyTitle,
    });
    return { url: providerUrl, bitrateKbps, outputBytes, bunnyWasCalled: false };
  }
}
