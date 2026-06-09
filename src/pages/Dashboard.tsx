import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import "@/v2/styles/v2.css";
import { DashboardSidebar, useDashboardSidebar } from "@/components/DashboardSidebar";
import { Icon } from "@/components/dashboard/icons";
import { useMediaQuery } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";

function useAuthGuard() {
  return useAuth();
}

const Dashboard = () => {
  const [collapsed, setCollapsed] = useDashboardSidebar();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const location = useLocation();
  useAuthGuard();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <div
      className={`le-root le-dash-shell${collapsed ? " is-collapsed" : ""}${
        drawerOpen ? " is-drawer-open" : ""
      }`}
    >
      {/* On mobile the drawer always shows the expanded sidebar (labels). */}
      <DashboardSidebar
        collapsed={isMobile ? false : collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
      />
      <div
        className="le-dash-backdrop"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div className="le-dash-main">
        <div className="le-dash-mobilebar">
          <button
            type="button"
            className="le-dash-hamburger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={20} strokeWidth={1.8} />
          </button>
          <Link to="/dashboard" className="le-dash-mobilebar-brand">
            <Icon name="logo" size={22} />
            Listing Elevate
          </Link>
        </div>
        <main className="le-main-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

export { Link };
