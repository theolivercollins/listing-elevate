// GET /api/blog/market-update/runs/:id — fetch a single run with live draft status.
//
// Response shape: { run, drafts: { posts: DraftPost[], emails: DraftEmail[] } }
//   - posts are fetched from blog_posts by created_post_ids
//   - emails are fetched from emails by created_email_ids
//   - soft-deleted drafts are intentionally included (no active filter) so the UI
//     never shows dangling IDs — the state field conveys their status
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin } from "../../../../lib/auth.js";
import { getSupabase } from "../../../../lib/client.js";

// Columns we need from blog_posts for the run detail view:
//   id, title, state — for status display
//   external_post_url, external_post_id — to link/confirm Sierra publish
//   active — so the UI can show soft-deleted drafts distinctly
export interface DraftPost {
  id: string;
  title: string;
  state: string;
  external_post_url: string | null;
  external_post_id: string | null;
  active: boolean;
}

// Columns we need from emails for the run detail view:
//   id, subject, state — for status display
//   sent_at — when the email was sent via Sendy
//   active — so the UI can show soft-deleted drafts distinctly
export interface DraftEmail {
  id: string;
  subject: string;
  state: string;
  sent_at: string | null;
  active: boolean;
}

export interface RunDetailResponse {
  run: Record<string, unknown>;
  drafts: {
    posts: DraftPost[];
    emails: DraftEmail[];
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: "id required" });

  const supabase = getSupabase();

  // 1. Fetch the run row.
  const { data: run, error: runErr } = await supabase
    .from("market_update_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (runErr || !run) return res.status(404).json({ error: runErr?.message ?? "not found" });

  // 2. Fetch associated blog_posts — use .in() so missing IDs just return nothing rather
  //    than 404. No active filter: soft-deleted drafts must still appear so the UI never
  //    shows dangling IDs.
  const postIds: string[] = Array.isArray(run.created_post_ids) ? run.created_post_ids : [];
  const emailIds: string[] = Array.isArray(run.created_email_ids) ? run.created_email_ids : [];

  const [postsResult, emailsResult] = await Promise.all([
    postIds.length > 0
      ? supabase
          .from("blog_posts")
          .select("id, title, state, external_post_url, external_post_id, active")
          .in("id", postIds)
      : Promise.resolve({ data: [] as DraftPost[], error: null }),
    emailIds.length > 0
      ? supabase
          .from("emails")
          .select("id, subject, state, sent_at, active")
          .in("id", emailIds)
      : Promise.resolve({ data: [] as DraftEmail[], error: null }),
  ]);

  // Non-fatal: surface DB errors in the drafts arrays as empty rather than 500-ing the
  // whole response — the run data itself is valid.
  const posts: DraftPost[] = (postsResult.data ?? []) as DraftPost[];
  const emails: DraftEmail[] = (emailsResult.data ?? []) as DraftEmail[];

  const body: RunDetailResponse = { run: run as Record<string, unknown>, drafts: { posts, emails } };
  return res.status(200).json(body);
}
