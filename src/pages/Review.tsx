import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getReview, type ReviewPageData } from "@/lib/reviewApi";
import { ReviewPlayer } from "./review/ReviewPlayer";
import { CommentsRail } from "./review/CommentsRail";
import { ActionBar } from "./review/ActionBar";

export default function Review() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ReviewPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  async function reload() {
    if (!token) return;
    try {
      const d = await getReview(token);
      setData(d);
      setCurrentVersionId(d.latest_version_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) return <div style={{ padding: 48 }}>{error}</div>;
  if (!data || !token) return <div style={{ padding: 48 }} className="le-shimmer" />;

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;

  return (
    <div style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid var(--le-border)" }}>
        <div style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--le-text-faint)" }}>
          {data.order.title} · v{data.versions.find((v) => v.id === currentVersionId)?.version ?? "?"} of {data.versions.length}
        </div>
        <StatusPill status={data.order.status} />
      </div>

      {/* Body */}
      <div style={{ display: "flex", flexDirection: isDesktop ? "row" : "column" }}>
        <div style={{ flex: 1 }}>
          <ReviewPlayer
            token={token} versions={data.versions} currentVersionId={currentVersionId}
            initialStreamUrl={data.stream_url}
            comments={data.comments}
            onTimeUpdate={setCurrentTime}
            onVersionChange={setCurrentVersionId}
          />
          {!isDesktop && (
            <ActionBar token={token} data={data} currentVersionId={currentVersionId ?? data.latest_version_id} onChange={reload} />
          )}
        </div>
        <div style={{ width: isDesktop ? 320 : "auto", borderLeft: isDesktop ? "1px solid var(--le-border)" : "none", borderTop: !isDesktop ? "1px solid var(--le-border)" : "none" }}>
          <CommentsRail
            token={token} comments={data.comments}
            currentVersionId={currentVersionId ?? data.latest_version_id}
            currentTime={currentTime}
            onPosted={reload}
          />
        </div>
      </div>

      {isDesktop && (
        <div style={{ borderTop: "1px solid var(--le-border)" }}>
          <ActionBar token={token} data={data} currentVersionId={currentVersionId ?? data.latest_version_id} onChange={reload} />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{ fontFamily: "var(--le-font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--le-text-muted)" }}>
      ● {status.replace(/_/g, " ")}
    </span>
  );
}
