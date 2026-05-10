// scripts/blog/seed-helgemo-site.ts
import "dotenv/config";
import { getSupabase } from "../../lib/client.js";

async function main() {
  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("blog_sites")
    .select("id")
    .eq("host_kind", "sierra")
    .eq("name", "Helgemo Team")
    .maybeSingle();
  if (existing) {
    console.log("already seeded", existing.id);
    return;
  }
  const baseUrl = process.env.SIERRA_HELGEMO_BASE_URL;
  if (!baseUrl) throw new Error("SIERRA_HELGEMO_BASE_URL not set");
  const { data, error } = await supabase
    .from("blog_sites")
    .insert([{
      name: "Helgemo Team",
      host_kind: "sierra",
      base_url: baseUrl,
      bot_credentials_ref: "env:SIERRA_HELGEMO_*",
      active: true,
    }])
    .select("id")
    .single();
  if (error) throw error;
  console.log("seeded", data!.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
