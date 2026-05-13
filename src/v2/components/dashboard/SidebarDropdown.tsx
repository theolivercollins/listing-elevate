import { useState, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";

export function SidebarDropdown({
  label,
  icon: Icon,
  pathPrefix,
  collapsed,
  children,
}: {
  label: string;
  icon: LucideIcon;
  pathPrefix: string; // e.g. "/dashboard/orders"
  collapsed: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  const isActive = location.pathname.startsWith(pathPrefix);
  const [open, setOpen] = useState(isActive);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? label : undefined}
        className={`group flex h-9 w-full items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "text-[color:var(--le-text)]"
            : "text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)] hover:text-[color:var(--le-text)]"
        }`}
        aria-expanded={open}
      >
        <Icon className="h-4 w-4 flex-none" strokeWidth={1.6} />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left">{label}</span>
            <ChevronRight
              className="h-3.5 w-3.5 transition-transform"
              strokeWidth={1.6}
              style={{ transform: open ? "rotate(90deg)" : undefined }}
            />
          </>
        )}
      </button>
      {!collapsed && open && <div className="ml-7 mt-1 flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}
