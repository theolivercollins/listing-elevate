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
  setDeliveryRunId,
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
import { createRun, getRun, revertRun, setListingDetails } from "../delivery/runs.js";
import { runScrapeStage } from "../delivery/scrape.js";
import type { DeliveryVideoType } from "../types/operator-studio.js";

// ── Defaults ──────────────────────────────────────────────────────────────────
// Match the only live production templates (JUST_LISTED 15/30 horizontal).
// See docs/state/PROJECT-STATE.md and MEMORY.md operator-studio-template-config.

const DEFAULT_PACKAGE = "JUST_LISTED";
const DEFAULT_DURATION = 30;
const DEFAULT_ORIENTATION = "horizontal";

/**
 * video_type for the operator delivery_runs row created on the new
 * delivery-pipeline path — Drive intakes always map to the "just listed"
 * default (delivery_runs.video_type CHECK constraint: migration 080).
 */
const DELIVERY_VIDEO_TYPE: DeliveryVideoType = "just_listed";

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

/**
 * Routing flag for the Operator Studio delivery pipeline (delivery_runs +
 * auto_run) vs. the legacy, lighter customer pipeline. Unset or 'true' → new
 * delivery path (the default going forward); explicit 'false' → the old
 * customer-only path, byte-for-byte unchanged, for a safe rollback.
 */
function isDeliveryPipelineEnabled(): boolean {
  return process.env.DRIVE_INTAKE_USE_DELIVERY_PIPELINE !== "false";
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
 * P1-2: createProperty's own TS param type (lib/db.ts — out of scope for this
 * task's file list) still declares price/bedrooms/bathrooms as non-null
 * `number`, but the underlying `properties` table already tolerates null on
 * these same columns. Strongest evidence: lib/types/operator-studio.ts's
 * ManualIngestInput (bedrooms/bathrooms/price: number | null) is the typed
 * input to lib/operator-studio/ingest.ts's manualIngest(), which writes
 * those exact values straight into a raw `properties` insert — no NOT NULL
 * violation. Same pattern in api/admin/studio/drive/pull.ts and
 * src/pages/dashboard/studio/StudioNew.tsx. All three bypass createProperty's
 * typed signature entirely via a direct `supabase.from('properties').insert`.
 * That's a pre-existing type/reality mismatch in lib/db.ts (not verified
 * against the live schema directly in this pass — no DB/MCP access in this
 * dispatch — but corroborated by three independent in-repo call sites), not
 * something this fix should paper over by seeding a fake 0. Rather than
 * widen a shared exported signature outside this task's touched files,
 * structurally check the real (nullable-MLS) shape here and cast down to
 * createProperty's declared parameter type at this one call site.
 */
