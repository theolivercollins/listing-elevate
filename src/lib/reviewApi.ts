export interface ReviewVersion { id: string; version: number; file_name: string; created_at: string; }
export interface ReviewComment {
  id: string; version_id: string;
  kind: "comment" | "approval" | "revision_request";
  body: string | null; video_timestamp_seconds: number | null;
  author: string; created_at: string;
}
export interface ReviewPageData {
  deliverable: { id: string; title: string; description: string | null; status: string };
  order: { id: string; title: string; status: string; amount_cents: number; currency: string };
  versions: ReviewVersion[];
  latest_version_id: string;
  stream_url: string;
  comments: ReviewComment[];
}

export async function getReview(token: string): Promise<ReviewPageData> {
  const res = await fetch(`/api/portal/review/${token}`);
  if (!res.ok) throw new Error((await res.json()).error ?? "load failed");
  return res.json();
}

export async function getVersionStream(token: string, versionId: string): Promise<string> {
  const res = await fetch(`/api/portal/review/${token}/versions/${versionId}/stream`);
  if (!res.ok) throw new Error((await res.json()).error ?? "stream failed");
  return (await res.json()).stream_url;
}

export async function getOrderStatus(token: string): Promise<string | null> {
  const res = await fetch(`/api/portal/review/${token}/status`);
  if (!res.ok) return null;
  return (await res.json()).order_status;
}

export async function postComment(
  token: string,
  accessToken: string,
  input: { body: string; video_timestamp_seconds?: number; kind: "comment" | "revision_request"; version_id: string },
): Promise<{ comment_id: string }> {
  const res = await fetch(`/api/portal/review/${token}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "comment failed");
  return res.json();
}

export async function approve(token: string, accessToken: string): Promise<{ client_secret: string }> {
  const res = await fetch(`/api/portal/review/${token}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "approve failed");
  return res.json();
}

export async function requestMagicLink(token: string): Promise<{ ok: true; email: string }> {
  const res = await fetch(`/api/portal/review/${token}/sign-in/magic-link`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json()).error ?? "magic link failed");
  return res.json();
}
