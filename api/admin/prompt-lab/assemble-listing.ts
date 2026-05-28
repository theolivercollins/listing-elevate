import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 300;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordCostEvent } from "../../../lib/db.js";
import {
  ShotstackProvider,
  pollAssemblyUntilComplete,
  shotstackCostCents,
} from "../../../lib/providers/shotstack.js";

// POST /api/admin/prompt-lab/assemble-listing
// Body: { listing_id: string, iteration_ids: string[], aspect_ratio?: "16:9" | "9:16" }
//   (iteration_ids ordered; duplicates allowed)
//
// 1. Auth: admin only.
// 2. Validate: listing exists, every iteration belongs to one of this listing's
//    scenes (JOIN prompt_lab_listing_scenes), every iteration has clip_url.
// 3. Insert prompt_lab_listing_assemblies row (status='assembling').
// 4. Concatenate the ordered clip URLs into a single MP4 via Shotstack
//    (cloud render — no overlays, no music). Shotstack hosts the output; we
//    store its URL directly. Replaces the old local-FFmpeg concat that blew
//    past Supabase's storage upload size limit.
// 5. Record the Shotstack render cost.
// 6. Update assembly row to status='complete'.
// 7. Return { id, assembled_url, duration_seconds }.
//
// On any failure: update row to status='failed', return 500.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { listing_id, iteration_ids, aspect_ratio } = (req.body ?? {}) as {
    listing_id?: string;
    iteration_ids?: string[];
    aspect_ratio?: "16:9" | "9:16";
  };

  if (!listing_id) {
    return res.status(400).json({ error: "listing_id required" });
  }
  if (!Array.isArray(iteration_ids) || iteration_ids.length === 0) {
    return res.status(400).json({ error: "iteration_ids must be a non-empty array" });
  }

  const aspectRatio: "16:9" | "9:16" = aspect_ratio === "9:16" ? "9:16" : "16:9";

  const supabase = getSupabase();

  // Validate: listing exists
  const { data: listing, error: listingErr } = await supabase
    .from("prompt_lab_listings")
    .select("id, model_name")
    .eq("id", listing_id)
    .single();
  if (listingErr || !listing) {
    return res.status(400).json({ error: `listing not found: ${listing_id}` });
  }

  // Validate: every iteration_id belongs to one of this listing's scenes
  // Fetch scene IDs for this listing first, then validate iterations
  const { data: scenes, error: scenesErr } = await supabase
    .from("prompt_lab_listing_scenes")
    .select("id, scene_number, room_type")
    .eq("listing_id", listing_id);

  if (scenesErr) {
    return res.status(500).json({ error: `failed to fetch scenes: ${scenesErr.message}` });
  }

  const sceneIds = (scenes ?? []).map((s) => s.id as string);

  if (sceneIds.length === 0) {
    return res.status(400).json({ error: `listing ${listing_id} has no scenes` });
  }

  // De-duplicate IDs for the DB query, but preserve order in the request.
  const uniqueIds = [...new Set(iteration_ids)];

  const { data: iterations, error: iterErr } = await supabase
    .from("prompt_lab_listing_scene_iterations")
    .select("id, clip_url, scene_id")
    .in("scene_id", sceneIds)
    .in("id", uniqueIds);

  if (iterErr) {
    return res.status(500).json({ error: `failed to fetch iterations: ${iterErr.message}` });
  }

  const iterMap = new Map((iterations ?? []).map((it) => [it.id as string, it]));

  for (const id of iteration_ids) {
    const it = iterMap.get(id);
    if (!it) {
      return res.status(400).json({
        error: `iteration ${id} does not belong to listing ${listing_id}`,
      });
    }
    if (!it.clip_url) {
      return res.status(400).json({
        error: `iteration ${id} has no clip_url (not yet rendered)`,
      });
    }
  }

  // Insert assembly row
  const { data: assembly, error: insertErr } = await supabase
    .from("prompt_lab_listing_assemblies")
    .insert({
      listing_id,
      iteration_order: iteration_ids,
      status: "assembling",
      pipeline_version: "v1.1",
    })
    .select("id")
    .single();

  if (insertErr || !assembly) {
    return res.status(500).json({
      error: `failed to create assembly row: ${insertErr?.message ?? "unknown"}`,
    });
  }

  const assemblyId = assembly.id as string;

  try {
    // Ordered clip URLs (duplicates preserved).
    const clipUrls = iteration_ids.map((id) => iterMap.get(id)!.clip_url as string);

    // Cloud concat via Shotstack — constructed directly (not via the
    // assembly-router, which prefers Creatomate when its key is set).
    const provider = new ShotstackProvider();
    const job = await provider.assembleConcat(clipUrls, aspectRatio);
    const result = await pollAssemblyUntilComplete(provider, job);

    if (result.status !== "complete" || !result.videoUrl) {
      throw new Error(result.error ?? "Shotstack assembly did not complete");
    }

    const assembledUrl = result.videoUrl;
    const durationSeconds = result.durationSeconds ?? 0;

    await recordCostEvent({
      propertyId: null,
      stage: "assembly",
      provider: "shotstack",
      unitsConsumed: 1,
      unitType: "renders",
      costCents: shotstackCostCents(durationSeconds),
      metadata: {
        source: "prompt-lab-assemble-listing",
        assembly_id: assemblyId,
        listing_id,
        clip_count: clipUrls.length,
        aspect_ratio: aspectRatio,
        shotstack_job_id: job.jobId,
      },
    });

    // Mark complete
    await supabase
      .from("prompt_lab_listing_assemblies")
      .update({
        status: "complete",
        assembled_url: assembledUrl,
        duration_seconds: durationSeconds,
        completed_at: new Date().toISOString(),
      })
      .eq("id", assemblyId);

    return res.status(200).json({
      id: assemblyId,
      assembled_url: assembledUrl,
      duration_seconds: durationSeconds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[assemble-listing] assembly ${assemblyId} failed:`, msg);

    // Best-effort: update row to failed
    try {
      await supabase
        .from("prompt_lab_listing_assemblies")
        .update({ status: "failed", error: msg })
        .eq("id", assemblyId);
    } catch { /* best-effort */ }

    return res.status(500).json({ error: msg, assembly_id: assemblyId });
  }
}
