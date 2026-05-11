import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { requestMagicLink } from "@/lib/reviewApi";

interface Props { token: string; }

export function SignInPanel({ token }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  async function sendMagic() {
    setBusy(true); setError(null);
    try {
      const { email } = await requestMagicLink(token);
      setMagicSent(true);
      setEmail(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (magicSent) {
    return (
      <div>
        <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Check your email</div>
        <p style={{ fontSize: 13, color: "var(--le-text-muted)", marginTop: 8 }}>
          We sent a sign-in link to <span style={{ fontFamily: "var(--le-font-mono)" }}>{email}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={signInPassword}>
      <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Sign in to comment or approve</div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ width: "100%", marginTop: 10, padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14 }} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" style={{ width: "100%", marginTop: 8, padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14 }} />
      {error && <p style={{ color: "oklch(0.58 0.17 25)", fontSize: 12, marginTop: 8, fontFamily: "var(--le-font-mono)" }}>ERR {error}</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <button type="submit" disabled={busy} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
          {busy ? "…" : "Continue"}
        </button>
        <button type="button" onClick={sendMagic} disabled={busy} style={{ background: "transparent", border: 0, fontSize: 13, color: "var(--le-text)", textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer" }}>
          Email me a magic link
        </button>
      </div>
    </form>
  );
}
