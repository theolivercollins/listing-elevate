// lib/blog-engine/jobs/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOneJob, type JobHandler } from './runner';
import type { BlogJob } from '../types';

const makeJob = (overrides: Partial<BlogJob> = {}): BlogJob => ({
  id: 'job-1',
  post_id: null,
  site_id: 'site-1',
  kind: 'fetch_taxonomy',
  state: 'queued',
  attempts: 0,
  last_error: null,
  browserbase_session_id: null,
  replay_url: null,
  payload: {},
  result: null,
  scheduled_at: new Date().toISOString(),
  started_at: null,
  finished_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('runOneJob', () => {
  it('marks done on handler success', async () => {
    const job = makeJob();
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockResolvedValue({ result: { ok: true } });

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(handler).toHaveBeenCalledWith({ supabase, job });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'done',
      result: { ok: true },
    }));
  });

  it('records error and retries up to 3 times', async () => {
    const job = makeJob({ attempts: 2 });
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockRejectedValue(new Error('boom'));

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'failed',
      last_error: 'boom',
    }));
  });

  it('keeps job queued for retry under attempt cap', async () => {
    const job = makeJob({ attempts: 0 });
    const update = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ update: (v: any) => ({ eq: () => update(v) }) }) } as any;
    const handler: JobHandler = vi.fn().mockRejectedValue(new Error('boom'));

    await runOneJob(supabase, job, { fetch_taxonomy: handler });

    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'queued',
      attempts: 1,
      last_error: 'boom',
    }));
  });
});
