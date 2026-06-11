import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader2, Upload as UploadIcon, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createListing } from "@/lib/labListingsApi";
import { PageHeading, Card } from "@/components/dashboard/primitives";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 14px",
  fontSize: 13,
  fontFamily: "var(--le-font-sans)",
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted)",
  display: "block",
  marginBottom: 6,
};

export default function LabListingNew() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [model, setModel] = useState<string>("kling-v2-6-pro");

  const MODEL_OPTIONS: Array<{ key: string; label: string; price: string }> = [
    { key: "kling-v2-native", label: "Kling 2.0 (native — pre-paid credits)", price: "free (credits)" },
    { key: "kling-v3-pro", label: "Kling 3.0 Pro", price: "$0.095" },
    { key: "kling-v3-std", label: "Kling 3.0 Std", price: "$0.071" },
    { key: "kling-v2-6-pro", label: "Kling 2.6 Pro", price: "$0.060" },
    { key: "kling-v2-1-pair", label: "Kling 2.1 Start-End-Frame", price: "$0.076" },
    { key: "seedance-pair", label: "Seedance 2.0 (start+end frame)", price: "$0.096" },
    { key: "kling-v2-master", label: "Kling 2.0 Master", price: "$0.221" },
    { key: "kling-o3-pro", label: "Kling O3 Pro", price: "$0.095" },
  ];
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (files.length === 0) { setError("Select at least one photo"); return; }
    setUploading(true);
    setProgress({ total: files.length, done: 0 });
    try {
      const uploaded: Array<{ image_url: string; image_path: string }> = [];
      for (const file of files) {
        const path = `lab-listings/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from("property-photos").upload(path, file, { upsert: false });
        if (upErr) throw new Error(`Upload ${file.name}: ${upErr.message}`);
        const { data: pub } = supabase.storage.from("property-photos").getPublicUrl(path);
        uploaded.push({ image_url: pub.publicUrl, image_path: path });
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }

      const { listing_id } = await createListing({
        name: name || `Listing ${new Date().toISOString().slice(0, 16)}`,
        model_name: model,
        notes: notes || null,
        photos: uploaded,
      });
      navigate(`/dashboard/development/lab/${listing_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="le-fade-up" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <PageHeading
        eyebrow="Lab · New listing"
        title="Create lab listing"
        actions={
          <Link
            to="/dashboard/development/lab"
            className="le-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <ArrowLeft style={{ width: 13, height: 13 }} />
            Back
          </Link>
        }
      />

      <div style={{ maxWidth: 680 }}>
        <Card padding={24}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Name */}
            <div>
              <label style={labelStyle}>Name (optional)</label>
              <input
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Miami waterfront test"
              />
            </div>

            {/* Model picker */}
            <div>
              <label style={labelStyle}>Default model · use Generate-all on each scene to A/B</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {MODEL_OPTIONS.map((m) => {
                  const active = model === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setModel(m.key)}
                      style={{
                        padding: "7px 12px",
                        fontSize: 12,
                        fontWeight: 500,
                        borderRadius: "var(--radius-sm)",
                        border: active ? "none" : "1px solid var(--line)",
                        background: active ? "var(--ink)" : "var(--surface)",
                        color: active ? "#fff" : "var(--ink-2)",
                        cursor: "pointer",
                        fontFamily: "var(--le-font-sans)",
                        transition: "background .15s, color .15s",
                      }}
                    >
                      {m.label}{" "}
                      <span style={{ opacity: 0.6 }}>{m.price}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.5 }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What are you testing?"
              />
            </div>

            {/* File upload */}
            <div>
              <label style={labelStyle}>Photos (10–30 recommended)</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                style={{ ...inputStyle, cursor: "pointer" }}
              />
              {files.length > 0 && (
                <p style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>
                  {files.length} {files.length === 1 ? "file" : "files"} selected
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(196,74,74,0.07)",
                  border: "1px solid rgba(196,74,74,0.18)",
                  fontSize: 12.5,
                  color: "var(--bad)",
                }}
              >
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
              <button
                type="button"
                onClick={handleCreate}
                disabled={uploading || files.length === 0}
                className="le-btn-dark"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: uploading || files.length === 0 ? 0.5 : 1,
                  cursor: uploading || files.length === 0 ? "not-allowed" : "pointer",
                }}
              >
                {uploading ? (
                  <>
                    <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                    Uploading {progress.done}/{progress.total}
                  </>
                ) : (
                  <>
                    <UploadIcon style={{ width: 13, height: 13 }} />
                    Upload &amp; Analyze
                  </>
                )}
              </button>
              <Link
                to="/dashboard/development/lab"
                className="le-btn-ghost"
                style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
              >
                Cancel
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
