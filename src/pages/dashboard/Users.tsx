import { useState, useEffect } from "react";
import { PageHeading, KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { toast } from "sonner";
import { inviteUser } from "@/lib/api";

// ─── User shape ───────────────────────────────────────────────────
interface User {
  id?: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "pending" | "invited";
  last_active_at?: string | null;
  listings?: number;
  hue?: number;
}

// ─── UserStatus pill ─────────────────────────────────────────────
type UserStatusValue = "active" | "pending" | "invited";

interface UserStatusConfig {
  label: string;
  color: string;
  bg: string;
}

const USER_STATUS_MAP: Record<UserStatusValue, UserStatusConfig> = {
  active:  { label: "Active",  color: "var(--good)",  bg: "rgba(47,138,85,0.10)" },
  pending: { label: "Pending", color: "var(--warn)",  bg: "rgba(182,128,44,0.10)" },
  invited: { label: "Invited", color: "var(--muted)", bg: "rgba(11,11,16,0.05)" },
};

function UserStatusPill({ status }: { status: UserStatusValue }) {
  const s = USER_STATUS_MAP[status] ?? USER_STATUS_MAP.invited;
  return (
    <span
      className="le-status-pill"
      style={{ background: s.bg, color: s.color, width: "fit-content" }}
    >
      <span className="le-status-dot" />
      {s.label}
    </span>
  );
}

// ─── tab types ────────────────────────────────────────────────────
type TabId = "all" | "active" | "pending" | "admins";

// ─── role definitions (static — these are permission docs, not counts) ──
const ROLES = [
  {
    role: "Admin",
    perms: [
      "Full workspace access",
      "Billing & plan",
      "Invite & remove users",
      "Production deploys",
    ],
  },
  {
    role: "Agent",
    perms: [
      "Upload listings",
      "View own analytics",
      "Request reviews",
    ],
  },
  {
    role: "Reviewer / Dev",
    perms: [
      "Manual QC review",
      "Pipeline + logs",
      "Prompt lab access",
    ],
  },
] as const;

// ─── derive a hue from email (deterministic) ───────────────────────
function emailHue(email: string): number {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) & 0xffff;
  return h % 360;
}

// ─── map raw API row to User shape ────────────────────────────────
function toUser(raw: Record<string, unknown>): User {
  const status = (raw.status as string | undefined) ?? "active";
  const normalizedStatus: UserStatusValue =
    status === "pending" || status === "invited" ? status : "active";
  const email = String(raw.email ?? "");
  return {
    id: raw.id ? String(raw.id) : undefined,
    name: String(raw.name ?? raw.full_name ?? raw.email ?? "Unknown"),
    email,
    role: String(raw.role ?? "Agent"),
    status: normalizedStatus,
    last_active_at: raw.last_active_at ? String(raw.last_active_at) : null,
    listings: typeof raw.listings === "number" ? raw.listings : undefined,
    hue: emailHue(email),
  };
}

