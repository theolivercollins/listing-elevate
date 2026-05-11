import { useEffect, useRef, useState } from "react";
import { getVersionStream, type ReviewComment, type ReviewVersion } from "@/lib/reviewApi";

interface Props {
  token: string;
  versions: ReviewVersion[];
  currentVersionId: string | null;
  initialStreamUrl: string;
  comments: ReviewComment[];
  onTimeUpdate: (seconds: number) => void;
  onVersionChange: (versionId: string) => void;
}

export function ReviewPlayer({ token, versions, currentVersionId, initialStreamUrl, comments, onTimeUpdate, onVersionChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamUrl, setStreamUrl] = useState(initialStreamUrl);
  const [duration, setDuration] = useState(0);

  // Refresh stream URL when version changes (initial URL only valid for latest)
  useEffect(() => {
    if (!currentVersionId) return;
    if (currentVersionId === versions[versions.length - 1]?.id) {
      setStreamUrl(initialStreamUrl);
      return;
    }
    getVersionStream(token, currentVersionId).then(setStreamUrl).catch(console.error);
  }, [token, currentVersionId, versions, initialStreamUrl]);

  const versionComments = comments.filter((c) => c.version_id === currentVersionId && c.video_timestamp_seconds != null);

  return (
    <div style={{ background: "#000" }}>
      <video
        ref={videoRef}
        src={streamUrl}
        controls
        style={{ width: "100%", aspectRatio: "16/9", display: "block" }}
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
      {/* Timeline strip with comment dots */}
      <div style={{ position: "relative", height: 18, background: "#0e0e0e", borderTop: "1px solid var(--le-border)" }}>
        {versionComments.map((c) => (
          <button
            key={c.id}
            onClick={() => { if (videoRef.current) videoRef.current.currentTime = c.video_timestamp_seconds ?? 0; }}
            title={c.body ?? ""}
            style={{
              position: "absolute",
              left: `${duration ? (c.video_timestamp_seconds! / duration) * 100 : 0}%`,
              top: 6,
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--le-text-faint)",
              border: 0, cursor: "pointer", padding: 0,
              transform: "translateX(-50%)",
            }}
          />
        ))}
      </div>
      {/* Version selector */}
      {versions.length > 1 && (
        <div style={{ display: "flex", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--le-border)" }}>
          {versions.map((v) => (
            <button
              key={v.id}
              onClick={() => onVersionChange(v.id)}
              style={{
                background: "transparent", border: 0,
                fontFamily: "var(--le-font-mono)", fontSize: 11, letterSpacing: "0.04em",
                color: v.id === currentVersionId ? "var(--le-text)" : "var(--le-text-faint)",
                borderBottom: v.id === currentVersionId ? "1px solid var(--le-text)" : "1px solid transparent",
                padding: "2px 0", cursor: "pointer",
              }}
            >v{v.version}</button>
          ))}
        </div>
      )}
    </div>
  );
}
