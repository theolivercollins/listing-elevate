import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import { ConnectedAccountsCard } from "@/components/dashboard/ConnectedAccountsCard";
import { Icon } from "@/components/dashboard/icons";
import { passwordIssue } from "@/lib/passwordUtils";

// ─── Shared field primitives ──────────────────────────────────────────────────
// Tailwind classes for form elements using the L2 dashboard CSS vars.
// Avoids all inline style objects while staying on the canonical token scale.

const inputCls =
  "w-full py-[9px] px-[14px] text-[13px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] outline-none font-[inherit] box-border";

const inputReadonlyCls =
  "w-full py-[9px] px-[14px] text-[13px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] outline-none font-[inherit] box-border cursor-default";

const labelCls = "block text-[12px] font-medium text-[var(--muted)] mb-1.5";

const hintCls = "text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]";

// ─── Avatar upload helpers ──────────────────────────────────────────────────

/** Initials fallback for the avatar preview when no photo is set. */
function initialsFor(firstName: string | null, lastName: string | null, email: string | null): string {
  const first = (firstName || "").trim().charAt(0);
  const last = (lastName || "").trim().charAt(0);
  const initials = `${first}${last}`.toUpperCase();
  if (initials) return initials;
  return (email || "").trim().charAt(0).toUpperCase() || "?";
}

