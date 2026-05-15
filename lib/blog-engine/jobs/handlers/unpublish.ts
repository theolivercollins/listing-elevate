// lib/blog-engine/jobs/handlers/unpublish.ts
import type { JobHandler } from "../runner.js";
import { createSierraPublisher } from "../../publishers/sierra/index.js";
import { getOrCreatePersistentContextId } from "../../browserbase.js";
import { resolveSiteOpts } from "./_site-opts.js";
import { recordBlogCost } from "../../cost.js";

export const unpublishHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error("unpublish job requires post_id");

  const { data: post, error: postErr } = await supabase
    .from("blog_posts").select("*").eq("id", job.post_id).single();
  if (postErr || !post) throw new Error(`unpublish: post ${job.post_id} not found`);

  // No Sierra-side id means nothing to remove. Treat as success; the soft-delete
  // (active=false) is the caller's responsibility.
  if (!post.external_post_id) {
    return { result: { skipped: "no_external_post_id" } };
  }

  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);
  if (contextId !== site.browserbase_context_id) {
    await supabase.from("blog_sites").update({ browserbase_context_id: contextId }).eq("id", site.id);
  }

  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => new Set(),
  });

  const result = await publisher.unpublish(post.external_post_id, post.title, { ...opts, contextId });

  await recordBlogCost(supabase, {
    stage: "blog_publish_browser",
    cost_cents: 10,
    post_id: post.id,
    site_id: site.id,
    provider: "browserbase",
    metadata: {
      action: "unpublish",
      session_id: publisher.lastSession?.sessionId,
      replay_url: publisher.lastSession?.replayUrl,
    },
  });

  const last = publisher.lastSession;
  return {
    result: { removed: result.removed },
    browserbase_session_id: last?.sessionId,
    replay_url: last?.replayUrl,
  };
};
