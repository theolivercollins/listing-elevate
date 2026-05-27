import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

export const maxDuration = 300;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { applySpeedRamp } from "../../../lib/utils/ffmpeg.js";
import { concatClips } from "../../../lib/utils/ffmpeg.js";

// POST /api/admin/prompt-lab/assemble-listing
// Body: { listing_id: string, iteration_ids: string[] }  (ordered; duplicates allowed)
//
// 1. Auth: admin only.
// 2. Validate: listing exists, every iteration belongs to one of this listing's scenes
//    (JOIN prompt_lab_listing_scenes), every iteration has clip_url.
// 3. Insert prompt_lab_listing_assemblies row (status='assembling').
// 4. For each clip: fetch → tmp file → applySpeedRamp → fallback to raw on error.
// 5. concatClips → final mp4.
// 6. Upload to property-videos/lab-listing/<listing_id>/assembled/<assemblyId>.mp4.
// 7. Update assembly row to status='complete'.
// 8. Return { id, assembled_url, duration_seconds }.
//
// On any failure: update row to status='failed', return 500.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { listing_id, iteration_ids } = (req.body ?? {}) as {
    listing_id?: string;
    iteration_ids?: string[];
  };

  if (!listing_id) {
    return res.status(400).json({ error: "listing_id required" });
  }
  if (!Array.isArray(iteration_ids) || iteration_ids.length === 0) {
    return res.status(400).json({ error: "iteration_ids must be a non-empty array" });
  }

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
  const tmpFiles: string[] = [];

  try {
    // Step 4: Download + speed-ramp each clip
    const segmentPaths: string[] = [];

    for (let i = 0; i < iteration_ids.length; i++) {
      const itId = iteration_ids[i];
      const it = iterMap.get(itId)!;
      const clipUrl = it.clip_url as string;

      const rawPath = path.join(os.tmpdir(), `lab-listing-assemble-${assemblyId}-${i}-raw.mp4`);
      const rampedPath = path.join(os.tmpdir(), `lab-listing-assemble-${assemblyId}-${i}-ramp.mp4`);
      tmpFiles.push(rawPath, rampedPath);

      // Download clip to tmp file
      const fetchRes = await fetch(clipUrl);
      if (!fetchRes.ok) {
        throw new Error(`failed to download clip for iteration ${itId}: HTTP ${fetchRes.status}`);
      }
      const buf = Buffer.from(await fetchRes.arrayBuffer());
      await fs.writeFile(rawPath, buf);

      // Speed-ramp — fall back to raw on failure
      let segmentPath = rawPath;
      try {
        await applySpeedRamp(rawPath, rampedPath, { rampSeconds: 0.5, rampFactor: 0.8 });
        segmentPath = rampedPath;
      } catch (rampErr) {
        const rampMsg = rampErr instanceof Error ? rampErr.message : String(rampErr);
        console.warn(
          `[assemble-listing] speed-ramp failed for iteration ${itId} (segment ${i}): ${rampMsg} — using raw clip`,
        );
      }

      segmentPaths.push(segmentPath);
    }

    // Step 5: Concat
    const finalPath = path.join(os.tmpdir(), `lab-listing-assemble-${assemblyId}-final.mp4`);
    tmpFiles.push(finalPath);

    const { durationSeconds } = await concatClips(segmentPaths, finalPath);

    // Step 6: Upload to Supabase Storage
    const storagePath = `lab-listing/${listing_id}/assembled/${assemblyId}.mp4`;
    const finalBuf = await fs.readFile(finalPath);

    const { error: upErr } = await supabase.storage
      .from("property-videos")
      .upload(storagePath, finalBuf, { contentType: "video/mp4", upsert: true });

    if (upErr) {
      throw new Error(`storage upload failed: ${upErr.message}`);
    }

    const { data: pub } = supabase.storage
      .from("property-videos")
      .getPublicUrl(storagePath);

    const assembledUrl = pub.publicUrl;

    // Step 8: Mark complete
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
  } finally {
    // Cleanup all tmp files — never throw on failure
    for (const f of tmpFiles) {
      await fs.unlink(f).catch(() => {});
    }
  }
}
