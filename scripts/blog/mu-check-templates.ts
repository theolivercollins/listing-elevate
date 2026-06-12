import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: site } = await supabase.from("blog_sites").select("id").eq("host_kind", "sierra").single();
  const siteId = site!.id as string;

  const { data: bt } = await supabase.from("blog_templates")
    .select("id,created_at,body_html")
    .eq("site_id", siteId)
    .eq("metadata->>kind", "market_update")
    .eq("metadata->>mu_role", "blog")
    .order("created_at", { ascending: true });

  const { data: et } = await supabase.from("email_templates")
    .select("id,created_at,body_html")
    .eq("site_id", siteId)
    .eq("metadata->>kind", "market_update")
    .eq("metadata->>mu_role", "email")
    .order("created_at", { ascending: true });

  for (const r of (bt ?? [])) {
    const tokenCount = (r.body_html?.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []).length;
    console.log(`blog_template  id=${r.id}  created=${r.created_at}  tokens=${tokenCount}`);
  }
  for (const r of (et ?? [])) {
    const tokenCount = (r.body_html?.match(/\{\{[A-Z0-9_]+\}\}/g) ?? []).length;
    console.log(`email_template id=${r.id}  created=${r.created_at}  tokens=${tokenCount}`);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
