import type { VercelRequest, VercelResponse } from '@vercel/node';

// Heavy post-approval compute (style guide + director scripting + N provider
// submits) runs here in its OWN serverless function so it gets a fresh 300s
// budget, decoupled from the operator's approve-POST. See the
// approve_photo_selection case in api/admin/studio/delivery/[runId].ts for the
// decouple rationale.
export const maxDuration = 300;

// SECURITY REVIEW: this endpoint is intentionally UNAUTHENTICATED, matching the
// existing internal trigger api/pipeline/[propertyId].ts (which also has no
// requireAdmin / secret check). It is an internal server-to-server hop fired by
// the already-admin-gated approve handler. If api/pipeline/[propertyId].ts is
// later hardened with a shared-secret/auth boundary, mirror the SAME change
// here — do not let these two internal triggers drift apart.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runId = req.query.runId as string;
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!runId || !UUID_RE.test(runId)) {
    return res.status(400).json({ error: 'invalid runId' });
  }

  // Load the run to resolve its property_id (continuePipelineAfterPhotoSelection
  // is keyed by property, not run).
  const { getRun, setRunError } = await import('../../../lib/delivery/runs.js');
  const run = await getRun(runId);
  if (!run) {
    return res.status(404).json({ error: 'not_found' });
  }

  try {
    // Serialize with the operator Resume/Retry actions and the stuck-reaper's
    // zero-scene re-fire under the SHARED per-run resolve lease so a duplicate
    // hop (or a hop racing a manual Resume) can never both pass runScripting's
    // 0-scene guard and double-submit scenes = duplicate paid provider jobs.
    // Runs to completion under this function's own 300s budget. On any thrown
    // error we surface it via setRunError below so the run never sits at
    // stage='generating' with error=NULL.
    const { resumeGeneratingUnderLease } = await import('../../../lib/delivery/resume-generation.js');
    const outcome = await resumeGeneratingUnderLease(runId, run.property_id);
    if (!outcome.ran) {
      // The run is already being (re)fired by a concurrent actor (a manual
      // Resume, the stuck-reaper, or a duplicate hop). Do NOT double-fire and do
      // NOT error the run — the in-flight resume owns the lifecycle.
      console.warn(`[pipeline/continue] resume lease held for run ${runId}; another actor is already (re)firing — no-op`);
      return res.status(200).json({ status: 'in_progress', runId });
    }
    return res.status(200).json({ status: 'complete', runId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline/continue] failed for run ${runId}:`, msg);
    // Make the failure visible to the operator (DeliveryStepper reads run.error).
    // setRunError must never itself be silently swallowed — if IT throws, let
    // the 500 carry the original message so the failure is at least traced.
    await setRunError(runId, `Generation resume failed: ${msg}`);
    return res.status(500).json({ status: 'failed', runId, error: msg });
  }
}