// Raster-only MIME whitelist for the avatar uploader. Extensions are derived
// from this map (never from the client-supplied filename) so an SVG — or any
// other type not in this set — is rejected client-side before it ever reaches
// Storage. The bucket itself is locked to the same list at the DB level.
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const AVATAR_ACCEPT = Object.keys(ALLOWED_AVATAR_TYPES).join(",");
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Extracts the current avatar's extension from its stored public URL (ignoring the cache-bust query string), so a re-upload with a different type can clean up the old object. */
function extFromAvatarUrl(url: string): string | null {
  const path = url.split("?")[0];
  const match = path.match(/avatar\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : null;
}

// ─── AccountProfile ───────────────────────────────────────────────────────────

export default function AccountProfile() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";

  const [saving, setSaving] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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
    const pwErr = passwordIssue(password.next);
    if (pwErr) {
      toast.error(pwErr);
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = ALLOWED_AVATAR_TYPES[file.type];
    if (!ext) {
      toast.error("Please choose a PNG, JPG, WEBP, or GIF image");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error("Image must be smaller than 5MB");
      e.target.value = "";
      return;
    }
    setUploadingAvatar(true);
    try {
      // Path's first segment must equal the user's uid — required by the
      // existing storage.objects RLS policies on the `user-logos` bucket
      // (auth.uid()::text = (storage.foldername(name))[1]).
      const path = `${profile!.user_id}/avatar.${ext}`;
      // If the previous avatar was a different file type (e.g. png -> jpg),
      // its object lives at a different path and won't be overwritten by the
      // upsert below — remove it so we don't leave an orphaned object behind.
      const prevExt = profile?.avatar_url ? extFromAvatarUrl(profile.avatar_url) : null;
      if (prevExt && prevExt !== ext) {
        await supabase.storage.from("user-logos").remove([`${profile!.user_id}/avatar.${prevExt}`]);
      }
      const { error: uploadErr } = await supabase.storage
        .from("user-logos")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from("user-logos").getPublicUrl(path);
      // Cache-bust so the browser doesn't keep showing a stale cached image
      // after a re-upload to the same path.
      const bustedUrl = `${urlData.publicUrl}?v=${Date.now()}`;
      const { error: updateErr } = await supabase
        .from("user_profiles")
        .update({ avatar_url: bustedUrl, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (updateErr) throw updateErr;
      await refreshProfile();
      toast.success("Profile photo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  }

  async function handleAvatarRemove() {
    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({ avatar_url: null, updated_at: new Date().toISOString() })
        .eq("user_id", profile!.user_id);
      if (error) throw error;
      await refreshProfile();
      toast.success("Profile photo removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove photo");
    }
  }

  return (
    <div className="le-fade-up">
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

      <div className="flex flex-col gap-5 mt-7">

        {/* Identity card — every role */}
        <Card padding={24}>
          <form onSubmit={handleSaveIdentity}>
            <SectionTitle title="Personal details" />

            <div className="mt-5">
              <label className={labelCls}>Profile photo</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full shrink-0 overflow-hidden border border-[var(--line)] bg-[var(--surface)] flex items-center justify-center">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt="Profile photo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-[16px] font-medium text-[var(--muted)]">
                      {initialsFor(form.first_name, form.last_name, form.email)}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[12px] text-[var(--muted)]">
                    {uploadingAvatar ? "Uploading..." : "PNG, JPG, WEBP, or GIF · up to 5MB"}
                  </span>
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <span className="le-btn-ghost text-[12px] py-1.5 px-3 pointer-events-none">
                        {profile?.avatar_url ? "Replace" : "Upload photo"}
                      </span>
                      <input
                        type="file"
                        accept={AVATAR_ACCEPT}
                        className="hidden"
                        onChange={handleAvatarUpload}
                        disabled={uploadingAvatar}
                      />
                    </label>
                    {profile?.avatar_url && (
                      <button
                        type="button"
                        className="le-btn-ghost text-[12px] py-1.5 px-3 [color:var(--bad)] [border-color:rgba(196,74,74,0.25)]"
                        onClick={handleAvatarRemove}
                        disabled={uploadingAvatar}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-5">
              <div>
                <label className={labelCls} htmlFor="first_name">First name</label>
                <input
                  id="first_name"
                  className={inputCls}
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="last_name">Last name</label>
                <input
                  id="last_name"
                  className={inputCls}
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  readOnly
                  className={inputReadonlyCls}
                  value={form.email}
                />
                <p className={hintCls}>
                  Email is your sign-in identity. {isAdmin ? "Owner email cannot be changed from this UI." : "Contact support to change."}
                </p>
              </div>
              <div>
                <label className={labelCls} htmlFor="phone">Phone</label>
                <input
                  id="phone"
                  type="tel"
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button
                type="submit"
                className="le-btn-dark text-[12px] py-2 px-5"
                disabled={saving}
                style={saving ? { opacity: 0.6 } : undefined}
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
            <p className={hintCls}>
              Set a new password. At least 10 characters, with two or more character types (lowercase, uppercase, number, symbol). You'll stay signed in here, but other devices keep their existing session unless you sign out everywhere below.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-5">
              <div>
                <label className={labelCls} htmlFor="new_password">New password</label>
                <input
                  id="new_password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  className={inputCls}
                  value={password.next}
                  onChange={(e) => setPassword({ ...password, next: e.target.value })}
                  placeholder="••••••••"
                />
                {password.next.length > 0 && passwordIssue(password.next) !== null && (
                  <p className="text-[12px] text-[var(--bad)] mt-1.5 leading-[1.5]">
                    {passwordIssue(password.next)}
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="confirm_password">Confirm</label>
                <input
                  id="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  className={inputCls}
                  value={password.confirm}
                  onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button
                type="submit"
                className="le-btn-dark text-[12px] py-2 px-5"
                disabled={savingPassword || !!passwordIssue(password.next) || !password.confirm}
                style={savingPassword || !!passwordIssue(password.next) || !password.confirm ? { opacity: 0.6 } : undefined}
              >
                {savingPassword ? "Updating..." : "Update password"}
              </button>
            </div>
          </form>
        </Card>

        {/* Connected accounts — every role */}
        <ConnectedAccountsCard />

        {isAdmin ? (
          // Owner / admin: security + danger zone instead of brokerage form.
          <Card padding={24}>
            <SectionTitle eyebrow="Owner" title="Security & sessions" />
            <p className={hintCls}>
              Brokerage and brand settings are tenant-side and live with each agent's profile, not the owner account. Workspace-level controls live in{" "}
              <a href="/dashboard/settings" className="text-[var(--accent)] no-underline">Settings</a>.
            </p>

            {/* Two-factor authentication — email OTP step-up, no setup required */}
            <div className="grid grid-cols-[1fr_auto] gap-4 items-center pt-5 mt-1 border-t border-[var(--line-2)]">
              <div>
                <div className="text-[13.5px] font-medium text-[var(--ink)]">Two-factor authentication</div>
                <div className="text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]">Admin sign-in is protected by a one-time code emailed to you. There's nothing to set up.</div>
              </div>
              <span className="text-[11px] font-semibold tracking-[0.02em] py-1 px-2.5 rounded-full bg-[rgba(47,138,85,0.10)] text-[var(--good)] uppercase">Enabled</span>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-4 items-center pt-5 mt-1 border-t border-[var(--line-2)]">
              <div>
                <div className="text-[13.5px] font-medium text-[var(--ink)]">Sign out of all sessions</div>
                <div className={hintCls}>
                  Revoke every active session for this account — phones, other browsers, anywhere this Supabase user is signed in. Use after a password reset or a lost device.
                </div>
              </div>
              <button
                type="button"
                className="le-btn-ghost text-[12px] py-2 px-3.5"
                onClick={handleSignOutAll}
                disabled={signingOutAll}
                style={signingOutAll
                  ? { opacity: 0.6, color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }
                  : { color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }}
              >
                <Icon name="external" size={13} />
                {signingOutAll ? "Signing out..." : "Sign out everywhere"}
              </button>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-4 items-center pt-4 mt-4 border-t border-[var(--line-2)]">
              <div>
                <div className="text-[13.5px] font-medium text-[var(--ink)]">Owner role</div>
                <div className={hintCls}>
                  You have admin access to every workspace surface, including the danger-zone settings.
                </div>
              </div>
              <span className="text-[11px] font-semibold tracking-[0.02em] py-1 px-2.5 rounded-full bg-[rgba(47,138,85,0.10)] text-[var(--good)] uppercase">
                Admin
              </span>
            </div>
          </Card>
        ) : (
          // Default user: brokerage + brand form (same as before).
          <Card padding={24}>
            <form onSubmit={handleSaveBrand}>
              <SectionTitle title="Brokerage & brand" />
              <div className="flex flex-col gap-4 mt-5">

                <div>
                  <label className={labelCls} htmlFor="brokerage">Brokerage name</label>
                  <input
                    id="brokerage"
                    className={inputCls}
                    value={brand.brokerage}
                    onChange={(e) => setBrand({ ...brand, brokerage: e.target.value })}
                    placeholder="Compass, Keller Williams..."
                  />
                </div>

                <div>
                  <label className={labelCls}>Logo</label>
                  <div className="flex items-center gap-4 px-4 py-[14px] h-16 border border-dashed border-[var(--line)] rounded-[12px] bg-[var(--surface)]">
                    {profile?.logo_url ? (
                      <>
                        <img
                          src={profile.logo_url}
                          alt="Logo"
                          className="h-9 max-w-[120px] object-contain"
                        />
                        <button
                          type="button"
                          className="le-btn-ghost text-[12px] py-1.5 px-3 [color:var(--bad)] [border-color:rgba(196,74,74,0.25)]"
                          onClick={handleLogoRemove}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[12px] text-[var(--muted)] flex-1">
                          {uploading ? "Uploading..." : "PNG with transparency works best"}
                        </span>
                        <label className="cursor-pointer">
                          <span className="le-btn-ghost text-[12px] py-1.5 px-3 pointer-events-none">
                            Upload
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLogoUpload}
                            disabled={uploading}
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {(["primary", "secondary"] as const).map((key) => (
                    <div key={key}>
                      <label className={labelCls}>
                        {key === "primary" ? "Primary color" : "Secondary color"}
                      </label>
                      <div className="flex gap-2 items-center">
                        <label className="w-[38px] h-[38px] rounded-[10px] shrink-0 border border-[var(--line)] cursor-pointer relative overflow-hidden"
                          style={{ background: brand.colors[key] }}>
                          <input
                            type="color"
                            value={brand.colors[key]}
                            onChange={(e) =>
                              setBrand({ ...brand, colors: { ...brand.colors, [key]: e.target.value } })
                            }
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                        </label>
                        <input
                          className={`${inputCls} tabular-nums`}
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

              <div className="flex justify-end mt-5">
                <button
                  type="submit"
                  className="le-btn-dark text-[12px] py-2 px-5"
                  disabled={savingBrand}
                  style={savingBrand ? { opacity: 0.6 } : undefined}
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
