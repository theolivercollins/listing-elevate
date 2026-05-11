import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { postComment, type ReviewPageData } from "@/lib/reviewApi";
import { PaymentPanel } from "./PaymentPanel";

interface Props {
  token: string;
  data: ReviewPageData;
  currentVersionId: string;
  onChange: () => void;
}

export function ActionBar({ token, data, currentVersionId, onChange }: Props) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (data.order.status === "paid") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", gap: 12 }}>
        <a
          href={`/api/portal/review/${token}/download`}
          style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 18px", fontSize: 13, fontWeight: 500, textDecoration: "none" }}
        >
          ↓ Download
        </a>
      </div>
    );
  }

  if (paymentOpen) {
    return <PaymentPanel token={token} amountCents={data.order.amount_cents} currency={data.order.currency} onClose={() => setPaymentOpen(false)} onPaid={onChange} />;
  }

  async function submitRevision() {
    if (!revisionNote.trim()) return;
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) { setBusy(false); return; }
      await postComment(token, session.access_token, {
        body: revisionNote.trim(),
        kind: "revision_request",
        version_id: currentVersionId,
      });
      setRevisionOpen(false);
      setRevisionNote("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 24px", gap: 12, background: "var(--le-bg)" }}>
        <button onClick={() => setRevisionOpen(true)} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Request revision
        </button>
        <button onClick={() => setPaymentOpen(true)} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Approve & pay ${(data.order.amount_cents / 100).toFixed(0)}
        </button>
      </div>
      {revisionOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,7,16,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setRevisionOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--le-bg)", padding: 32, minWidth: 460, border: "1px solid var(--le-border)" }}>
            <div className="le-eyebrow"><span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />Request revision</div>
            <h3 style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", margin: "12px 0 18px" }}>What needs to change?</h3>
            <textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={4} placeholder="Audio is too quiet in the kitchen scene, please redo." style={{ width: "100%", padding: "8px 0", border: "none", borderBottom: "1px solid var(--le-border-strong)", background: "transparent", outline: "none", fontSize: 14, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={() => setRevisionOpen(false)} style={{ background: "transparent", border: "1px solid var(--le-border-strong)", padding: "10px 16px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={submitRevision} disabled={busy || !revisionNote.trim()} style={{ background: "var(--le-accent)", color: "var(--le-accent-fg)", border: 0, padding: "10px 16px", fontSize: 13, cursor: "pointer", opacity: busy || !revisionNote.trim() ? 0.4 : 1 }}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
