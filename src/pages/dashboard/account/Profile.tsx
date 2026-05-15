import { useState, useEffect, type CSSProperties } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import "@/v2/styles/v2.css";

const INPUT_STYLE: CSSProperties = {
  width: "100%",
  padding: "9px 14px",
  fontSize: 13,
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const INPUT_READONLY_STYLE: CSSProperties = {
  ...INPUT_STYLE,
  color: "var(--muted)",
  cursor: "default",
};

const LABEL_STYLE: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--muted)",
  marginBottom: 6,
};

export default function AccountProfile() {
  const { profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
  });

  const [brand, setBrand] = useState({
    brokerage: "",
    colors: { primary: "#2563eb", secondary: "#ffffff" },
  });

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        phone: profile.phone || "",
        email: profile.email || "",
      });
      setBrand({
        brokerage: profile.brokerage || "",
        colors: profile.colors || { primary: "#2563eb", secondary: "#ffffff" },
      });
    }
  }, [profile]);

  async function handleSaveIdentity(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBrand(e: React.FormEvent) {
    e.preventDefault();
    setSavingBrand(true);
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({ brokerage: brand.brokerage, colors: brand.colors, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingBrand(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${profile!.user_id}/logo.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("user-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from("user-logos").getPublicUrl(path);
      const { error: updateErr } = await supabase
        .from("user_profiles")
        .update({ logo_url: urlData.publicUrl, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (updateErr) throw updateErr;
      await refreshProfile();
      toast.success("Logo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleLogoRemove() {
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({ logo_url: null, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Logo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove logo");
    }
  }

  return (
    <div className="le-fade-up" style={{ maxWidth: 720 }}>
      <AccountSubNav />
      <PageHeading eyebrow="Account" title="Profile & brand" />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>

        {/* Identity card */}
        <Card padding={24}>
          <form onSubmit={handleSaveIdentity}>
            <SectionTitle title="Personal details" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
              <div>
                <label style={LABEL_STYLE} htmlFor="first_name">First name</label>
                <input
                  id="first_name"
                  style={INPUT_STYLE}
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div>
                <label style={LABEL_STYLE} htmlFor="last_name">Last name</label>
                <input
                  id="last_name"
                  style={INPUT_STYLE}
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
              <div>
                <label style={LABEL_STYLE} htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  readOnly
                  style={INPUT_READONLY_STYLE}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label style={LABEL_STYLE} htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  type="tel"
                  style={INPUT_STYLE}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="submit"
                className="le-btn-dark"
                disabled={saving}
                style={{ opacity: saving ? 0.6 : 1, fontSize: 12, padding: "8px 20px" }}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </Card>

        {/* Brand card */}
        <Card padding={24}>
          <form onSubmit={handleSaveBrand}>
            <SectionTitle title="Brokerage & brand" />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>

              {/* Brokerage name */}
              <div>
                <label style={LABEL_STYLE} htmlFor="brokerage">Brokerage name</label>
                <input
                  id="brokerage"
                  style={INPUT_STYLE}
                  value={brand.brokerage}
                  onChange={(e) => setBrand({ ...brand, brokerage: e.target.value })}
                  placeholder="Compass, Keller Williams..."
                />
              </div>

              {/* Logo upload */}
              <div>
                <label style={LABEL_STYLE}>Logo</label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "14px 16px",
                    height: 64,
                    border: "1px dashed var(--line)",
                    borderRadius: 12,
                    background: "var(--surface)",
                  }}
                >
                  {profile?.logo_url ? (
                    <>
                      <img
                        src={profile.logo_url}
                        alt="Logo"
                        style={{ height: 36, maxWidth: 120, objectFit: "contain" }}
                      />
                      <button
                        type="button"
                        className="le-btn-ghost"
                        onClick={handleLogoRemove}
                        style={{ fontSize: 12, padding: "6px 12px", color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 12, color: "var(--muted)", flex: 1 }}>
                        {uploading ? "Uploading..." : "PNG with transparency works best"}
                      </span>
                      <label style={{ cursor: "pointer" }}>
                        <span className="le-btn-ghost" style={{ fontSize: 12, padding: "6px 12px", pointerEvents: "none" }}>
                          Upload
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={handleLogoUpload}
                          disabled={uploading}
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Brand colors */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {(["primary", "secondary"] as const).map((key) => (
                  <div key={key}>
                    <label style={LABEL_STYLE}>
                      {key === "primary" ? "Primary color" : "Secondary color"}
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          flexShrink: 0,
                          border: "1px solid var(--line)",
                          background: brand.colors[key],
                          cursor: "pointer",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <input
                          type="color"
                          value={brand.colors[key]}
                          onChange={(e) =>
                            setBrand({ ...brand, colors: { ...brand.colors, [key]: e.target.value } })
                          }
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                        />
                      </label>
                      <input
                        style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
                        value={brand.colors[key]}
                        onChange={(e) =>
                          setBrand({ ...brand, colors: { ...brand.colors, [key]: e.target.value } })
                        }
                        maxLength={7}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="submit"
                className="le-btn-dark"
                disabled={savingBrand}
                style={{ opacity: savingBrand ? 0.6 : 1, fontSize: 12, padding: "8px 20px" }}
              >
                {savingBrand ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
