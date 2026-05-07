// lib/blog-engine/jobs/handlers/edit.ts
import type { JobHandler } from "../runner";
import type { EditableField } from "../../publishers/sierra/edit";
import { createSierraPublisher } from "../../publishers/sierra";
import { getOrCreatePersistentContextId } from "../../browserbase";
import { resolveSiteOpts } from "./_site-opts";
import { recordBlogCost } from "../../cost";

export const editHandler: JobHandler = async ({ supabase, job }) => {
  if (!job.post_id) throw new Error("edit job requires post_id");

  const fieldsChanged = new Set<EditableField>(
    ((job.payload?.fields_changed as string[]) ?? []) as EditableField[],
  );
  if (fieldsChanged.size === 0) {
    return { result: { skipped: "no fields changed" } };
  }

  const { data: post, error: postErr } = await supabase
    .from("blog_posts").select("*").eq("id", job.post_id).single();
  if (postErr || !post) throw new Error(`edit: post ${job.post_id} not found`);

  const priorState = post.state;
  const { site, opts } = await resolveSiteOpts(supabase, job.site_id);
  const contextId = await getOrCreatePersistentContextId(site.browserbase_context_id);

  const publisher = createSierraPublisher({
    loadImage: async () => null,
    diffFields: async () => fieldsChanged,
  });

  await supabase.from("blog_posts").update({ state: "editing" }).eq("id", post.id);

  let editResult;
  try {
    editResult = await publisher.edit(post, { ...opts, contextId });
  } catch (e) {
    await supabase.from("blog_posts").update({ state: priorState }).eq("id", post.id);
    throw e;
  }

  await supabase.from("blog_posts").update({
    state: "live",
    external_post_url: editResult.external_post_url,
    updated_at: new Date().toISOString(),
  }).eq("id", post.id);

  await recordBlogCost(supabase, {
    stage: "blog_publish_browser",
    cost_usd_cents: 10,
    post_id: post.id,
    site_id: site.id,
    provider: "browserbase",
    meta: {
      kind: "edit",
      session_id: publisher.lastSession?.sessionId,
      replay_url: publisher.lastSession?.replayUrl,
    },
  });

  const last = publisher.lastSession;
  return { result: editResult, browserbase_session_id: last?.sessionId, replay_url: last?.replayUrl };
};
