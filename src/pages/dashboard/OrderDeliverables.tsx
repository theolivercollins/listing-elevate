import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  createDeliverable,
  createVersion,
  finalizeVersion,
  type PortalDeliverable,
} from "@/lib/portalApi";

interface Props {
  orderId: string;
}

export function OrderDeliverables({ orderId }: Props) {
  const [deliverables, setDeliverables] = useState<PortalDeliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  async function reload() {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) return;
    const res = await fetch(`/api/portal/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    setDeliverables(json.deliverables ?? []);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (loading) return <div className="le-shimmer" style={{ height: 80 }} />;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontFamily: "var(--le-font-mono)",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--le-text-faint)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
          Deliverables ({deliverables.length})
        </div>
        <button onClick={() => setAddOpen(true)} style={primaryBtn}>
          + Add deliverable
        </button>
      </div>

      {deliverables.length === 0 ? (
        <p style={{ color: "var(--le-text-muted)", fontSize: 14 }}>
          No deliverables yet. Click <strong>Add deliverable</strong> to upload the first version.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {deliverables.map((d) => (
            <DeliverableCard key={d.id} deliverable={d} orderId={orderId} onChange={reload} />
          ))}
        </ul>
      )}

      {addOpen && (
        <AddDeliverableModal
          orderId={orderId}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DeliverableCard({
  deliverable,
  orderId,
  onChange,
}: {
  deliverable: PortalDeliverable;
  orderId: string;
  onChange: () => void;
}) {
  const latest = [...deliverable.versions]
    .sort((a, b) => b.version - a.version)
    .find((v) => v.upload_status === "uploaded");
  const reviewUrl = `${window.location.origin}/review/${deliverable.review_token}`;

  function copyLink() {
    navigator.clipboard.writeText(reviewUrl).then(() => toast.success("Review link copied"));
  }

  return (
    <li style={{ borderTop: "1px solid var(--le-border)", padding: "18px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.01em" }}>
            {deliverable.title}
          </div>
          <div
            style={{
              fontFamily: "var(--le-font-mono)",
              fontSize: 11,
              color: "var(--le-text-faint)",
              marginTop: 4,
            }}
          >
            {latest
              ? `v${latest.version} · ${formatBytes(latest.file_size_bytes)} · ${relativeTime(latest.created_at)}`
              : "no uploaded version"}
          </div>
        </div>
        <StatusPill status={deliverable.status} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <UploadButton orderId={orderId} deliverableId={deliverable.id} onUploaded={onChange} />
        <button onClick={copyLink} style={ghostBtn}>
          Copy review link
        </button>
      </div>
    </li>
  );
}

function UploadButton({
  orderId,
  deliverableId,
  onUploaded,
}: {
  orderId: string;
  deliverableId: string;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function onFile(file: File) {
    setBusy(true);
    setProgress(0);
    try {
      const v = await createVersion(orderId, deliverableId, {
        file_name: file.name,
        mime_type: file.type || "video/mp4",
        file_size_bytes: file.size,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", v.signed_upload_url);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("upload network error"));
        xhr.send(file);
      });
      await finalizeVersion(orderId, deliverableId, v.version_id);
      toast.success("Uploaded");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <label
      style={{
        ...ghostBtn,
        cursor: busy ? "wait" : "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <input
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0,
          cursor: busy ? "wait" : "pointer",
        }}
      />
      {busy ? `Uploading ${progress}%` : "↑ Upload new version"}
      {busy && (
        <span
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 1,
            background: "var(--le-text)",
            width: `${progress}%`,
            transition: "width 0.1s linear",
          }}
        />
      )}
    </label>
  );
}

function AddDeliverableModal({
  orderId,
  onClose,
  onCreated,
}: {
  orderId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"idle" | "creating" | "uploading" | "finalizing">("idle");

  function pickFile(f: File) {
    setFile(f);
    // Auto-fill title from filename (without extension) if the user hasn't typed anything yet.
    if (!title.trim()) {
      const stem = f.name.replace(/\.[^.]+$/, "");
      setTitle(stem);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !file) return;
    setBusy(true);
    try {
      setStage("creating");
      const { deliverable_id } = await createDeliverable(orderId, title.trim());

      setStage("uploading");
      setProgress(0);
      const v = await createVersion(orderId, deliverable_id, {
        file_name: file.name,
        mime_type: file.type || "video/mp4",
        file_size_bytes: file.size,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", v.signed_upload_url);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status < 300 ? resolve() : reject(new Error(`upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("upload network error"));
        xhr.send(file);
      });

      setStage("finalizing");
      await finalizeVersion(orderId, deliverable_id, v.version_id);

      toast.success("Deliverable uploaded");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStage("idle");
      setProgress(0);
    }
  }

  const submitLabel = stage === "creating"
    ? "Creating…"
    : stage === "uploading"
      ? `Uploading ${progress}%`
      : stage === "finalizing"
        ? "Finalizing…"
        : "Create + upload";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,7,16,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={busy ? undefined : onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "var(--le-bg)",
          padding: 32,
          minWidth: 480,
          maxWidth: 520,
          border: "1px solid var(--le-border)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--le-font-mono)",
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--le-text-faint)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ width: 14, height: 1, background: "var(--le-border-strong)" }} />
          New deliverable
        </div>
        <h3
          style={{
            fontSize: 34,
            fontWeight: 500,
            letterSpacing: "-0.025em",
            margin: "12px 0 24px",
          }}
        >
          Upload + name your video.
        </h3>

        {/* File drop zone */}
        <label
          style={{
            display: "block",
            position: "relative",
            border: `1px dashed ${file ? "var(--le-text)" : "var(--le-border-strong)"}`,
            padding: "32px 18px",
            textAlign: "center",
            cursor: busy ? "wait" : "pointer",
            background: file ? "var(--le-bg-sunken, transparent)" : "transparent",
            overflow: "hidden",
          }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            if (busy) return;
            const f = e.dataTransfer.files?.[0];
            if (f) pickFile(f);
          }}
        >
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: busy ? "wait" : "pointer",
            }}
          />
          {file ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em" }}>{file.name}</div>
              <div
                style={{
                  fontFamily: "var(--le-font-mono)",
                  fontSize: 11,
                  color: "var(--le-text-faint)",
                  marginTop: 6,
                }}
              >
                {formatBytes(file.size)} · {file.type || "video/*"}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: "var(--le-text-muted)" }}>
                Drop video here or <span style={{ color: "var(--le-text)", textDecoration: "underline", textUnderlineOffset: 4 }}>browse</span>
              </div>
              <div
                style={{
                  fontFamily: "var(--le-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "var(--le-text-faint)",
                  marginTop: 8,
                }}
              >
                MP4 · MOV · WebM · up to 2 GB
              </div>
            </>
          )}
          {stage === "uploading" && (
            <span
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                height: 1,
                background: "var(--le-text)",
                width: `${progress}%`,
                transition: "width 0.1s linear",
              }}
            />
          )}
        </label>

        {/* Title input */}
        <label style={{ display: "block", marginTop: 22 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--le-text-faint)",
              fontWeight: 500,
            }}
          >
            Title
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Main 60s video"
            disabled={busy}
            style={{
              width: "100%",
              marginTop: 10,
              padding: "10px 0",
              border: "none",
              borderBottom: "1px solid var(--le-border-strong)",
              fontSize: 17,
              fontWeight: 500,
              background: "transparent",
              outline: "none",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 28 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.4 : 1 }}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim() || !file}
            style={{ ...primaryBtn, opacity: busy || !title.trim() || !file ? 0.4 : 1 }}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusPill({ status }: { status: PortalDeliverable["status"] }) {
  const map: Record<PortalDeliverable["status"], { fg: string; bg: string; label: string }> = {
    pending: {
      fg: "var(--le-text-muted)",
      bg: "var(--le-bg-sunken, transparent)",
      label: "Pending",
    },
    in_review: { fg: "oklch(0.4 0.13 240)", bg: "oklch(0.94 0.04 240)", label: "In review" },
    revision_requested: {
      fg: "oklch(0.4 0.14 75)",
      bg: "oklch(0.95 0.05 75)",
      label: "Revision",
    },
    approved: { fg: "oklch(0.4 0.15 155)", bg: "oklch(0.94 0.05 155)", label: "Approved" },
  };
  const s = map[status];
  return (
    <span
      style={{
        fontFamily: "var(--le-font-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: s.fg,
        background: s.bg,
        padding: "3px 8px",
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      {s.label}
    </span>
  );
}

function formatBytes(b: number | null): string {
  if (!b) return "?";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--le-border-strong)",
  color: "var(--le-text)",
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "var(--le-accent)",
  color: "var(--le-accent-fg)",
  border: 0,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
