import { useState } from "react";
import { PageHeading, KpiCard, Card } from "@/components/dashboard/primitives";
import { Icon } from "@/components/dashboard/icons";
import { SAMPLE_USERS } from "@/components/dashboard/sample-data";

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
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 8px",
        borderRadius: 999,
        background: s.bg,
        color: s.color,
        fontSize: 11.5,
        fontWeight: 500,
        width: "fit-content",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: "currentColor",
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
}

// ─── tab types ────────────────────────────────────────────────────
type TabId = "all" | "active" | "pending" | "admins";

// ─── role definitions ─────────────────────────────────────────────
const ROLES = [
  {
    role: "Admin",
    count: 1,
    perms: [
      "Full workspace access",
      "Billing & plan",
      "Invite & remove users",
      "Production deploys",
    ],
  },
  {
    role: "Agent",
    count: 5,
    perms: [
      "Upload listings",
      "View own analytics",
      "Request reviews",
    ],
  },
  {
    role: "Reviewer / Dev",
    count: 2,
    perms: [
      "Manual QC review",
      "Pipeline + logs",
      "Prompt lab access",
    ],
  },
] as const;

// ─── Users page ───────────────────────────────────────────────────
export default function Users() {
  const [tab, setTab] = useState<TabId>("all");

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "all",     label: "All",     count: SAMPLE_USERS.length },
    { id: "active",  label: "Active",  count: SAMPLE_USERS.filter((u) => u.status === "active").length },
    { id: "pending", label: "Pending", count: SAMPLE_USERS.filter((u) => u.status === "pending" || u.status === "invited").length },
    { id: "admins",  label: "Admins",  count: SAMPLE_USERS.filter((u) => u.role === "Admin").length },
  ];

  const filtered = SAMPLE_USERS.filter((u) => {
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
            <button className="le-btn-dark">
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
        <KpiCard label="Total users"     value="8"  sub="across 3 roles"       delta={null} />
        <KpiCard label="Active · 7d"     value="6"  sub="75% engagement"        delta={12.4} />
        <KpiCard label="Pending invites" value="2"  sub="awaiting acceptance"   delta={null} />
        <KpiCard label="Seats available" value="12" sub="of 20 in plan"         delta={null} />
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
          <div
            style={{
              display: "inline-flex",
              padding: 4,
              background: "rgba(11,11,16,0.04)",
              borderRadius: 999,
            }}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: "none",
                  background: tab === t.id ? "var(--ink)" : "transparent",
                  color: tab === t.id ? "#fff" : "var(--muted)",
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {t.label}
                <span
                  style={{
                    fontSize: 10.5,
                    padding: "1px 6px",
                    borderRadius: 99,
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
              borderRadius: 10,
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
        {filtered.map((u) => (
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
                  borderRadius: 99,
                  flexShrink: 0,
                  background: `linear-gradient(135deg, hsl(${u.hue}, 12%, 60%), hsl(${u.hue + 30}, 14%, 42%))`,
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
                  .join("")}
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
              {u.listings || "—"}
            </span>

            {/* Last active */}
            <span style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{u.last}</span>

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
        ))}
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
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "var(--muted)",
                  padding: "3px 9px",
                  borderRadius: 99,
                  background: "rgba(11,11,16,0.05)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {r.count} {r.count === 1 ? "user" : "users"}
              </span>
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
    </div>
  );
}
