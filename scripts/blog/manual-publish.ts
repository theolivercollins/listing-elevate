// scripts/blog/manual-publish.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) throw new Error("no Sierra site row — run seed first");

  const { data: post, error: pErr } = await supabase
    .from("blog_posts").insert([{
      site_id: site.id,
      state: "awaiting_approval",
      title: "Phase 1 smoke test — please ignore",
      body_html: "<p>This is a hand-written smoke test for the blog engine.</p>",
      meta_title: "Phase 1 smoke test",
      meta_description: "Hand-written smoke test for the blog engine.",
      meta_tags: ["smoke", "test"],
      author_label: process.env.SIERRA_DEFAULT_AUTHOR ?? null,
      category_label: process.env.SIERRA_DEFAULT_CATEGORY ?? null,
    }]).select("id").single();
  if (pErr) throw pErr;

  const { data: job, error: jErr } = await supabase
    .from("blog_jobs").insert([{
      site_id: site.id,
      post_id: post!.id,
      kind: "publish",
      payload: {},
    }]).select("id").single();
  if (jErr) throw jErr;
  console.log("post", post!.id, "job", job!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
