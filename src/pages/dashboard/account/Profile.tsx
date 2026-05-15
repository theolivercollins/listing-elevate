import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import { Icon } from "@/components/dashboard/icons";
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

const HINT_STYLE: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  marginTop: 6,
  lineHeight: 1.5,
};

export default function AccountProfile() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";

  const [saving, setSaving] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
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

  const [password, setPassword] = useState({ next: "", confirm: "" });
  const passwordRef = useRef<HTMLInputElement | null>(null);

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

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (password.next.length < 8) {
      toast.error("Password must be at least 8 characters");
      passwordRef.current?.focus();
      return;
    }
    if (password.next !== password.confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: password.next });
      if (error) throw error;
      toast.success("Password updated");
      setPassword({ next: "", confirm: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSignOutAll() {
    if (!confirm("Sign out everywhere? You'll need to log back in on every device.")) return;
    setSigningOutAll(true);
    try {
      // Supabase scope: "global" revokes every refresh token for the user.
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      await signOut();
      toast.success("Signed out of all sessions");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sign out everywhere");
      setSigningOutAll(false);
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
      <PageHeading
        eyebrow={isAdmin ? "Account · Owner" : "Account"}
        title={isAdmin ? "Profile & security" : "Profile & brand"}
        sub={
          isAdmin
            ? "Owner account. Personal info, password, and session controls. Workspace-level settings live in Settings."
            : undefined
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>

        {/* Identity card — every role */}
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
                />
                <p style={HINT_STYLE}>
                  Email is your sign-in identity. {isAdmin ? "Owner email cannot be changed from this UI." : "Contact support to change."}
                </p>
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

        {/* Password card — every role */}
        <Card padding={24}>
          <form onSubmit={handlePasswordChange}>
            <SectionTitle title="Password" />
            <p style={HINT_STYLE}>
              Set a new password. At least 8 characters. You'll stay signed in here, but other devices keep their existing session unless you sign out everywhere below.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
              <div>
                <label style={LABEL_STYLE} htmlFor="new_password">New password</label>
                <input
                  id="new_password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="new-password"
                  style={INPUT_STYLE}
                  value={password.next}
                  onChange={(e) => setPassword({ ...password, next: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label style={LABEL_STYLE} htmlFor="confirm_password">Confirm</label>
                <input
                  id="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  style={INPUT_STYLE}
                  value={password.confirm}
                  onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                type="submit"
                className="le-btn-dark"
                disabled={savingPassword || !password.next || !password.confirm}
                style={{
                  opacity: savingPassword || !password.next || !password.confirm ? 0.6 : 1,
                  fontSize: 12,
                  padding: "8px 20px",
                }}
              >
                {savingPassword ? "Updating..." : "Update password"}
              </button>
            </div>
          </form>
        </Card>

        {isAdmin ? (
          // Owner / admin: security + danger zone instead of brokerage form.
          <Card padding={24}>
            <SectionTitle eyebrow="Owner" title="Security & sessions" />
            <p style={HINT_STYLE}>
              Brokerage and brand settings are tenant-side and live with each agent's profile, not the owner account. Workspace-level controls live in <a href="/dashboard/settings" style={{ color: "var(--accent)", textDecoration: "none" }}>Settings</a>.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 16,
                alignItems: "center",
                paddingTop: 20,
                marginTop: 4,
                borderTop: "1px solid var(--line-2)",
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>Sign out of all sessions</div>
                <div style={HINT_STYLE}>
                  Revoke every active session for this account — phones, other browsers, anywhere this Supabase user is signed in. Use after a password reset or a lost device.
                </div>
              </div>
              <button
                type="button"
                className="le-btn-ghost"
                onClick={handleSignOutAll}
                disabled={signingOutAll}
                style={{ opacity: signingOutAll ? 0.6 : 1, fontSize: 12, padding: "8px 14px", color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }}
              >
                <Icon name="external" size={13} />
                {signingOutAll ? "Signing out..." : "Sign out everywhere"}
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 16,
                alignItems: "center",
                paddingTop: 16,
                marginTop: 16,
                borderTop: "1px solid var(--line-2)",
              }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>Owner role</div>
                <div style={HINT_STYLE}>
                  You have admin access to every workspace surface, including the danger-zone settings.
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "rgba(47,138,85,0.10)",
                  color: "var(--good)",
                  textTransform: "uppercase",
                }}
              >
                Admin
              </span>
            </div>
          </Card>
        ) : (
          // Default user: brokerage + brand form (same as before).
          <Card padding={24}>
            <form onSubmit={handleSaveBrand}>
              <SectionTitle title="Brokerage & brand" />
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>

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
        )}
      </div>
    </div>
  );
}
