import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabase } from "../../lib/client.js";
import { atlasClipCostCents } from "../../lib/providers/atlas.js";
import { pickProvider, isNativeKling } from "../../lib/providers/dispatch.js";
import { hostVideoOnBunny, isBunnyConfigured, bunnyStreamCostCents, deleteBunnyVideo, validateBunnyMp4Url } from "../../lib/providers/bunny-stream.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const { data: rendering } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("id, scene_id, provider_task_id, model_used")
    .eq("status", "rendering")
    .not("provider_task_id", "is", null)
    .limit(25);

  if (!rendering || rendering.length === 0) return res.status(200).json({ polled: 0 });

  let finalized = 0;
  let failed = 0;

  for (const iter of rendering) {
    // DM.3: Pick provider per-iteration. Native Kling iterations
    // (model_used='kling-v2-native') poll through KlingProvider; all
    // other Atlas SKUs continue through AtlasProvider.
    const provider = pickProvider(iter.model_used);
    try {
      const status = await provider.checkStatus(iter.provider_task_id!);
      if (status.status === "processing") continue;
      if (status.status === "failed") {
        await supabase
          .from("prompt_lab_listing_scene_iterations")
          .update({ status: "failed", render_error: status.error ?? "unknown" })
          .eq("id", iter.id);

        // CI.4: Record cost even for failed renders — over-attribute rather
        // than under-attribute. Provider invoices may charge for the attempt.
        // Native Kling: 0¢ (pre-paid credits; Kling refunds on failure).
        const nativeKlingFailed = isNativeKling(iter.model_used);
        const failedCostCents = nativeKlingFailed ? 0 : atlasClipCostCents(iter.model_used);
        const { error: failedCostErr } = await supabase.from("cost_events").insert({
          property_id: null,
          scene_id: null,
          stage: "generation",
          provider: nativeKlingFailed ? "kling" : "atlas",
          units_consumed: 1,
          unit_type: "renders",
          cost_cents: failedCostCents,
          metadata: nativeKlingFailed
            ? {
                scope: "lab_listing",
                scene_id: iter.scene_id,
                iteration_id: iter.id,
                model: iter.model_used,
                billing: "prepaid_credits_failed_refunded",
                render_outcome: "failed",
              }
            : {
                scope: "lab_listing",
                scene_id: iter.scene_id,
                iteration_id: iter.id,
                model: iter.model_used,
                render_outcome: "failed",
              },
        });
        if (failedCostErr) console.error("[poll-listing-iterations] failed cost_events insert:", failedCostErr);
        failed += 1;
        continue;
      }

      // Cost is computed from the iteration's actual model_used — NOT
      // from provider.checkStatus, which returns the AtlasProvider's
      // default-model price regardless of which SKU rendered. Atlas
      // bills per-second × clip duration; atlasClipCostCents wraps
      // the ATLAS_MODELS lookup + default 5s clip multiplier.
      // Native Kling: $0 (pre-paid credits — no per-clip cash cost).
      const nativeKling = isNativeKling(iter.model_used);
      const costCents = nativeKling ? 0 : atlasClipCostCents(iter.model_used);

      // Rehost the clip on Bunny Stream so URLs never expire (provider CDNs rotate).
      // Falls back to the provider URL on any Bunny failure — delivery must never block
      // (zero human-in-the-loop requirement).
      let persistedUrl = status.videoUrl!;
      const rehostPath = `lab-listing/${iter.scene_id}/${iter.id}.mp4`;
      try {
        const buffer = await provider.downloadClip(status.videoUrl!);
        if (isBunnyConfigured()) {
          const bunnyResult = await hostVideoOnBunny(rehostPath, buffer);
          // HEAD-validate before persisting — sends the Referer header required by
          // Bunny library 679131's referrer allow-listing (server-side fetches have
          // no Referer by default → 403). bunny_hosted reflects the actual result.
          const mp4Valid = await validateBunnyMp4Url(bunnyResult.mp4Url);
          if (mp4Valid) {
            persistedUrl = bunnyResult.mp4Url;
          } else {
            console.warn(`[poll-listing-iterations] bunny mp4Url HEAD failed for ${rehostPath} — keeping provider URL`);
            deleteBunnyVideo(bunnyResult.guid).catch(() => {});
          }
          // Record Bunny hosting cost (even when cost rounds to 0¢).
          // Fire-and-forget: Bunny cost event. Wrapped in void IIFE so the
          // PromiseLike returned by Supabase doesn't block the outer await.
          void (async () => {
            const { error: bErr } = await supabase.from("cost_events").insert({
              property_id: null,
              scene_id: iter.scene_id,
              stage: "generation",
              provider: "bunny",
              units_consumed: 1,
              unit_type: "renders",
              cost_cents: bunnyStreamCostCents(buffer.byteLength),
              metadata: { bunny_hosted: mp4Valid, path: rehostPath, source: "lab_listing", iteration_id: iter.id },
            });
            if (bErr) console.warn("[poll-listing-iterations] bunny cost_event insert failed:", bErr);
          })();
        }
      } catch (rehostErr) {
        // warn not error — a Bunny hosting failure is non-fatal (we fall back to
        // the provider URL). console.error was causing misleading error-level spam
        // in the prod cron logs on every tick when the Referer fix was absent.
        console.warn(`[poll-listing-iterations] rehost failed for ${iter.id}:`, rehostErr);
      }

      await supabase
        .from("prompt_lab_listing_scene_iterations")
        .update({
          status: "rendered",
          clip_url: persistedUrl,
          cost_cents: costCents,
        })
        .eq("id", iter.id);

      // Per the cost-tracking directive, every API call logs an event
      // even if cost is zero. Native Kling records provider='kling',
      // cost_cents=0, metadata.billing='prepaid_credits' so we retain
      // a per-render audit trail even when cash cost is 0.
      const { error: costErr } = await supabase.from("cost_events").insert({
        property_id: null,
        scene_id: null,
        stage: "generation",
        provider: nativeKling ? "kling" : "atlas",
        units_consumed: 1,
        unit_type: "renders",
        cost_cents: costCents,
        metadata: nativeKling
          ? { scope: "lab_listing", scene_id: iter.scene_id, iteration_id: iter.id, model: iter.model_used, billing: "prepaid_credits" }
          : { scope: "lab_listing", scene_id: iter.scene_id, iteration_id: iter.id, model: iter.model_used },
      });
      if (costErr) console.error("[poll-listing-iterations] cost_events insert failed:", costErr);

      // Fire-and-forget Gemini judge hook. Mirrors finalizeLabRender's hook
      // for the single-image Lab — without this the Listing Lab clips never
      // get auto-judged. Non-blocking so clip finalization isn't held up.
      //
      // IMPORTANT: pass the PROVIDER url (status.videoUrl), not the Bunny CDN
      // persistedUrl. Gemini's fetchers send no Referer and would 403 against
      // the Bunny CDN referrer allow-list. The provider URL is still alive at
      // judge time (clips are judged immediately after collection).
      if (process.env.JUDGE_ENABLED === "true") {
        const persistedForJudge = status.videoUrl!;
        const iterIdForJudge = iter.id;
        const sceneIdForJudge = iter.scene_id;
        (async () => {
          try {
            const { judgeLabIteration, loadCalibrationFewShot } = await import("../../lib/providers/gemini-judge.js");
            const { data: scene } = await supabase
              .from("prompt_lab_listing_scenes")
              .select("room_type, camera_movement, director_prompt, photo_id")
              .eq("id", sceneIdForJudge)
              .maybeSingle();
            const { data: iterRow } = await supabase
              .from("prompt_lab_listing_scene_iterations")
              .select("director_prompt")
              .eq("id", iterIdForJudge)
              .maybeSingle();
            const { data: photo } = scene?.photo_id
              ? await supabase
                  .from("prompt_lab_listing_photos")
                  .select("image_url")
                  .eq("id", scene.photo_id)
                  .maybeSingle()
              : { data: null };

            let photoBytes: Buffer | undefined;
            try {
              const photoUrl = (photo as { image_url?: string | null } | null)?.image_url;
              if (photoUrl) {
                const r = await fetch(photoUrl);
                if (r.ok) photoBytes = Buffer.from(await r.arrayBuffer());
              }
            } catch { /* non-fatal */ }

            const roomType = (scene?.room_type as string | null) ?? "unknown";
            const cameraMovement = (scene?.camera_movement as string | null) ?? "unknown";
            const directorPrompt =
              ((iterRow as { director_prompt?: string | null } | null)?.director_prompt) ??
              ((scene as { director_prompt?: string | null } | null)?.director_prompt) ??
              "";

            const calibrationExamples = await loadCalibrationFewShot(roomType, cameraMovement, 10);

            const judgeResult = await judgeLabIteration({
              clipUrl: persistedForJudge,
              photoBytes,
              directorPrompt,
              cameraMovement,
              roomType,
              iterationId: iterIdForJudge,
              calibrationExamples,
            });

            await supabase
              .from("prompt_lab_listing_scene_iterations")
              .update({
                judge_rating_json: judgeResult,
                judge_rating_overall: judgeResult.overall,
                judge_rated_at: new Date().toISOString(),
                judge_model: judgeResult.judge_model,
                judge_version: judgeResult.judge_version,
                judge_cost_cents: judgeResult.cost_cents,
                judge_error: null,
              })
              .eq("id", iterIdForJudge);
          } catch (judgeErr) {
            console.error("[poll-listing-iterations judge] hook failed (non-fatal):", judgeErr);
            try {
              // Preserve any prior successful rating; only update error + timestamp.
              await supabase
                .from("prompt_lab_listing_scene_iterations")
                .update({
                  judge_error: judgeErr instanceof Error ? judgeErr.message : String(judgeErr),
                  judge_rated_at: new Date().toISOString(),
                })
                .eq("id", iterIdForJudge);
            } catch { /* swallow */ }
          }
        })();
      }

      finalized += 1;
    } catch (err) {
      console.error(`[poll-listing-iterations] ${iter.id}:`, err);
    }
  }

  return res.status(200).json({ polled: rendering.length, finalized, failed });
}
