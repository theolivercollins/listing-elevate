/**
 * Assembly Finalize Step
 *
 * Called after each successful provider render. Responsibilities:
 *   1. Download the provider MP4 byte-for-byte via fetch.
 *   2. Upload to Supabase Storage property-videos/{propertyId}/final_{h|v}_v{n}.mp4
 *      and return OUR public URL — eliminating the latent data-loss risk of
 *      provider-hosted URLs with undocumented retention periods.
 *   3. Compute delivered_bitrate_kbps from downloaded file size (no ffprobe
 *      in production — pure arithmetic). Emit a warn-level console.warn when
 *      the bitrate is below the pixel-scaled floor (ASSEMBLY_MIN_KBPS env,
 *      default 9 000 kbps at 1920×1080). Never blocks delivery.
 *   4. On any failure (download OR upload) falls back gracefully to the
 *      provider URL exactly as today — zero-HITL is maintained.
 *
 * Kill switch: set LE_ASSEMBLY_FINALIZE=off to bypass the step entirely.
 * Write guard: storage writes only happen when VERCEL_ENV==='production'
 *   OR LE_ALLOW_NONPROD_WRITES==='true' (shared-DB safety per project convention).
 *
 * Rollback: LE_ASSEMBLY_FINALIZE=off or revert this file + the pipeline.ts
 *   call sites. The caller's horizontal_video_url / vertical_video_url will
 *   revert to the raw provider URL (pre-finalize behavior).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FinalizeParams {
  /** Owning property. Used in the storage path and log messages. */
  propertyId: string;
  /** Output orientation — determines the storage filename segment. */
  aspectRatio: "16:9" | "9:16";
  /** The URL returned by Creatomate / Shotstack after a successful render. */
  providerUrl: string;
  /** Render duration in seconds — required for bitrate computation. */
  durationSeconds: number;
  /**
   * Version suffix appended to the storage filename (e.g. "v1" → final_horizontal_v1.mp4).
   * Both call sites in pipeline.ts pass the literal 1, and the upload uses upsert:true,
   * so reruns currently overwrite the same object in place — stable URL, not distinct
   * per-rerun objects. That behaviour is intentional for now: a fixed public URL
   * simplifies delivery. Wire a real run/attempt counter here when per-rerun history
   * is needed.
   */
  version: number;
  /**
   * Supabase client instance. Accepted as a parameter so callers can inject
   * the already-constructed client without this module needing to call
   * getSupabase() (which reads env vars and causes issues in tests).
   */
  supabase: SupabaseClient;
}

export interface FinalizeResult {
  /**
   * The URL to store in horizontal_video_url / vertical_video_url.
   * On success this is the Supabase Storage public URL.
   * On any failure (download, upload, or kill-switch/guard) this is the
   * original providerUrl — graceful degradation, never null.
   */
  url: string;
  /**
   * Computed bitrate in kbps from (outputBytes * 8 / durationSeconds / 1000).
   * Null when the download step was skipped (kill switch) or failed.
   */
  bitrateKbps: number | null;
  /**
   * Raw byte count of the downloaded MP4. Null when download was skipped or
   * failed. Logged into the assembly cost_event metadata by the caller.
   */
  outputBytes: number | null;
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
 * Compute the pixel-scaled bitrate floor for the given output resolution.
 * A 1080p output uses DEFAULT_MIN_KBPS_AT_1080P. Larger outputs scale up
 * proportionally (pixel area ratio). 1920×1080 is the reference.
 *
 * Currently both AR paths produce 1920×1080-class outputs (horizontal is
 * supersampled to 2880×1620 by Creatomate but returned as 1080p-equivalent
 * content), so we use 1080p reference for both. Future: pass outputWidth +
 * outputHeight when the pipeline records them on AssemblyResult.
 */
function bitrateFloorKbps(): number {
  const envVal = process.env.ASSEMBLY_MIN_KBPS;
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_MIN_KBPS_AT_1080P;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Finalize an assembly render by mirroring the provider MP4 to Supabase
 * Storage and computing delivery telemetry. Always resolves — never rejects.
 */
export async function finalizeAssemblyRender(
  params: FinalizeParams,
): Promise<FinalizeResult> {
  const { propertyId, aspectRatio, providerUrl, durationSeconds, version, supabase } = params;

  // ── Kill switch ───────────────────────────────────────────────────────────
  if ((process.env.LE_ASSEMBLY_FINALIZE ?? "").toLowerCase() === "off") {
    return { url: providerUrl, bitrateKbps: null, outputBytes: null };
  }

  const orientation = aspectRatio === "16:9" ? "horizontal" : "vertical";
  const storagePath = `${propertyId}/final_${orientation}_v${version}.mp4`;

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
    return { url: providerUrl, bitrateKbps: null, outputBytes: null };
  }

  const outputBytes = videoBytes.byteLength;

  // ── Bitrate telemetry (compute always; warn below floor; never block) ─────
  const bitrateKbps = durationSeconds > 0
    ? Math.round((outputBytes * 8) / durationSeconds / 1000)
    : null;

  const floor = bitrateFloorKbps();
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
    // Non-prod without the override flag — skip storage write; return provider
    // URL. Bitrate is still computed above so dev environments can observe it
    // in logs without touching the shared DB.
    return { url: providerUrl, bitrateKbps, outputBytes };
  }

  // ── Upload to Supabase Storage ────────────────────────────────────────────
  try {
    const { error: uploadErr } = await supabase.storage
      .from("property-videos")
      .upload(storagePath, videoBytes, { contentType: "video/mp4", upsert: true });

    if (uploadErr) {
      throw new Error(uploadErr.message);
    }

    const { data: urlData } = supabase.storage
      .from("property-videos")
      .getPublicUrl(storagePath);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      throw new Error("getPublicUrl returned empty URL");
    }

    return { url: publicUrl, bitrateKbps, outputBytes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[assembly-finalize] storage upload failed — keeping provider URL", {
      msg,
      propertyId,
      storagePath,
    });
    return { url: providerUrl, bitrateKbps, outputBytes };
  }
}