function fmtLastActive(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Users page ───────────────────────────────────────────────────
export default function Users() {
  const [tab, setTab] = useState<TabId>("all");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/users", { credentials: "include" });
        if (!res.ok) throw new Error("non-ok");
        const data = await res.json() as unknown;
        if (cancelled) return;
        const arr: Record<string, unknown>[] = Array.isArray(data)
          ? (data as Record<string, unknown>[])
          : Array.isArray((data as Record<string, unknown[]>).users)
            ? ((data as Record<string, unknown[]>).users as Record<string, unknown>[])
            : [];
        setUsers(arr.map(toUser));
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="le-fade-up" style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  // ─── KPI values ─────────────────────────────────────────────────
  const totalUsers = users.length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeRecently = users.filter(
    (u) => u.last_active_at && new Date(u.last_active_at).getTime() > sevenDaysAgo,
  ).length;
  const hasLastActive = users.some((u) => u.last_active_at);
  const pendingInvites = users.filter(
    (u) => u.status === "pending" || u.status === "invited",
  ).length;

  // ─── tab filter ──────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "all",     label: "All",     count: users.length },
    { id: "active",  label: "Active",  count: users.filter((u) => u.status === "active").length },
    { id: "pending", label: "Pending", count: users.filter((u) => u.status === "pending" || u.status === "invited").length },
    { id: "admins",  label: "Admins",  count: users.filter((u) => u.role === "Admin").length },
  ];

  const filtered = users.filter((u) => {
    if (tab === "all")     return true;
    if (tab === "active")  return u.status === "active";
    if (tab === "pending") return u.status === "pending" || u.status === "invited";
    if (tab === "admins")  return u.role === "Admin";
    return true;
  });

  return (
    <div className="le-fade-up">
      <PageHeading
        eyebrow="Workspace · Recasi"
        title="Users"
        sub="Manage workspace access, roles, and review permissions. Invite new agents, developers, and reviewers."
        actions={
          <>
            <button className="le-btn-ghost">
              <Icon name="upload" size={13} />
              Export
            </button>
            <button className="le-btn-dark" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={13} />
              Invite user
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <KpiCard
          label="Total users"
          value={totalUsers === 0 ? "0" : String(totalUsers)}
          sub={totalUsers === 0 ? "no users yet" : "across all roles"}
          delta={null}
        />
        <KpiCard
          label="Active · 7d"
          value={hasLastActive ? String(activeRecently) : "—"}
          sub={hasLastActive ? "active in last 7 days" : "no last-active data"}
          delta={null}
        />
        <KpiCard
          label="Pending invites"
          value={String(pendingInvites)}
          sub={pendingInvites === 0 ? "none pending" : "awaiting acceptance"}
          delta={null}
        />
        <KpiCard
          label="Seats available"
          value="—"
          sub="no plan source yet"
          delta={null}
        />
      </section>

      {/* Users table card */}
      <Card padding={20}>
        {/* Tabs + search row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          {/* Segmented tabs */}
          <div className="le-seg">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`le-seg-item${tab === t.id ? " is-active" : ""}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {t.label}
                <span
                  style={{
                    fontSize: 10.5,
                    padding: "1px 6px",
                    borderRadius: "var(--le-r-pill)",
                    background: tab === t.id ? "rgba(255,255,255,0.18)" : "rgba(11,11,16,0.06)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Search field */}
          <div
            className="le-card-flat"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: "var(--le-r-md)",
              minWidth: 220,
            }}
          >
            <Icon name="search" size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            <input
              placeholder="Filter users…"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 12.5,
                color: "var(--ink-2)",
              }}
            />
          </div>
        </div>

        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 32px",
            gap: 16,
            padding: "10px 14px",
            borderBottom: "1px solid var(--line-2)",
          }}
        >
          <span className="le-d-label" style={{ fontSize: 11.5 }}>User</span>
          <span className="le-d-label" style={{ fontSize: 11.5 }}>Role</span>
          <span className="le-d-label" style={{ fontSize: 11.5 }}>Status</span>
          <span className="le-d-label" style={{ fontSize: 11.5, textAlign: "right" }}>Listings</span>
          <span className="le-d-label" style={{ fontSize: 11.5, textAlign: "right" }}>Last active</span>
          <span />
        </div>

        {/* Table body */}
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {users.length === 0
              ? (
                <>
                  No users yet. Invite your first teammate to get started.
                  <div style={{ marginTop: 16 }}>
                    <button className="le-btn-dark" style={{ fontSize: 12, padding: "8px 18px" }} onClick={() => setInviteOpen(true)}>
                      <Icon name="plus" size={13} />
                      Invite user
                    </button>
                  </div>
                </>
              )
              : "No users match this filter."}
          </div>
        ) : (
          filtered.map((u) => (
            <div
              key={u.email}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 32px",
                gap: 16,
                padding: "14px 14px",
                borderBottom: "1px solid var(--line-2)",
                alignItems: "center",
                transition: "background .15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(11,11,16,0.02)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {/* User cell */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: `linear-gradient(135deg, hsl(${u.hue ?? 200}, 12%, 60%), hsl(${(u.hue ?? 200) + 30}, 14%, 42%))`,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 12,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {u.name
                    .split(" ")
                    .map((s) => s[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{u.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{u.email}</div>
                </div>
              </div>

              {/* Role */}
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{u.role}</span>

              {/* Status */}
              <UserStatusPill status={u.status} />

              {/* Listings */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--ink)",
                }}
              >
                {u.listings != null ? String(u.listings) : "—"}
              </span>

              {/* Last active */}
              <span
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtLastActive(u.last_active_at)}
              </span>

              {/* Dots menu */}
              <button
                type="button"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted-2)",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  padding: 0,
                }}
              >
                <Icon name="dots" size={14} />
              </button>
            </div>
          ))
        )}
      </Card>

      {/* Roles & permissions cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginTop: 16,
        }}
      >
        {ROLES.map((r) => (
          <Card key={r.role} padding={20}>
            {/* Card header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <span className="le-d-label" style={{ fontSize: 12 }}>Role</span>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.018em",
                    marginTop: 4,
                    color: "var(--ink)",
                  }}
                >
                  {r.role}
                </div>
              </div>
              {users.length > 0 && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--muted)",
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: "rgba(11,11,16,0.05)",
                    fontVariantNumeric: "tabular-nums",
                    flexShrink: 0,
                  }}
                >
                  {(() => {
                    const c = users.filter((u) => u.role === r.role).length;
                    return `${c} ${c === 1 ? "user" : "users"}`;
                  })()}
                </span>
              )}
            </div>

            {/* Permissions list */}
            <ul
              style={{
                margin: "16px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {r.perms.map((p) => (
                <li
                  key={p}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    color: "var(--ink-2)",
                  }}
                >
                  <Icon name="check" size={13} style={{ color: "var(--good)", flexShrink: 0 }} />
                  {p}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>

      {inviteOpen && (
        <InviteUserDialog
          onClose={() => setInviteOpen(false)}
          onInvited={(email) => {
            setUsers((prev) => [
              ...prev,
              {
                name: email.split("@")[0],
                email,
                role: "Member",
                status: "invited",
                last_active_at: null,
              },
            ]);
            setInviteOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── InviteUserDialog ────────────────────────────────────────────
function InviteUserDialog({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    setSubmitting(true);
    try {
      await inviteUser(email.trim());
      toast.success(`Invite sent to ${email.trim()}`);
      onInvited(email.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11,11,16,0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface)",
          borderRadius: "var(--le-r-xl)",
          padding: 24,
          width: "100%",
          maxWidth: 440,
          boxShadow: "var(--le-shadow-lg)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>Invite teammate</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            They'll receive an email with a secure sign-up link to /dashboard.
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Email</span>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            style={{
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--le-r-md)",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="le-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="le-btn-dark" disabled={submitting || !email.trim()}>
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </div>
  );
}
