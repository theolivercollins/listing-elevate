import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchAdminUsers } from "@/lib/api";
import type { AdminUserRow } from "@/lib/types";
import "@/v2/styles/v2.css";

function formatUSD(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ROLE_OPTIONS = ["all", "admin", "user"];

export default function Users() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchAdminUsers,
  });

  const filtered = useMemo<AdminUserRow[]>(() => {
    const rows = data?.users ?? [];
    return rows.filter((u) => {
      if (role !== "all" && u.role !== role) return false;
      if (search && !u.email.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [data, role, search]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="le-eyebrow" style={{ color: "var(--le-text-muted)" }}>Admin</div>
          <h2 className="le-display mt-1 text-[28px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
            Users
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-[8px] border px-3 text-sm"
            style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", color: "var(--le-text)" }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 rounded-[8px] border px-3 text-sm"
            style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", color: "var(--le-text)" }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === "all" ? "All roles" : r}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="rounded-[14px] border"
        style={{ background: "var(--le-bg-elev)", borderColor: "var(--le-border)", boxShadow: "var(--le-shadow-md)" }}
      >
        {isLoading ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm" style={{ color: "var(--le-text-muted)" }}>
            No users match the current filter.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--le-text-muted)" }}>
                <th className="le-eyebrow px-6 py-3 text-left font-medium">Email</th>
                <th className="le-eyebrow px-6 py-3 text-left font-medium">Role</th>
                <th className="le-eyebrow px-6 py-3 text-right font-medium">Listings</th>
                <th className="le-eyebrow px-6 py-3 text-right font-medium">Total spend</th>
                <th className="le-eyebrow px-6 py-3 text-right font-medium">Joined</th>
                <th className="le-eyebrow px-6 py-3 text-right font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t" style={{ borderColor: "var(--le-border)" }}>
                  <td className="px-6 py-3" style={{ color: "var(--le-text)" }}>
                    <Link to={`/dashboard/users/${u.id}`} className="font-medium">{u.email}</Link>
                  </td>
                  <td className="px-6 py-3" style={{ color: "var(--le-text-muted)" }}>{u.role}</td>
                  <td className="le-mono px-6 py-3 text-right" style={{ color: "var(--le-text)" }}>{u.property_count}</td>
                  <td className="le-mono px-6 py-3 text-right" style={{ color: "var(--le-text)" }}>{formatUSD(u.total_spend_cents)}</td>
                  <td className="px-6 py-3 text-right text-xs" style={{ color: "var(--le-text-muted)" }}>{formatRelative(u.created_at)}</td>
                  <td className="px-6 py-3 text-right text-xs" style={{ color: "var(--le-text-muted)" }}>{formatRelative(u.last_active_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
