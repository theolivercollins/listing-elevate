import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Card, SectionTitle } from "@/components/dashboard/primitives";

// Deliberately does NOT import "@/lib/supabase" — this card only talks to
// Supabase through the AuthProvider's listIdentities/linkIdentity/
// unlinkIdentity methods. Keeping the real supabase-js client out of this
// file's import graph is what makes it safe to render in RTL tests (see
// ConnectedAccountsCard.test.tsx); Profile.tsx itself imports the real
// client directly and is source-tested only, to avoid a happy-dom OOM.

const hintCls = "text-[12px] text-[var(--muted)] mt-1.5 leading-[1.5]";

const disconnectBtnStyle = {
  color: "var(--bad)",
  borderColor: "rgba(196,74,74,0.25)",
} as const;

const PROVIDER_LABELS: Record<string, string> = {
  email: "Email",
  google: "Google",
  azure: "Microsoft",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

const LINKABLE_PROVIDERS: { id: "google"; label: string }[] = [
  { id: "google", label: "Google" },
];

/**
 * "Connected accounts" card — lists the Supabase identities linked to this
 * user (email + any linked OAuth providers) and lets them connect/disconnect
 * Google. Supabase refuses server-side to unlink the last identity on an
 * account; the UI mirrors that as a disabled-button guard so it never
 * dangles an offer it can't honor.
 */
export function ConnectedAccountsCard() {
  const { listIdentities, linkIdentity, unlinkIdentity } = useAuth();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkingProvider, setLinkingProvider] = useState<"google" | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  async function load() {
    try {
      const list = await listIdentities();
      setIdentities(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load connected accounts");
    }
  }

  useEffect(() => {
    load();
    // Runs once on mount only — `load` is stable in behavior across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lockout guard: Supabase enforces this server-side too, but the UI never
  // offers to unlink the account's only remaining sign-in method.
  const isLastIdentity = (identities?.length ?? 0) <= 1;

  async function handleConnect(provider: "google") {
    setLinkingProvider(provider);
    try {
      await linkIdentity(provider);
    } catch {
      toast.error("Couldn't start linking — this provider may not be enabled yet");
    } finally {
      setLinkingProvider(null);
    }
  }

  async function handleDisconnect(identity: UserIdentity) {
    setUnlinkingId(identity.identity_id);
    try {
      await unlinkIdentity(identity);
      toast.success("Disconnected");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setUnlinkingId(null);
    }
  }

  const linkedProviders = new Set((identities ?? []).map((i) => i.provider));
  const connectable = LINKABLE_PROVIDERS.filter((p) => !linkedProviders.has(p.id));

  return (
    <Card padding={24}>
      <SectionTitle title="Connected accounts" />
      <p className={hintCls}>
        Sign in faster by connecting Google. You can use any connected account to log in.
      </p>

      {identities === null && !loadError && (
        <div className="pt-5 mt-1 border-t border-[var(--line-2)] text-[13px] text-[var(--muted)]">
          Loading connected accounts...
        </div>
      )}

      {loadError && (
        <div className="pt-5 mt-1 border-t border-[var(--line-2)] text-[13px] text-[var(--bad)]">
          Couldn't load connected accounts. {loadError}
        </div>
      )}

      {identities && identities.length === 0 && !loadError && (
        <div className="pt-5 mt-1 border-t border-[var(--line-2)] text-[13px] text-[var(--muted)]">
          No connected accounts found.
        </div>
      )}

      {identities?.map((identity) => {
        const isEmail = identity.provider === "email";
        const handle = identity.identity_data?.email;
        const disabled = isLastIdentity || unlinkingId === identity.identity_id;
        return (
          <div
            key={identity.identity_id}
            className="grid grid-cols-[1fr_auto] gap-4 items-center pt-5 mt-1 border-t border-[var(--line-2)]"
          >
            <div>
              <div className="text-[13.5px] font-medium text-[var(--ink)]">
                {providerLabel(identity.provider)}
              </div>
              {handle ? <div className={hintCls}>{handle}</div> : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold tracking-[0.02em] py-1 px-2.5 rounded-full bg-[rgba(47,138,85,0.10)] text-[var(--good)] uppercase">
                Connected
              </span>
              {!isEmail && (
                <button
                  type="button"
                  className="le-btn-ghost text-[12px] py-1.5 px-3"
                  onClick={() => handleDisconnect(identity)}
                  disabled={disabled}
                  title={isLastIdentity ? "You can't remove your only sign-in method." : undefined}
                  style={
                    disabled
                      ? { ...disconnectBtnStyle, opacity: 0.6 }
                      : disconnectBtnStyle
                  }
                >
                  {unlinkingId === identity.identity_id ? "Disconnecting..." : "Disconnect"}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {connectable.length > 0 && (
        <div className="pt-5 mt-1 border-t border-[var(--line-2)] flex items-center gap-3 flex-wrap">
          {connectable.map((p) => (
            <button
              key={p.id}
              type="button"
              className="le-btn-dark text-[12px] py-2 px-3.5"
              onClick={() => handleConnect(p.id)}
              disabled={linkingProvider === p.id}
              style={linkingProvider === p.id ? { opacity: 0.6 } : undefined}
            >
              {linkingProvider === p.id ? "Redirecting..." : `Connect ${p.label}`}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
