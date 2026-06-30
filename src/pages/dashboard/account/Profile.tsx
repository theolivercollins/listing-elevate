import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { PageHeading, Card, SectionTitle } from "@/components/dashboard/primitives";
import { AccountSubNav } from "@/components/dashboard/AccountSubNav";
import { Icon } from "@/components/dashboard/icons";

// ─── Shared field primitives ──────────────────────────────────────────────────
// Tailwind classes for form elements using the L2 dashboard CSS vars.
// Avoids all inline style objects while staying on the canonical token scale.

const inputCls =
  "w-full py-[9px] px-[14px] text-[13px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] outline-none font-[inherit] box-border";

const inputReadonlyCls =
  "w-full py-[9px] px-[14px] text-[13px] rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] outline-none font-[inherit] box-border cursor-default";

const labelCls = "block text-[12px] font-medium text-[var(--muted)] mb-1.5";

const hintCls = "text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]";

// ─── MfaEnrollSection ─────────────────────────────────────────────────────────
// Self-contained TOTP enrollment/management component rendered inside the
// admin security card. Reads live factor state from supabase.auth.mfa on mount
// and after each action, and calls refreshMfaFactors() so RequireAdmin's gate
// reflects the new state immediately.

type EnrollState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "enrolling";
      factorId: string;
      qrCode: string;
      secret: string;
    }
  | { phase: "enabled"; factorId: string }
  | { phase: "disabling"; factorId: string };

