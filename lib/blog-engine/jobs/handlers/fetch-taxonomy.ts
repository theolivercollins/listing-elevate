// lib/blog-engine/jobs/handlers/fetch-taxonomy.ts
import type { JobHandler } from '../runner';
import { createSierraPublisher } from '../../publishers/sierra';
import { getOrCreatePersistentContextId } from '../../browserbase';
import { resolveSiteOpts } from './_site-opts';

export const fetchTaxonomyHandler: JobHandler = async ({ supabase, job }) => {
  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);
  if (contextId !== site.browserbase_context_id) {
    await supabase.from('blog_sites').update({ browserbase_context_id: contextId }).eq('id', site.id);
  }
  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });
  const taxonomy = await publisher.fetchTaxonomy({ ...opts, contextId });
  await supabase.from('blog_sites').update({ taxonomy_cache: taxonomy }).eq('id', site.id);
  const last = publisher.lastSession;
  return {
    result: { authors: taxonomy.authors.length, categories: taxonomy.categories.length },
    browserbase_session_id: last?.sessionId,
    replay_url: last?.replayUrl,
  };
};
