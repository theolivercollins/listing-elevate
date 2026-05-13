import { Outlet } from "react-router-dom";
import { isDashboardV3Enabled } from "@/lib/featureFlags";
import { DashboardShell } from "@/v2/components/dashboard/DashboardShell";
import "@/v2/styles/v2.css";

/**
 * Dashboard shell.
 *
 * Behind VITE_LE_DASHBOARD_V3 flag:
 *   - ON  → renders the new vertical-sidebar DashboardShell.
 *   - OFF → renders the legacy max-w container (current behaviour).
 *
 * TopNav.tsx separately early-returns on /dashboard/* when the flag is ON,
 * so the new shell doesn't double-mount nav.
 */
const Dashboard = () => {
  if (isDashboardV3Enabled()) {
    return <DashboardShell />;
  }
  return (
    <div
      className="le-root"
      style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}
    >
      <main className="mx-auto w-full max-w-[1440px] px-8 py-12 md:px-12 md:py-16">
        <Outlet />
      </main>
    </div>
  );
};

export default Dashboard;
