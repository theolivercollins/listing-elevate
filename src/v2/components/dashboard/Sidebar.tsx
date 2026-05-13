import { useState, useEffect } from "react";
import {
  LayoutGrid, Package, Users, Building2, DollarSign, Wrench, Code2,
  GitBranch, ListChecks, ChevronLeft, Beaker, BookOpen, MapPin, Activity, Newspaper,
} from "lucide-react";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { useTheme } from "@/lib/theme";
import { SidebarItem } from "./SidebarItem";
import { SidebarDropdown } from "./SidebarDropdown";

const COLLAPSED_KEY = "le.dashboard.sidebarCollapsed";

export function Sidebar() {
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      className="flex h-screen flex-col border-r"
      style={{
        width: collapsed ? 64 : 240,
        background: "var(--le-bg)",
        borderColor: "var(--le-border)",
        transition: "width 200ms ease",
      }}
    >
      <div className="flex h-14 items-center px-4">
        <LELogoMark size={26} variant={theme === "dark" ? "light" : "dark"} />
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pt-2">
        <div className="flex flex-col gap-0.5">
          <SidebarItem to="/dashboard" label="Overview" icon={LayoutGrid} collapsed={collapsed} end />
          <SidebarDropdown label="Orders" icon={Package} pathPrefix="/dashboard/orders" collapsed={collapsed}>
            <SidebarItem to="/dashboard/orders/pipeline" label="Pipeline" icon={GitBranch} collapsed={collapsed} />
            <SidebarItem to="/dashboard/orders" label="Orders" icon={ListChecks} collapsed={collapsed} end />
          </SidebarDropdown>
          <SidebarItem to="/dashboard/users" label="Users" icon={Users} collapsed={collapsed} />
          <SidebarItem to="/dashboard/listings" label="Listings" icon={Building2} collapsed={collapsed} />
          <SidebarItem to="/dashboard/finances" label="Finances" icon={DollarSign} collapsed={collapsed} />
          <SidebarDropdown label="Tools" icon={Wrench} pathPrefix="/dashboard/tools" collapsed={collapsed}>
            <SidebarItem to="/dashboard/tools/blog" label="Blog" icon={Newspaper} collapsed={collapsed} />
          </SidebarDropdown>
          <SidebarDropdown label="Dev" icon={Code2} pathPrefix="/dashboard/dev" collapsed={collapsed}>
            <SidebarItem to="/dashboard/dev" label="Overview" icon={LayoutGrid} collapsed={collapsed} end />
            <SidebarItem to="/dashboard/dev/prompt-lab" label="Prompt Lab" icon={Beaker} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/recipes" label="Recipes" icon={BookOpen} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/knowledge-map" label="Knowledge Map" icon={MapPin} collapsed={collapsed} />
            <SidebarItem to="/dashboard/dev/system-status" label="System Status" icon={Activity} collapsed={collapsed} />
          </SidebarDropdown>
        </div>
      </nav>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="m-2 flex h-8 items-center justify-center rounded-[8px] border text-[color:var(--le-text-muted)] hover:bg-[color:var(--le-bg-sunken)]"
        style={{ borderColor: "var(--le-border)" }}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <ChevronLeft
          className="h-4 w-4 transition-transform"
          strokeWidth={1.6}
          style={{ transform: collapsed ? "rotate(180deg)" : undefined }}
        />
      </button>
    </aside>
  );
}
