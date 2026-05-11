import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { postComment, type ReviewComment } from "@/lib/reviewApi";
import { SignInPanel } from "./SignInPanel";

interface Props {
  token: string;
  comments: ReviewComment[];
  currentVersionId: string;
  currentTime: number;
  onPosted: () => void;
}

export function CommentsRail({ token, comments, currentVersionId, currentTime, onPosted }: Props) {
  const [body, setBody] = useState("");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<{ access_token: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || !session) return;
    setBusy(true);
    try {
      await postComment(token, session.access_token, {
        body: body.trim(),
        video_timestamp_seconds: pin ? Math.floor(currentTime) : undefined,
        kind: "comment",
        version_id: currentVersionId,
      });
      setBody("");
      onPosted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--le-border)" }}>
        <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Comments ({comments.filter((c) => c.kind === "comment").length})</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
        {comments.filter((c) => c.kind !== "approval").map((c) => (
          <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--le-border)" }}>
            {c.video_timestamp_seconds != null && (
              <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", marginBottom: 4 }}>
                {Math.floor(c.video_timestamp_seconds / 60)}:{String(c.video_timestamp_seconds % 60).padStart(2, "0")}
              </div>
            )}
            {c.kind === "revision_request" && (
              <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "oklch(0.4 0.14 75)", marginBottom: 4 }}>REVISION REQUESTED</div>
            )}
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{c.body}</div>
            <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", marginTop: 4 }}>{c.author}</div>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--le-border)", padding: "12px 18px" }}>
        {session ? (
          <form onSubmit={submit}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--le-font-mono)", fontSize: 10, color: "var(--le-text-faint)", textTransform: "uppercase", letterSpacing: "0.18em", marginBottom: 6 }}>
              <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
              Pin to {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime) % 60).padStart(2, "0")}
            </label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment…"
              style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", resize: "vertical", fontSize: 14, color: "var(--le-text)" }}
              rows={2}
            />
            <button type="submit" disabled={busy || !body.trim()} style={{ marginTop: 8, background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "8px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", opacity: busy || !body.trim() ? 0.4 : 1 }}>
              {busy ? "Posting…" : "Post"}
            </button>
          </form>
        ) : (
          <SignInPanel token={token} />
        )}
      </div>
    </div>
  );
}
