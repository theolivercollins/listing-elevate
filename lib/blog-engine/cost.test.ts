import { describe, it, expect, vi } from 'vitest';
import { recordBlogCost } from './cost';

describe('recordBlogCost', () => {
  it('inserts a cost_events row with the right stage and post_id', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ insert }) } as any;

    await recordBlogCost(supabase, {
      stage: 'blog_publish_browser',
      cost_usd_cents: 8,
      post_id: 'post-123',
      site_id: 'site-1',
      provider: 'browserbase',
      meta: { session_id: 'sess-abc' },
    });

    expect(insert).toHaveBeenCalledWith([{
      stage: 'blog_publish_browser',
      cost_usd_cents: 8,
      post_id: 'post-123',
      site_id: 'site-1',
      provider: 'browserbase',
      meta: { session_id: 'sess-abc' },
    }]);
  });

  it('throws when supabase reports an error (no silent failure)', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const supabase = { from: () => ({ insert }) } as any;

    await expect(
      recordBlogCost(supabase, {
        stage: 'blog_publish_browser',
        cost_usd_cents: 8,
        post_id: 'post-123',
        site_id: 'site-1',
        provider: 'browserbase',
      }),
    ).rejects.toThrow(/boom/);
  });
});
