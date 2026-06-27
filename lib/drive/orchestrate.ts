/**
 * Approve / regenerate orchestration for Drive-intake rows.
 *
 * Non-prod write guard (mirrors lib/assembly/finalize.ts and
 * lib/pipeline/stuck-reaper.ts): property creation, photo uploads, and pipeline
 * triggers only run when VERCEL_ENV==='production' OR
 * LE_ALLOW_NONPROD_WRITES==='true'.
 *
 * Pipeline trigger pattern: runPipeline(propertyId).catch(...) — fire-and-
 * forget without await, exactly as done in api/stripe/webhook.ts and the
 * owner-bypass path of api/properties/index.ts.
 */

import {
  getIntake,
  setStatus,
  setPropertyId,
  appendFeedback,
  claimForApproval,
  claimForRegenerate,
} from "./intake-db.js";
import { lookupMlsByAddress } from "../mls/lookup.js";
import { sendMessage, escapeMarkdown } from "../telegram/client.js";
import { createProperty, getSupabase, updatePropertyStatus, insertPhotos } from "../db.js";
import { listFinalImages, downloadFile } from "./client.js";
import { uploadPhotosToStorage, getStoragePublicUrl } from "../../src/lib/photo-upload.js";
import { runPipeline } from "../pipeline.js";

// ── Defaults ──────────────────────────────────────────────────────────────────
// Match the only live production templates (JUST_LISTED 15/30 horizontal).
// See docs/state/PROJECT-STATE.md and MEMORY.md operator-studio-template-config.

const DEFAULT_PACKAGE = "JUST_LISTED";
const DEFAULT_DURATION = 30;
const DEFAULT_ORIENTATION = "horizontal";

// ── Caps ──────────────────────────────────────────────────────────────────────

/** Hard cap on Final images to download per intake (OOM guard). */
const MAX_IMAGES = 80;
/** Max concurrent Drive downloads per batch. */
const DOWNLOAD_CONCURRENCY = 5;

// ── Write guard ───────────────────────────────────────────────────────────────

function isWriteAllowed(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.LE_ALLOW_NONPROD_WRITES === "true"
  );
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface ApproveResult {
  status: "generating" | "skipped" | "error";
  propertyId?: string;
  reason?: string;
}

