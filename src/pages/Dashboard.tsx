import { Outlet, Link } from "react-router-dom";
import "@/v2/styles/v2.css";
import { DashboardSidebar, useDashboardSidebar } from "@/components/DashboardSidebar";
import { useAuth } from "@/lib/auth";

function useAuthGuard() {
  return useAuth();
}

const Dashboard = () => {
  const [collapsed, setCollapsed] = useDashboardSidebar();
  useAuthGuard();
  return (
    <div className={`le-root le-dash-shell${collapsed ? " is-collapsed" : ""}`}>
      <DashboardSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} />
      <div className="le-dash-main">
        <main className="le-main-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Dashboard;

export { Link };
