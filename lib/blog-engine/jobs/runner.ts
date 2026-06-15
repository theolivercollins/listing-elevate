// lib/blog-engine/jobs/runner.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogJob, BlogJobKind } from '../types.js';

export interface JobHandlerArgs {
  supabase: SupabaseClient;
  job: BlogJob;
}

export interface JobHandlerResult {
  result?: Record<string, unknown>;
  browserbase_session_id?: string;
  replay_url?: string;
}

export type JobHandler = (args: JobHandlerArgs) => Promise<JobHandlerResult>;

export type Handlers = Partial<Record<BlogJobKind, JobHandler>>;

const MAX_ATTEMPTS = 3;

export async function runOneJob(
  supabase: SupabaseClient,
  job: BlogJob,
  handlers: Handlers,
): Promise<void> {
  const handler = handlers[job.kind];
  if (!handler) {
    await updateJob(supabase, job.id, {
      state: 'failed',
      last_error: `no handler for kind ${job.kind}`,
      finished_at: new Date().toISOString(),
    });
    return;
  }

  await updateJob(supabase, job.id, {
    state: 'running',
    attempts: job.attempts + 1,
    started_at: new Date().toISOString(),
  });

  try {
    const out = await handler({ supabase, job });
    await updateJob(supabase, job.id, {
      state: 'done',
      result: out.result ?? null,
      browserbase_session_id: out.browserbase_session_id ?? null,
      replay_url: out.replay_url ?? null,
      finished_at: new Date().toISOString(),
      // Clear last_error so a recovered job doesn't display its prior failure
      // as if it were the final outcome.
      last_error: null,
    });
  } catch (e: any) {
    const newAttempts = job.attempts + 1;
    const exhausted = newAttempts >= MAX_ATTEMPTS;
    await updateJob(supabase, job.id, {
      state: exhausted ? 'failed' : 'queued',
      attempts: newAttempts,
      last_error: e?.message ?? String(e),
      browserbase_session_id: e?.browserbaseSessionId ?? null,
      replay_url: e?.browserbaseReplayUrl ?? null,
      finished_at: exhausted ? new Date().toISOString() : null,
      scheduled_at: exhausted
        ? new Date().toISOString()
        : new Date(Date.now() + 30_000 * newAttempts).toISOString(),
    });
  }
}

async function updateJob(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('blog_jobs').update(patch).eq('id', id);
  if (error) throw new Error(`updateJob(${id}) failed: ${error.message}`);
}

export async function tick(
  supabase: SupabaseClient,
  handlers: Handlers,
  limit = 5,
): Promise<{ processed: number }> {
  const { data, error } = await supabase
    .from('blog_jobs')
    .select('*')
    .eq('state', 'queued')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`tick: select failed: ${error.message}`);

  for (const j of (data ?? []) as BlogJob[]) {
    await runOneJob(supabase, j, handlers);
  }
  return { processed: data?.length ?? 0 };
}
