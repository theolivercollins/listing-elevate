// lib/blog-engine/jobs/handlers/publish.ts
import type { JobHandler } from '../runner';
import { createSierraPublisher } from '../../publishers/sierra';
import { getOrCreatePersistentContextId } from '../../browserbase';
import { resolveSiteOpts } from './_site-opts';
import { recordBlogCost } from '../../cost';

export const publishHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error('publish job requires post_id');

  const { data: post, error: postErr } = await supabase
    .from('blog_posts').select('*').eq('id', job.post_id).single();
  if (postErr || !post) throw new Error(`publish: post ${job.post_id} not found`);

  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);
  if (contextId !== site.browserbase_context_id) {
    await supabase.from('blog_sites').update({ browserbase_context_id: contextId }).eq('id', site.id);
  }

  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });

  await supabase.from('blog_posts').update({ state: 'publishing' }).eq('id', post.id);

  const result = await publisher.publish(post, { ...opts, contextId });

  await supabase.from('blog_posts').update({
    state: 'live',
    external_post_url: result.external_post_url,
    external_post_id: result.external_post_id,
    updated_at: new Date().toISOString(),
  }).eq('id', post.id);

  await recordBlogCost(supabase, {
    stage: 'blog_publish_browser',
    cost_usd_cents: 10,
    post_id: post.id,
    site_id: site.id,
    provider: 'browserbase',
    meta: { session_id: (publisher as any).lastSession?.sessionId },
  });

  const last = (publisher as any).lastSession ?? {};
  return {
    result: { external_post_url: result.external_post_url },
    browserbase_session_id: last.sessionId,
    replay_url: last.replayUrl,
  };
};
