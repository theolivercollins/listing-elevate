// scripts/blog/manual-approve.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

const POST_ID = process.argv[2];
if (!POST_ID) {
  console.error("usage: manual-approve <post_id>");
  process.exit(2);
}

async function main() {
  const supabase = getSupabase();
  const { data: post, error: pErr } = await supabase
    .from("blog_posts").select("site_id, state, image_id").eq("id", POST_ID).single();
  if (pErr || !post) throw new Error(`post ${POST_ID} not found`);
  if (post.state !== "awaiting_approval") {
    throw new Error(`post is in state '${post.state}', expected 'awaiting_approval'`);
  }
  if (!post.image_id) {
    console.warn("post has no image_id — proceeding anyway (publish will go without an image)");
  }

  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{
      site_id: post.site_id,
      post_id: POST_ID,
      kind: "publish",
      payload: {},
    }]).select("id").single();
  if (jErr) throw jErr;
  console.log("publish job", job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
