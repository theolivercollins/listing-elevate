import type { VercelRequest, VercelResponse } from "@vercel/node";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

export const maxDuration = 300;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { applySpeedRamp } from "../../../lib/utils/ffmpeg.js";
import { concatClips } from "../../../lib/utils/ffmpeg.js";

const exec = promisify(execFile);

// POST /api/admin/prompt-lab/assemble
// Body: { session_id: string, iteration_ids: string[] }  (ordered; duplicates allowed)
//
// 1. Auth: admin only.
// 2. Validate: session exists, every iteration belongs to it, every iteration has clip_url.
// 3. Insert prompt_lab_assemblies row (status='assembling').
// 4. For each clip: fetch → tmp file → applySpeedRamp → fallback to raw on error.
// 5. concatClips → final mp4.
// 6. Upload to property-videos / lab/<session_id>/assembled/<assemblyId>.mp4.
// 7. Probe final duration.
// 8. Update assembly row to status='complete'.
// 9. Cleanup all tmp files (finally).
// 10. Return { id, assembled_url, duration_seconds }.
//
// On any failure: update row to status='failed', return 500.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const { session_id, iteration_ids } = (req.body ?? {}) as {
    session_id?: string;
    iteration_ids?: string[];
  };

  if (!session_id) {
    return res.status(400).json({ error: "session_id required" });
  }
  if (!Array.isArray(iteration_ids) || iteration_ids.length === 0) {
    return res.status(400).json({ error: "iteration_ids must be a non-empty array" });
  }

  const supabase = getSupabase();

  // Validate: session exists
  const { data: session, error: sessErr } = await supabase
    .from("prompt_lab_sessions")
    .select("id")
    .eq("id", session_id)
    .single();
  if (sessErr || !session) {
    return res.status(400).json({ error: `session not found: ${session_id}` });
  }

  // Validate: every iteration_id belongs to this session and has a clip_url
  // De-duplicate IDs for the DB query, but preserve order in the request.
  const uniqueIds = [...new Set(iteration_ids)];
  const { data: iterations, error: iterErr } = await supabase
    .from("prompt_lab_iterations")
    .select("id, clip_url, session_id")
    .eq("session_id", session_id)
    .in("id", uniqueIds);

  if (iterErr) {
    return res.status(500).json({ error: `failed to fetch iterations: ${iterErr.message}` });
  }

  const iterMap = new Map((iterations ?? []).map((it) => [it.id as string, it]));

  for (const id of iteration_ids) {
    const it = iterMap.get(id);
    if (!it) {
      return res.status(400).json({
        error: `iteration ${id} does not belong to session ${session_id}`,
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
    .from("prompt_lab_assemblies")
    .insert({
      session_id,
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

      const rawPath = path.join(os.tmpdir(), `lab-assemble-${assemblyId}-${i}-raw.mp4`);
      const rampedPath = path.join(os.tmpdir(), `lab-assemble-${assemblyId}-${i}-ramp.mp4`);
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
          `[assemble] speed-ramp failed for iteration ${itId} (segment ${i}): ${rampMsg} — using raw clip`,
        );
      }

      segmentPaths.push(segmentPath);
    }

    // Step 5: Concat
    const finalPath = path.join(os.tmpdir(), `lab-assemble-${assemblyId}-final.mp4`);
    tmpFiles.push(finalPath);

    const { durationSeconds } = await concatClips(segmentPaths, finalPath);

    // Step 6: Upload to Supabase Storage
    const storagePath = `lab/${session_id}/assembled/${assemblyId}.mp4`;
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
      .from("prompt_lab_assemblies")
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
    console.error(`[assemble] assembly ${assemblyId} failed:`, msg);

    // Best-effort: update row to failed
    try {
      await supabase
        .from("prompt_lab_assemblies")
        .update({ status: "failed", error: msg })
        .eq("id", assemblyId);
    } catch { /* best-effort */ }

    return res.status(500).json({ error: msg, assembly_id: assemblyId });
  } finally {
    // Step 9: Cleanup all tmp files — never throw on failure
    for (const f of tmpFiles) {
      await fs.unlink(f).catch(() => {});
    }
  }
}
