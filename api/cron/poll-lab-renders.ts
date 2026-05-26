import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 120;

import { getSupabase } from "../../lib/client.js";
import { finalizeLabRender, submitLabRender } from "../../lib/prompt-lab.js";
import { applySpeedRampToBuffer } from "../../lib/utils/ffmpeg.js";

// Runs every minute per vercel.json crons.
// Phase 1: submit queued renders when provider slots open.
// Phase 2: finalize in-flight renders (download + upload + store URL).

interface PendingRow {
  id: string;
  session_id: string;
  provider: string | null;
  provider_task_id: string;
  cost_cents: number | null;
  render_submitted_at: string | null;
  pipeline_version: string | null;
}

interface QueuedRow {
  id: string;
  session_id: string;
  provider: string;
  render_queued_at: string;
  director_output_json: Record<string, unknown>;
  analysis_json: Record<string, unknown> | null;
  prompt_lab_sessions: { image_url: string } | null;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const results: Array<{ id: string; phase: string; status: string; err?: string }> = [];

  // ── Phase 1: submit queued renders ──
  const { data: queued } = await supabase
    .from("prompt_lab_iterations")
    .select("id, session_id, provider, render_queued_at, director_output_json, analysis_json, prompt_lab_sessions(image_url)")
    .not("render_queued_at", "is", null)
    .is("provider_task_id", null)
    .is("clip_url", null)
    .is("render_error", null)
    .order("render_queued_at", { ascending: true })
    .limit(10);

  for (const row of (queued ?? []) as unknown as QueuedRow[]) {
    if (!row.provider || (row.provider !== "kling" && row.provider !== "runway")) {
      results.push({ id: row.id, phase: "queue", status: "skip: unknown provider" });
      continue;
    }
    // Timeout queued items after 30 min
    const queueAge = Date.now() - new Date(row.render_queued_at).getTime();
    if (queueAge > 30 * 60 * 1000) {
      await supabase
        .from("prompt_lab_iterations")
        .update({ render_error: "queued render expired after 30 minutes", render_queued_at: null })
        .eq("id", row.id);
      results.push({ id: row.id, phase: "queue", status: "expired" });
      continue;
    }

    const session = row.prompt_lab_sessions as { image_url: string } | null;
    const imageUrl = session?.image_url;
    if (!imageUrl || !row.director_output_json) {
      results.push({ id: row.id, phase: "queue", status: "skip: missing data" });
      continue;
    }

    try {
      const scene = row.director_output_json as { prompt: string; camera_movement: string; duration_seconds: number };
      const roomType = (row.analysis_json as { room_type?: string })?.room_type ?? "other";
      const { jobId, provider, sku: resolvedSku } = await submitLabRender({
        imageUrl,
        scene: scene as any,
        roomType: roomType as any,
        providerOverride: row.provider as "kling" | "runway",
      });
      await supabase
        .from("prompt_lab_iterations")
        .update({
          provider,
          provider_task_id: jobId,
          render_submitted_at: new Date().toISOString(),
          render_queued_at: null,
          // Persist the full SKU ("kling-v2-native" / "runway-gen4-native")
          // so the dashboard chip shows the variant instead of falling back
          // to the coarse provider label. Without this the queued-path
          // leaves model_used=null on completed iterations.
          model_used: resolvedSku,
          sku_source: "captured_at_render",
        })
        .eq("id", row.id);
      results.push({ id: row.id, phase: "queue", status: `submitted to ${provider} (${resolvedSku})` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("at capacity")) {
        results.push({ id: row.id, phase: "queue", status: "still waiting for slot" });
      } else {
        await supabase
          .from("prompt_lab_iterations")
          .update({ render_error: msg, render_queued_at: null })
          .eq("id", row.id);
        results.push({ id: row.id, phase: "queue", status: "failed", err: msg });
      }
    }
  }

  // ── Phase 2: finalize in-flight renders ──
  const { data, error } = await supabase
    .from("prompt_lab_iterations")
    .select("id, session_id, provider, provider_task_id, cost_cents, render_submitted_at, pipeline_version")
    .not("provider_task_id", "is", null)
    .is("clip_url", null)
    .is("render_error", null)
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data ?? []) as PendingRow[];