type CreatePropertyInput = Parameters<typeof createProperty>[0];
function propertyInputWithNullableMls(
  input: Omit<CreatePropertyInput, "price" | "bedrooms" | "bathrooms"> & {
    price: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
  },
): CreatePropertyInput {
  return input as CreatePropertyInput;
}

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
    //
    //    P1-2: seed NULL (not 0) for a field MLS didn't return. Seeding 0 made
    //    runScrapeStage's prefill-skip guard (lib/delivery/scrape.ts: bedrooms
    //    != null && bathrooms != null && price != null) take the prefill
    //    branch and NEVER call the real Redfin scrape — enrichment was
    //    unreachable and every MLS-miss listing paused at the details gate
    //    with 0/0/0 forever. Seeding null lets that guard correctly fall
    //    through to the real scrape on a miss (or leave the details gate
    //    genuinely empty for the operator to fill in conversationally if
    //    Redfin also misses); a real MLS hit still populates real numbers
    //    and passes the gate exactly as before.
    const property = await createProperty(propertyInputWithNullableMls({
      address: intake.address,
      price: mlsPrice,
      bedrooms: mlsBedrooms,
      bathrooms: mlsBathrooms,
      listing_agent: mlsAgent ?? "Unknown",
      selected_package: DEFAULT_PACKAGE,
      selected_duration: DEFAULT_DURATION,
      selected_orientation: DEFAULT_ORIENTATION,
      submitted_by: "drive-intake",
      add_custom_request: !!intake.feedback_notes,
      custom_request_text: intake.feedback_notes ?? null,
      status: "queued",
    }));

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

    // 6.5 Route through the Operator Studio delivery pipeline (delivery_runs +
    // auto_run) instead of the lighter customer pipeline, so this render lands
    // on the full refine-able surface. Gated by DRIVE_INTAKE_USE_DELIVERY_PIPELINE
    // for a clean rollback (see isDeliveryPipelineEnabled()). A failure anywhere in
    // this block throws to the outer catch — a delivery-pipeline property with
    // no run can't be refined, so there's no meaningful partial-success
    // fallback to swallow into (matches how insertPhotos/createProperty
    // failures already propagate above).
    let deliveryRunId: string | undefined;
    if (isDeliveryPipelineEnabled()) {
      // order_mode='operator' mirrors manualIngest (lib/operator-studio/
      // ingest.ts, which sets it inline on the INSERT). createProperty() here
      // has no order_mode param, so this is a direct, unconditional update.
      const { error: orderModeError } = await getSupabase()
        .from("properties")
        .update({ order_mode: "operator", updated_at: new Date().toISOString() })
        .eq("id", propertyId);
      if (orderModeError) throw orderModeError;

      const run = await createRun({
        property_id: propertyId,
        client_id: null,
        video_type: DELIVERY_VIDEO_TYPE,
        duration_seconds: DEFAULT_DURATION,
        auto_run: true,
      });
      await setDeliveryRunId(intakeId, run.id);
      deliveryRunId = run.id;
    }

    // 7. Fire pipeline — fire-and-forget, exactly as in api/stripe/webhook.ts.
    // It drives intake→analysis→pause at photo_selection; the auto-run sweep
    // then takes over from there (a genuine MLS-miss at the details gate —
    // beds/baths/price 0 or null — is EXPECTED and is what lets the
    // conversational agent resolve it later; do not try to force past it).
    runPipeline(propertyId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[drive/orchestrate] runPipeline error for ${propertyId}:`,
        msg,
      );
    });

    // 7.5 Fire the scrape stage AFTER kicking runPipeline — replicates the
    // exact call order the operator StudioNew flow uses (ingest → runPipeline
    // → scrape; see src/pages/dashboard/studio/StudioNew.tsx lines ~340-358).
    // Fire-and-forget: never block the webhook on a Redfin/Apify network
    // call. Stage constraint verified: runScrapeStage only requires the run
    // to be at 'intake' or 'scraping' — it advances intake→scraping itself
    // when needed (idempotent CAS via advanceRun) and races safely against
    // runPipeline's own intake→scraping→photo_selection bump
    // (advanceRunToPhotoSelection in lib/delivery/photo-selection-stage.ts
    // uses the same isBenignAdvanceRace-tolerant retry). In practice scrape's
    // read of the fresh 'intake' run wins the race almost immediately, long
    // before analysis (many seconds of Gemini calls) reaches photo_selection.
    if (deliveryRunId) {
      runScrapeStage(deliveryRunId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[drive/orchestrate] runScrapeStage error for ${deliveryRunId}:`,
          msg,
        );
      });
    }

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

    // Delivery-pipeline run reconciliation — only when this intake was routed
    // through the operator delivery pipeline (approveIntake set
    // delivery_run_id). Constraint: delivery_runs has a PARTIAL unique index
    // on (property_id, video_type) WHERE stage <> 'delivered' (migration 080)
    // — a second createRun while the existing run is still non-delivered
    // would violate it, so revertRun re-drives the SAME row instead. Revert
    // target is specifically 'intake' (not "one stage back"): the re-fire
    // below is the generic runPipeline(propertyId), and its
    // pauseForOperatorPhotoSelection → advanceRunToPhotoSelection helper
    // (lib/delivery/photo-selection-stage.ts) only knows how to re-drive a
    // run sitting at 'intake' or 'scraping' — reverting to any later stage
    // would desync delivery_runs.stage from what actually re-runs. A
    // delivered run frees the unique-index slot, so a fresh createRun is
    // safe there (and necessary — a delivered run has nothing left to
    // revert-and-rerun). This is intentionally minimal/mechanical; the rich
    // conversational regenerate (targeted single-stage resume, notes fed to
    // the planner, etc.) is Wave B/C's job.
    if (intake.delivery_run_id) {
      const run = await getRun(intake.delivery_run_id);
      if (run) {
        if (run.stage === "delivered") {
          const freshRun = await createRun({
            property_id: intake.property_id,
            client_id: run.client_id,
            video_type: run.video_type,
            duration_seconds: run.duration_seconds,
            auto_run: run.auto_run,
          });
          await setDeliveryRunId(intakeId, freshRun.id);

          // Carry the delivered run's listing_details forward onto the fresh
          // run. Without this, the fresh run starts at listing_details='{}'
          // (migration 080 column default) and the auto-run 'details' gate
          // (lib/delivery/auto-run.ts resolveDetails — requires price/beds/
          // baths all present) pauses it unnecessarily, making the
          // conversational agent ask for info this property already had.
          // `run` here IS the prior/delivered run fetched above — no extra
          // getRun call needed. setListingDetails is the same setter
          // lib/delivery/scrape.ts's runScrapeStage uses (whole-column
          // REPLACE). A delivered run should always carry real details (that
          // gate is what let it reach 'delivered'); fall back to firing the
          // scrape stage — fire-and-forget, exactly like approveIntake's 7.5
          // — only in the defensive case where it somehow doesn't.
          const priorDetails = run.listing_details;
          if (priorDetails && Object.keys(priorDetails).length > 0) {
            await setListingDetails(freshRun.id, priorDetails);
          } else {
            runScrapeStage(freshRun.id).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(
                `[drive/orchestrate] runScrapeStage error on regen (fresh run) for ${freshRun.id}:`,
                msg,
              );
            });
          }
        } else if (run.stage !== "intake") {
          await revertRun(run.id, "intake");
        }
        // else: already at 'intake' — nothing to revert.
      }
      // run === null: dangling delivery_run_id (should not normally happen —
      // the FK is ON DELETE SET NULL) — tolerate and fall through to the
      // property-level re-fire below.
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
