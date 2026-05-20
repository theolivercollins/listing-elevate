// api/blog/emails/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../lib/auth.js";
import { getSupabase } from "../../../lib/client.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const state = req.query.state as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);

    let qb = supabase
      .from("emails")
      .select("id, site_id, template_id, source_post_id, state, subject, preheader, from_name, from_email, audience, authored, cost_usd_cents, sent_at, send_provider, updated_at, created_at, metadata")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (state) {
      const states = state.split(",");
      qb = qb.in("state", states);
    }
    if (cursor) qb = qb.lt("updated_at", cursor);

    const { data, error } = await qb;
    if (error) return res.status(500).json({ error: error.message });

    const emails = data ?? [];
    const next_cursor = emails.length === limit ? emails[emails.length - 1].updated_at : null;
    return res.status(200).json({ emails, next_cursor });
  }

  if (req.method === "POST") {
    const b = req.body ?? {};

    const { data: site } = await supabase
      .from("blog_sites")
      .select("id")
      .eq("host_kind", "sierra")
      .single();
    if (!site) return res.status(500).json({ error: "no Sierra site" });

    const { data, error } = await supabase
      .from("emails")
      .insert([{
        site_id: site.id,
        template_id: b.template_id ?? null,
        source_post_id: b.source_post_id ?? null,
        state: b.state ?? "draft",
        subject: b.subject ?? "",
        preheader: b.preheader ?? null,
        from_name: b.from_name ?? null,
        from_email: b.from_email ?? null,
        reply_to: b.reply_to ?? null,
        audience: b.audience ?? null,
        recipients_json: Array.isArray(b.recipients_json) ? b.recipients_json : [],
        design_json: b.design_json ?? {},
        body_html: b.body_html ?? "",
        body_text: b.body_text ?? null,
        authored: b.authored ?? "manual",
        metadata: b.metadata ?? {},
      }])
      .select("id")
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ id: data!.id });
  }

  return res.status(405).end();
}
