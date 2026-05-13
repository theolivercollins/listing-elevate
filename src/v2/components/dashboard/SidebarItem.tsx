import type { LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

export function SidebarItem({
  to,
  label,
  icon: Icon,
  collapsed,
  end = false,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `group flex h-9 items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-[color:var(--le-accent)] text-[color:var(--le-accent-fg)]"
            : "text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)] hover:text-[color:var(--le-text)]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-4 w-4 flex-none" strokeWidth={1.6} />
          {!collapsed && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}
