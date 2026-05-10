// scripts/blog/manual-draft.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: site } = await supabase
    .from("blog_sites").select("id").eq("host_kind", "sierra").single();
  if (!site) throw new Error("no Sierra site row — run seed-helgemo-site.ts first");

  const { data: post, error } = await supabase
    .from("blog_posts").insert([{
      site_id: site.id,
      state: "draft_ready",
      title: "Phase 2 image-match smoke — please ignore",
      body_html: "<p>Smoke test draft. The image-match job should populate posts.image_id.</p>",
      meta_title: "Phase 2 smoke",
      meta_description: "Image-match smoke test for the blog engine.",
      meta_tags: ["smoke", "phase2"],
      author_label: process.env.SIERRA_DEFAULT_AUTHOR ?? null,
      category_label: process.env.SIERRA_DEFAULT_CATEGORY ?? null,
    }]).select("id").single();
  if (error) throw error;
  console.log("draft", post!.id, "(image_match job auto-enqueued via trigger)");
}
main().catch((e) => { console.error(e); process.exit(1); });
