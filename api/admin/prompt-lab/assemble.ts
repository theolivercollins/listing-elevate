import type { VercelRequest, VercelResponse } from "@vercel/node";

export const maxDuration = 300;

import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";
import { recordCostEvent } from "../../../lib/db.js";
import { CreatomateProvider, creatomateCostCents } from "../../../lib/providers/creatomate.js";
import { pollAssemblyJob } from "../../../lib/providers/assembly-router.js";

// POST /api/admin/prompt-lab/assemble
// Body: { session_id?: string, batch_label?: string, iteration_ids: string[], aspect_ratio?: "16:9" | "9:16" }
//   (iteration_ids ordered; duplicates allowed)
//
// 1. Auth: admin only.
// 2. Validate: session/batch exists, every iteration belongs to it, every
//    iteration has clip_url.
// 3. Insert prompt_lab_assemblies row (status='assembling').
// 4. Concatenate the ordered clip URLs into a single MP4 via Creatomate
//    (cloud render — no overlays, no music). Creatomate hosts the output;
//    we store its URL directly. This replaces the old local-FFmpeg concat
//    that produced a single large MP4 and blew past Supabase's storage
//    upload size limit ("object exceeded the maximum allowed size").
// 5. Record the Creatomate render cost.
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

  const { session_id, batch_label, iteration_ids, aspect_ratio } = (req.body ?? {}) as {
    session_id?: string;
    batch_label?: string;
    iteration_ids?: string[];
    aspect_ratio?: "16:9" | "9:16";
  };

  // Either session_id (single-session assembly, original behavior) OR
  // batch_label (cross-session batch assembly, migration 072) must be set.
  if (!session_id && !batch_label) {
    return res.status(400).json({ error: "session_id or batch_label required" });
  }
  if (!Array.isArray(iteration_ids) || iteration_ids.length === 0) {
    return res.status(400).json({ error: "iteration_ids must be a non-empty array" });
  }

  const aspectRatio: "16:9" | "9:16" = aspect_ratio === "9:16" ? "9:16" : "16:9";

  const supabase = getSupabase();
  const uniqueIds = [...new Set(iteration_ids)];

  // Validate iterations + scope (single-session OR batch)
  let iterMap: Map<string, { id: string; clip_url: string | null; session_id: string }>;

  if (session_id) {
    // Single-session path — every iteration must belong to this session.
    const { data: session, error: sessErr } = await supabase
      .from("prompt_lab_sessions")
      .select("id")
      .eq("id", session_id)
      .single();
    if (sessErr || !session) {
      return res.status(400).json({ error: `session not found: ${session_id}` });
    }

    const { data: iterations, error: iterErr } = await supabase
      .from("prompt_lab_iterations")
      .select("id, clip_url, session_id")
      .eq("session_id", session_id)
      .in("id", uniqueIds);

    if (iterErr) {
      return res.status(500).json({ error: `failed to fetch iterations: ${iterErr.message}` });
    }
    iterMap = new Map((iterations ?? []).map((it) => [it.id as string, it]));

    for (const id of iteration_ids) {
      const it = iterMap.get(id);
      if (!it) {
        return res.status(400).json({ error: `iteration ${id} does not belong to session ${session_id}` });
      }
      if (!it.clip_url) {
        return res.status(400).json({ error: `iteration ${id} has no clip_url (not yet rendered)` });
      }
    }
  } else {
    // Batch path — every iteration must belong to a session whose batch_label
    // matches. Iterations can be drawn from multiple distinct sessions.
    // Fetch iterations + join their parent session's batch_label to validate.
    const { data: iterations, error: iterErr } = await supabase
      .from("prompt_lab_iterations")
      .select("id, clip_url, session_id, prompt_lab_sessions!inner(batch_label)")
      .eq("prompt_lab_sessions.batch_label", batch_label!)
      .in("id", uniqueIds);

    if (iterErr) {
      return res.status(500).json({ error: `failed to fetch iterations: ${iterErr.message}` });
    }
    iterMap = new Map((iterations ?? []).map((it) => [it.id as string, it as unknown as { id: string; clip_url: string | null; session_id: string }]));

    for (const id of iteration_ids) {
      const it = iterMap.get(id);
      if (!it) {
        return res.status(400).json({ error: `iteration ${id} does not belong to any session in batch "${batch_label}"` });
      }
      if (!it.clip_url) {
        return res.status(400).json({ error: `iteration ${id} has no clip_url (not yet rendered)` });
      }
    }
  }

  // Insert assembly row — session_id XOR batch_label per migration 072 CHECK
  const { data: assembly, error: insertErr } = await supabase
    .from("prompt_lab_assemblies")
    .insert({
      session_id: session_id ?? null,
      batch_label: batch_label ?? null,
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

    // Cloud concat via Creatomate (clips only — no overlays/music). Creatomate
    // renders in the cloud and hosts the output, so nothing large is uploaded
    // to our storage.
    const provider = new CreatomateProvider();
    const job = await provider.assembleConcat(clipUrls, aspectRatio);
    const result = await pollAssemblyJob(provider, job);

    if (result.status !== "complete" || !result.videoUrl) {
      throw new Error(result.error ?? "Creatomate assembly did not complete");
    }

    const assembledUrl = result.videoUrl;
    const durationSeconds = result.durationSeconds ?? 0;

    // Record cost (Creatomate bills per output minute). Lab assemblies aren't
    // tied to a real property, so propertyId is null.
    await recordCostEvent({
      propertyId: null,
      stage: "assembly",
      provider: "creatomate",
      unitsConsumed: 1,
      unitType: "renders",
      costCents: creatomateCostCents(durationSeconds, aspectRatio),
      metadata: {
        source: "prompt-lab-assemble",
        assembly_id: assemblyId,
        session_id: session_id ?? null,
        batch_label: batch_label ?? null,
        clip_count: clipUrls.length,
        aspect_ratio: aspectRatio,
        creatomate_job_id: job.jobId,
      },
    });

    // Mark complete
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
  }
}
