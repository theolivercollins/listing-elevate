import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface ActivityRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  created_at: string;
}

export function OrderActivity({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/portal/orders/${orderId}/activity`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (cancelled) return;
        setRows(json.activity ?? []);
      } catch (e) {
        console.error("[OrderActivity] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) return <div className="le-shimmer" style={{ height: 60 }} />;
  if (rows.length === 0) {
    return <p style={{ color: "var(--le-text-muted)", fontSize: 14 }}>No activity yet.</p>;
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {rows.map((r) => (
        <li
          key={r.id}
          style={{
            borderTop: "1px solid var(--le-border)",
            padding: "14px 0",
            display: "flex",
            gap: 18,
          }}
        >
          <span
            style={{
              fontFamily: "var(--le-font-mono)",
              fontSize: 11,
              color: "var(--le-text-faint)",
              minWidth: 110,
            }}
          >
            {new Date(r.created_at).toLocaleString()}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</div>
            {r.body && (
              <div style={{ fontSize: 13, color: "var(--le-text-muted)", marginTop: 4 }}>
                {r.body}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