function MfaEnrollSection({
  requireSetup,
}: {
  /** True when the user arrived via the ?mfa_setup=1 redirect from RequireAdmin */
  requireSetup: boolean;
}) {
  const { refreshMfaFactors } = useAuth();
  const [state, setState] = useState<EnrollState>({ phase: "loading" });
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [disabling, setDisabling] = useState(false);

  // Load existing factor state on mount
  useEffect(() => {
    loadFactors();
  }, []);

  async function loadFactors() {
    setState({ phase: "loading" });
    const { data } = await supabase.auth.mfa.listFactors();
    // data.totp only contains verified TOTP factors (typed as Factor<'totp','verified'>[]).
    // Use data.all for the unverified check since it includes every factor regardless of status.
    const allTotp = (data?.all ?? []).filter((f) => f.factor_type === "totp");
    const verified = allTotp.find((f) => f.status === "verified");
    const unverified = allTotp.find((f) => f.status === "unverified");
    if (verified) {
      setState({ phase: "enabled", factorId: verified.id });
    } else if (unverified) {
      // An unverified enroll session exists (e.g. page refresh mid-enrollment).
      // Unenroll the stale factor so the user gets a fresh QR code.
      await supabase.auth.mfa.unenroll({ factorId: unverified.id });
      setState({ phase: "idle" });
    } else {
      setState({ phase: "idle" });
    }
  }

  async function handleEnable() {
    setState({ phase: "loading" });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error || !data) {
      toast.error(error?.message ?? "Failed to start 2FA setup");
      setState({ phase: "idle" });
      return;
    }
    setState({
      phase: "enrolling",
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== "enrolling") return;
    if (verifyCode.length !== 6) return;
    setVerifyError("");
    setVerifying(true);
    try {
      const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: state.factorId,
      });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: state.factorId,
        challengeId: ch.id,
        code: verifyCode,
      });
      if (vErr) throw vErr;
      await refreshMfaFactors();
      setState({ phase: "enabled", factorId: state.factorId });
      setVerifyCode("");
      toast.success("2FA enabled");
    } catch (err) {
      setVerifyError(
        err instanceof Error
          ? err.message.replace("Invalid MFA code", "Incorrect code — check your app and try again")
          : "Incorrect code"
      );
      setVerifyCode("");
    } finally {
      setVerifying(false);
    }
  }

  async function handleCancelEnroll() {
    if (state.phase !== "enrolling") return;
    await supabase.auth.mfa.unenroll({ factorId: state.factorId });
    setState({ phase: "idle" });
    setVerifyCode("");
    setVerifyError("");
  }

  async function handleDisable() {
    if (state.phase !== "enabled") return;
    if (
      !confirm(
        "Disable 2FA? Your account will only require a password to sign in."
      )
    )
      return;
    setDisabling(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: state.factorId,
      });
      if (error) throw error;
      await refreshMfaFactors();
      setState({ phase: "idle" });
      toast.success("2FA disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setDisabling(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="grid grid-cols-[1fr_auto] gap-4 items-center pt-5 mt-1 border-t border-[var(--line-2)]">
        <div>
          <div className="text-[13.5px] font-medium text-[var(--ink)]">
            Two-factor authentication
          </div>
          <div className="text-[12px] text-[var(--muted)] mt-1.5">Loading…</div>
        </div>
      </div>
    );
  }

  if (state.phase === "enrolling") {
    const qrSrc = `data:image/svg+xml;utf-8,${encodeURIComponent(state.qrCode)}`;
    return (
      <div className="pt-5 mt-1 border-t border-[var(--line-2)]">
        <div className="text-[13.5px] font-medium text-[var(--ink)] mb-1">
          Set up two-factor authentication
        </div>
        <p className="text-[12px] text-[var(--muted)] leading-[1.5] mb-4">
          Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.).
        </p>

        {/* QR code */}
        <div className="inline-flex p-3 bg-white rounded-[var(--le-r-md)] border border-[var(--line)] mb-4">
          <img
            src={qrSrc}
            alt="QR code for authenticator app"
            width={160}
            height={160}
            className="block"
          />
        </div>

        {/* Manual entry fallback */}
        <div className="mb-5">
          <div className="text-[11px] font-medium text-[var(--muted)] mb-1.5 uppercase tracking-[0.06em]">
            Or enter manually
          </div>
          <div
            className="text-[12px] tabular-nums py-2 px-3 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] select-all tracking-[0.1em] break-all"
          >
            {state.secret}
          </div>
        </div>

        {/* Verify */}
        <form onSubmit={handleVerify} className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="mfa-verify-code"
              className="block text-[12px] font-medium text-[var(--muted)] mb-1.5"
            >
              Enter 6-digit code to confirm setup
            </label>
            <input
              id="mfa-verify-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              placeholder="000000"
              value={verifyCode}
              onChange={(e) =>
                setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="w-full py-[9px] px-[14px] text-[15px] tracking-[0.2em] text-center rounded-[12px] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] outline-none font-[inherit] box-border tabular-nums"
            />
          </div>

          {verifyError && (
            <p
              role="alert"
              className="text-[12px] leading-[1.5] text-[var(--bad)] m-0"
            >
              {verifyError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              className="le-btn-dark text-[12px] py-2 px-5"
              disabled={verifyCode.length !== 6 || verifying}
              style={
                verifyCode.length !== 6 || verifying ? { opacity: 0.6 } : undefined
              }
            >
              {verifying ? "Verifying…" : "Verify and enable"}
            </button>
            <button
              type="button"
              className="le-btn-ghost text-[12px] py-2 px-3.5"
              onClick={handleCancelEnroll}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (state.phase === "enabled") {
    return (
      <div className="grid grid-cols-[1fr_auto] gap-4 items-center pt-5 mt-1 border-t border-[var(--line-2)]">
        <div>
          <div className="text-[13.5px] font-medium text-[var(--ink)]">
            Two-factor authentication
          </div>
          <div className="text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]">
            Your account is protected with an authenticator app. You'll be prompted for a code on every sign-in.
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-[11px] font-semibold tracking-[0.02em] py-1 px-2.5 rounded-full bg-[rgba(47,138,85,0.10)] text-[var(--good)] uppercase">
            Enabled
          </span>
          <button
            type="button"
            className="le-btn-ghost text-[12px] py-1.5 px-3"
            onClick={handleDisable}
            disabled={disabling}
            style={
              disabling
                ? { opacity: 0.6, color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }
                : { color: "var(--bad)", borderColor: "rgba(196,74,74,0.25)" }
            }
          >
            {disabling ? "Disabling…" : "Disable 2FA"}
          </button>
        </div>
      </div>
    );
  }

  // phase === "idle" — not enrolled
  return (
    <div className="pt-5 mt-1 border-t border-[var(--line-2)]">
      {requireSetup && (
        <div
          role="alert"
          className="mb-4 py-2.5 px-3.5 rounded-[10px] text-[12px] leading-[1.5] bg-[rgba(196,74,74,0.07)] border border-[rgba(196,74,74,0.2)] text-[var(--bad)]"
        >
          Admins must enable 2FA to access the management dashboard. Set it up below.
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-4 items-center">
        <div>
          <div className="text-[13.5px] font-medium text-[var(--ink)]">
            Two-factor authentication
          </div>
          <div className="text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]">
            Add an authenticator app for an extra layer of security on sign-in.
          </div>
        </div>
        <button
          type="button"
          className="le-btn-ghost text-[12px] py-2 px-3.5"
          onClick={handleEnable}
        >
          Enable 2FA
        </button>
      </div>
    </div>
  );
}

// ─── AccountProfile ───────────────────────────────────────────────────────────

export default function AccountProfile() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mfaSetupRequired = searchParams.get("mfa_setup") === "1";
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
              Set a new password. At least 8 characters. You'll stay signed in here, but other devices keep their existing session unless you sign out everywhere below.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-5">
              <div>
                <label className={labelCls} htmlFor="new_password">New password</label>
                <input
                  id="new_password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="new-password"
                  className={inputCls}
                  value={password.next}
                  onChange={(e) => setPassword({ ...password, next: e.target.value })}
                  placeholder="••••••••"
                />
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
                disabled={savingPassword || !password.next || !password.confirm}
                style={savingPassword || !password.next || !password.confirm ? { opacity: 0.6 } : undefined}
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
            <p className={hintCls}>
              Brokerage and brand settings are tenant-side and live with each agent's profile, not the owner account. Workspace-level controls live in{" "}
              <a href="/dashboard/settings" className="text-[var(--accent)] no-underline">Settings</a>.
            </p>

            {/* Two-factor authentication enrollment / management */}
            <MfaEnrollSection requireSetup={mfaSetupRequired} />

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