export interface RegenerateResult {
  status: "generating" | "skipped" | "error";
  propertyId?: string;
  reason?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Download Drive images in batches of DOWNLOAD_CONCURRENCY to avoid OOM on
 * large folders.
 */
async function batchedDownload(
  images: Array<{ id: string; name: string; mimeType: string }>,
): Promise<File[]> {
  const results: File[] = [];
  for (let i = 0; i < images.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = images.slice(i, i + DOWNLOAD_CONCURRENCY);
    const batchFiles = await Promise.all(
      batch.map(async ({ id, name, mimeType }) => {
        const { bytes } = await downloadFile(id);
        return new File([Buffer.from(bytes)], name, { type: mimeType });
      }),
    );
    results.push(...batchFiles);
  }
  return results;
}

// ── approveIntake ─────────────────────────────────────────────────────────────

/**
 * Approve a drive_intake row:
 *   1. Guard — must be awaiting_approval or approved.
 *   2. Non-prod write guard — return {status:'skipped'} when off.
 *   3. CAS claim (claimForApproval) — atomic status → ingesting; skip if already
 *      claimed by a concurrent redelivery.
 *   4. Enrich via MLS (best-effort), create property (queued), download + upload
 *      Final images (capped at MAX_IMAGES, batched), insert photos rows, update
 *      photo_count, fire pipeline, mark generating.
 *   5. On any throw — mark error and return {status:'error'}.
 */
export async function approveIntake(intakeId: string): Promise<ApproveResult> {
  // 1. Load intake
  const intake = await getIntake(intakeId);
  if (!intake) {
    return { status: "error", reason: "intake not found" };
  }
  if (intake.status !== "awaiting_approval" && intake.status !== "approved") {
    return {
      status: "error",
      reason: `intake status is '${intake.status}', expected awaiting_approval or approved`,
    };
  }

  // 2. Write-guard check — bail early without touching anything
  if (!isWriteAllowed()) {
    return { status: "skipped", reason: "non-prod" };
  }

  // Hoist propertyId so the catch block can mark it failed when the property
  // was created but a subsequent step threw (Fix 2 — orphaned-property guard).
  let propertyId: string | undefined;

  try {
    // 3. Atomic CAS claim — prevents double-render on concurrent Telegram redeliveries.
    //    claimForApproval does the status → ingesting transition atomically.
    const claimed = await claimForApproval(intakeId);
    if (!claimed) {
      return { status: "skipped", reason: "already-processing" };
    }

    // 4. MLS enrichment (tolerate failure — fall back to nulls so we always
    //    create the property, even if Apify is unconfigured or the address
    //    is not indexed yet)
    let mlsPrice: number | null = null;
    let mlsBedrooms: number | null = null;
    let mlsBathrooms: number | null = null;
    let mlsAgent: string | null = null;
    try {
      const mls = await lookupMlsByAddress(intake.address, null);
      mlsPrice = mls.price ?? null;
      mlsBedrooms = mls.bedrooms ?? null;
      mlsBathrooms = mls.bathrooms ?? null;
      mlsAgent = mls.agent ?? null;
    } catch {
      console.warn(
        `[drive/orchestrate] MLS lookup failed for '${intake.address}' — creating property with null fallbacks`,
      );
    }

    // 5. Create property with status='queued' so runPipeline can claim it.
    //    Mirrors the owner-bypass path in api/properties/index.ts which sets
    //    status='queued' and immediately fires runPipeline.
    const property = await createProperty({
      address: intake.address,
      price: mlsPrice ?? 0,
      bedrooms: mlsBedrooms ?? 0,
      bathrooms: mlsBathrooms ?? 0,
      listing_agent: mlsAgent ?? "Unknown",
      selected_package: DEFAULT_PACKAGE,
      selected_duration: DEFAULT_DURATION,
      selected_orientation: DEFAULT_ORIENTATION,
      submitted_by: "drive-intake",
      add_custom_request: !!intake.feedback_notes,
      custom_request_text: intake.feedback_notes ?? null,
      status: "queued",
    });

    propertyId = property.id;

    // Fix 2: Link the intake to the property IMMEDIATELY after creation so
    // a crash during photo download/upload leaves a traceable propertyId on
    // the intake row (not an orphaned 'queued' property that nothing owns).
    await setPropertyId(intakeId, propertyId);

    // 6. Download each Final/ image from Drive and upload to property-photos bucket.
    //    Cap at MAX_IMAGES to guard against OOM; batch downloads at DOWNLOAD_CONCURRENCY.
    //    Bridge: insertPhotos rows so the pipeline can read them from the photos table.
    //
    //    storagePaths is hoisted outside the final_folder_id block so the zero-
    //    photo guard (Fix 3) can fire unconditionally — catching both the case where
    //    final_folder_id is null (entire block skipped) and the case where upload
    //    returned empty after a transient failure.
    let storagePaths: string[] = [];

    if (intake.final_folder_id) {
      let images = await listFinalImages(intake.final_folder_id);

      if (images.length > MAX_IMAGES) {
        console.warn(
          `[drive/orchestrate] ${images.length} Final images for intake ${intakeId} — truncating to ${MAX_IMAGES}`,
        );
        images = images.slice(0, MAX_IMAGES);
      }

      const files = await batchedDownload(images);
      storagePaths = await uploadPhotosToStorage(files, `${propertyId}/raw`);

      // Inner guard: images were listed but upload returned empty paths (transient
      // upload failure). Caught here for a specific early-exit error message.
      if (storagePaths.length === 0) {
        throw new Error("Ingest produced 0 photos — pipeline not started");
      }

      const photoRecords = storagePaths.map((storagePath) => ({
        property_id: propertyId,
        file_url: getStoragePublicUrl(storagePath),
        file_name: storagePath.split("/").pop() ?? "unknown.jpg",
      }));
      await insertPhotos(photoRecords);
      await getSupabase()
        .from("properties")
        .update({
          photo_count: photoRecords.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", propertyId);
    }

    // Fix 3: Outer zero-photo guard — fires when final_folder_id was null
    // (the entire download/upload block was skipped) OR when upload returned
    // empty. Never fire the pipeline with zero source photos.
    if (storagePaths.length === 0) {
      throw new Error("Ingest produced 0 photos — pipeline not started");
    }

    // 7. Fire pipeline — fire-and-forget, exactly as in api/stripe/webhook.ts.
    runPipeline(propertyId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[drive/orchestrate] runPipeline error for ${propertyId}:`,
        msg,
      );
    });

    await setStatus(intakeId, "generating");

    return { status: "generating", propertyId };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[drive/orchestrate] approveIntake failed for ${intakeId}:`,
      reason,
    );
    // Fix 2: If the property was already created, mark it failed so it is
    // never claimed by runPipeline as a stale 'queued' row.
    if (propertyId) {
      await updatePropertyStatus(propertyId, "failed").catch(() => {});
    }
    // Persist the failure reason on the intake row so ops can diagnose.
    await setStatus(intakeId, "error", { feedback_notes: reason }).catch(() => {});
    // Notify operator via Telegram (best-effort — tolerate unconfigured bot).
    sendMessage(
      `⚠️ *${escapeMarkdown(intake.address)}* intake error: ${escapeMarkdown(reason)}`,
    ).catch(() => {});
    return { status: "error", reason };
  }
}

// ── regenerateIntake ──────────────────────────────────────────────────────────

/**
 * Append operator notes to the intake and property, reset property to 'queued',
 * re-fire the pipeline, and mark intake status → 'generating' so pollResults
 * can detect the new render.
 *
 * There is no dedicated "regenerate" entrypoint in lib/pipeline.ts; the
 * existing fire-and-forget runPipeline pattern with a status reset is used
 * (same as how the Re-run UI works via api/pipeline/[propertyId].ts).
 */
export async function regenerateIntake(
  intakeId: string,
  notes: string,
): Promise<RegenerateResult> {
  // Write-guard check
  if (!isWriteAllowed()) {
    return { status: "skipped", reason: "non-prod" };
  }

  const intake = await getIntake(intakeId);
  if (!intake) {
    return { status: "error", reason: "intake not found" };
  }
  if (!intake.property_id) {
    return {
      status: "error",
      reason: "no property_id on intake — call approveIntake first",
    };
  }

  // Fix 4: CAS claim — prevents two concurrent 🔁 taps from double-firing a
  // paid regeneration. Mirrors the claimForApproval pattern on the approve path.
  const regenClaimed = await claimForRegenerate(intakeId);
  if (!regenClaimed) {
    return { status: "skipped", reason: "already-processing" };
  }

  try {
    // Only append / merge notes when the caller actually provided content.
    if (notes.trim()) {
      // Append feedback notes to intake row
      await appendFeedback(intakeId, notes);

      // Merge notes into property.custom_request_text
      const supabase = getSupabase();
      const { data: propRow } = await supabase
        .from("properties")
        .select("custom_request_text")
        .eq("id", intake.property_id)
        .maybeSingle();
      const existingText =
        (propRow as { custom_request_text?: string | null } | null)
          ?.custom_request_text ?? null;
      const combinedText = existingText ? `${existingText}\n${notes}` : notes;

      await supabase
        .from("properties")
        .update({
          add_custom_request: true,
          custom_request_text: combinedText,
          updated_at: new Date().toISOString(),
        })
        .eq("id", intake.property_id);
    }

    // Reset property to 'queued' so tryClaimPipelineRun can acquire it
    await updatePropertyStatus(intake.property_id, "queued");

    // Fire pipeline — fire-and-forget
    runPipeline(intake.property_id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[drive/orchestrate] runPipeline error on regen for ${intake.property_id}:`,
        msg,
      );
    });

    // Re-arm pollResults by setting intake status back to 'generating'.
    await setStatus(intakeId, "generating");

    return { status: "generating", propertyId: intake.property_id };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[drive/orchestrate] regenerateIntake failed for ${intakeId}:`,
      reason,
    );
    // Unpin the intake from 'ingesting' so claimForRegenerate can accept it
    // again on the next operator tap — mirrors approveIntake's catch block.
    await setStatus(intakeId, "error", { feedback_notes: reason }).catch(() => {});
    // Notify operator via Telegram (best-effort — tolerate unconfigured bot).
    sendMessage(
      `⚠️ *${escapeMarkdown(intake.address)}* regen error: ${escapeMarkdown(reason)}`,
    ).catch(() => {});
    return { status: "error", reason };
  }
}
