import { useState } from "react";
import { useAuth, IMPERSONATABLE_ROLES } from "@/lib/auth";
import { Icon } from "@/components/dashboard/icons";

/**
 * ImpersonationBanner — slim sticky strip shown for the duration of an
 * active admin role-preview session.
 *
 * Mounted at the dashboard shell root (src/pages/Dashboard.tsx), outside
 * any admin-gated subtree, so it stays reachable even while previewing as
 * "user" (which swaps the sidebar to the agent nav and hides admin chrome).
 */
export function ImpersonationBanner() {
  const { isImpersonating, profile, setImpersonatedRole } = useAuth();
  const [exiting, setExiting] = useState(false);

  if (!isImpersonating) return null;

  const activeLabel =
    IMPERSONATABLE_ROLES.find((r) => r.value === profile?.role)?.label ??
    profile?.role ??
    "Agent";

  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      await setImpersonatedRole(null);
    } catch {
      /* best-effort — setImpersonatedRole(null) always clears local state */
    } finally {
      setExiting(false);
    }
  };

  return (
    <div
      role="status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 22,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 20px",
        background: "var(--warn-soft)",
        borderBottom: "1px solid var(--warn)",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ink)",
        }}
      >
        <Icon name="alert" size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
        Previewing as <strong style={{ fontWeight: 600 }}>{activeLabel}</strong>
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: "var(--le-r-md)",
          border: "1px solid var(--warn)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontFamily: "var(--le-font-sans)",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: exiting ? "default" : "pointer",
          opacity: exiting ? 0.6 : 1,
          transition: "background .12s",
        }}
      >
        {exiting ? "Exiting…" : "Exit preview"}
      </button>
    </div>
  );
}
