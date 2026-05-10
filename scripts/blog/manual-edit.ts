// scripts/blog/manual-edit.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

const POST_ID = process.argv[2];
if (!POST_ID) {
  console.error("usage: manual-edit <post_id>");
  process.exit(2);
}

async function main() {
  const supabase = getSupabase();
  const newBody = `<p>Edited at ${new Date().toISOString()}</p>`;
  const { error: uErr } = await supabase
    .from("blog_posts").update({ body_html: newBody }).eq("id", POST_ID);
  if (uErr) throw uErr;

  const { data: post } = await supabase
    .from("blog_posts").select("site_id").eq("id", POST_ID).single();
  if (!post) throw new Error("post not found");

  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{
      site_id: post.site_id,
      post_id: POST_ID,
      kind: "edit",
      payload: { fields_changed: ["body_html"] },
    }]).select("id").single();
  if (jErr) throw jErr;
  console.log("edit job", job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
