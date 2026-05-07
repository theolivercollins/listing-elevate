// lib/blog-engine/jobs/handlers/_site-opts.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogSite } from '../../types';
import type { PublisherOpts } from '../../publishers/types';

export async function resolveSiteOpts(
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ site: BlogSite; opts: Omit<PublisherOpts, 'contextId'> }> {
  const { data, error } = await supabase.from('blog_sites').select('*').eq('id', siteId).single();
  if (error || !data) throw new Error(`site ${siteId} not found`);
  const site = data as BlogSite;
  if (site.host_kind !== 'sierra') throw new Error(`unsupported host ${site.host_kind}`);
  const username = process.env.SIERRA_HELGEMO_USERNAME;
  const password = process.env.SIERRA_HELGEMO_PASSWORD;
  if (!username || !password) throw new Error('Sierra creds env vars missing');
  return { site, opts: { baseUrl: site.base_url, username, password } };
}
