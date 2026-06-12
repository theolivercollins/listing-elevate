import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase, updateScene } from "../../../lib/db.js";
import { resubmitScene } from "../../../lib/pipeline.js";
import type { CameraMovement, VideoProvider } from "../../../lib/types.js";

export const maxDuration = 120;

// POST /api/scenes/:id/resubmit
// body: { prompt?, provider?, camera_movement?, duration_seconds? }
//
// Manual single-scene resubmission. Unlocks three previously-painful
// scenarios the docs flagged (`docs/PROJECT-STATE.md` Known bugs):
//
//   1. Stuck Kling scenes at `needs_review` from earlier properties
//      (the 6f508e16 case). Admin clicks "Resubmit" in the dashboard;
//      this endpoint clears the failed task_id, runs the failover
//      classifier, and submits to whatever provider is requested (or
//      the next available one if the current provider is burned).
//   2. Admin-edited prompts on a needs_review scene — the edit is
//      applied then the scene is submitted.
//   3. Provider forcing — admin can say "send this one to Runway" to
//      compare output quality.
//
// The submit core lives in `lib/pipeline.ts#resubmitScene`, shared with the
// QC re-render loop in `api/cron/poll-scenes.ts`. The cron poller picks up the
// new task_id and downloads + finalizes once it completes.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const sceneId = req.query.id as string;
  const { prompt, provider: providerOverride, camera_movement, duration_seconds } = (req.body ?? {}) as {
    prompt?: string;
    provider?: VideoProvider;
    camera_movement?: CameraMovement;
    duration_seconds?: number;
  };

  // Confirm the scene exists before mutating, so a bad id still returns 404.
  const supabase = getSupabase();
  const { data: scene, error } = await supabase
    .from("scenes")
    .select("id, photo_id")
    .eq("id", sceneId)
    .single();
  if (error || !scene) return res.status(404).json({ error: "scene not found" });

  const { data: photo } = await supabase
    .from("photos")
    .select("file_url")
    .eq("id", scene.photo_id)
    .single();
  if (!photo) return res.status(404).json({ error: "source photo not found" });

  // Persist any admin overrides that resubmitScene reads off the scene row
  // (camera_movement, duration_seconds). The prompt override is passed through
  // and applied render-time so the stored prompt audit trail is preserved.
  const patch: Record<string, unknown> = {};
  if (camera_movement) patch.camera_movement = camera_movement;
  if (typeof duration_seconds === "number" && duration_seconds > 0) patch.duration_seconds = duration_seconds;
  if (Object.keys(patch).length > 0) await updateScene(sceneId, patch);

  const result = await resubmitScene(sceneId, {
    promptOverride: typeof prompt === "string" && prompt.trim().length > 0 ? prompt.trim() : undefined,
    providerOverride: providerOverride ?? undefined,
  });

  if (result.ok) {
    return res.status(200).json({
      ok: true,
      provider: result.provider,
      jobId: result.jobId,
      attempt: result.attempt,
    });
  }

  // Capacity/transient (non-failover) error: scene left pending, cron retries.
  if (result.retryable) {
    return res.status(503).json({
      ok: false,
      kind: result.kind ?? "unknown",
      provider: result.provider,
      message: result.error,
      willRetryViaCron: true,
    });
  }

  // All providers exhausted.
  return res.status(502).json({
    ok: false,
    kind: result.kind ?? "unknown",
    message: result.error ?? "All providers failed",
    excluded: result.excluded ?? [],
  });
}