  for (const row of rows) {
    if (!row.provider || !["kling", "runway", "atlas"].includes(row.provider)) {
      results.push({ id: row.id, phase: "finalize", status: "skip: unknown provider" });
      continue;
    }
    if (row.render_submitted_at) {
      const age = Date.now() - new Date(row.render_submitted_at).getTime();
      if (age > 30 * 60 * 1000) {
        await supabase
          .from("prompt_lab_iterations")
          .update({ render_error: "render timed out after 30 minutes" })
          .eq("id", row.id);
        results.push({ id: row.id, phase: "finalize", status: "timed out" });
        continue;
      }
    }

    try {
      const outcome = await finalizeLabRender({
        iterationId: row.id,
        sessionId: row.session_id,
        provider: row.provider as "kling" | "runway" | "atlas",
        providerTaskId: row.provider_task_id,
      });
      if (!outcome.done) {
        results.push({ id: row.id, phase: "finalize", status: "still processing" });
        continue;
      }
      if (outcome.error) {
        await supabase
          .from("prompt_lab_iterations")
          .update({ render_error: outcome.error })
          .eq("id", row.id);

        // CI.4: Record cost for failed renders — over-attribute rather than
        // under-attribute until provider invoices confirm failure billing.
        // Kling pre-paid credits are likely refunded on failure → 0¢.
        const isKlingFailedLab = row.provider === "kling";
        const labFailedCents = isKlingFailedLab ? 0 : (outcome.costCents ?? 0);
        const { error: costErr } = await supabase.from("cost_events").insert({
          property_id: null,
          scene_id: null,
          stage: "generation",
          provider: row.provider,
          units_consumed: 1,
          unit_type: isKlingFailedLab ? "kling_units" : "renders",
          cost_cents: labFailedCents,
          metadata: isKlingFailedLab
            ? {
                scope: "lab",
                iteration_id: row.id,
                session_id: row.session_id,
                billing: "prepaid_credits_failed_refunded",
                render_outcome: "failed",
              }
            : {
                scope: "lab",
                iteration_id: row.id,
                session_id: row.session_id,
                render_outcome: "failed",
              },
        });
        if (costErr) {
          console.error("[poll-lab-renders] failed cost_events insert:", costErr);
        }
        results.push({ id: row.id, phase: "finalize", status: "failed", err: outcome.error });
        continue;
      }

      // v1.1 — apply FFmpeg speed-ramp polish so Lab ratings reflect the
      // exact output the production pipeline ships. On ramp failure, log
      // the error and fall through to the raw clip (same pattern as
      // api/cron/poll-scenes.ts). finalizeLabRender already persisted
      // the clip to storage and returned the public URL; we need the raw
      // buffer to re-process, so we re-download from outcome.clipUrl.
      // pipeline_version defaults to 'v1' for iterations created before
      // migration 067.
      let finalClipUrl = outcome.clipUrl ?? "";
      const iterPipelineVersion = (row.pipeline_version ?? "v1") as string;
      if (iterPipelineVersion === "v1.1" && outcome.clipUrl) {
        try {
          const rawResp = await fetch(outcome.clipUrl);
          if (!rawResp.ok) throw new Error(`re-download failed: ${rawResp.status}`);
          const rawBuf = Buffer.from(await rawResp.arrayBuffer());
          const rampedBuf = await applySpeedRampToBuffer(rawBuf);
          // Overwrite the storage object with the ramped version.
          const rampedPath = `prompt-lab/${row.session_id}/${row.id}.mp4`;
          const { error: upErr } = await supabase.storage
            .from("property-videos")
            .upload(rampedPath, rampedBuf, { contentType: "video/mp4", upsert: true });
          if (!upErr) {
            const { data: pub } = supabase.storage
              .from("property-videos")
              .getPublicUrl(rampedPath);
            finalClipUrl = pub.publicUrl;
          }
        } catch (rampErr) {
          const rampMsg = rampErr instanceof Error ? rampErr.message : String(rampErr);
          console.warn(`[poll-lab-renders] v1.1 speed-ramp failed for iter=${row.id}, using raw clip: ${rampMsg}`);
          // fall through — finalClipUrl stays as outcome.clipUrl
        }
      }

      await supabase
        .from("prompt_lab_iterations")
        .update({
          clip_url: finalClipUrl,
          cost_cents: Math.round((row.cost_cents ?? 0) + (outcome.costCents ?? 0)),
        })
        .eq("id", row.id);
      results.push({ id: row.id, phase: "finalize", status: "complete" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: row.id, phase: "finalize", status: "error", err: msg });
    }
  }

  return res.status(200).json({
    queued_processed: (queued ?? []).length,
    inflight_processed: rows.length,
    results,
  });
}
