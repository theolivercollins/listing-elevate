import { Outlet } from "react-router-dom";
import "@/v2/styles/v2.css";

/**
 * Dashboard shell — the sub-nav now lives in TopNav so this is just a
 * container for the current route's <Outlet />.
 */
const Dashboard = () => {
  return (
    <div
      className="le-root"
      style={{
        minHeight: "100vh",
        background: "var(--le-surface-page)",
        color: "var(--le-text)",
        fontFamily: "var(--le-font-sans)",
      }}
    >
      <main className="mx-auto w-full max-w-[1440px] px-6 py-10 md:px-10 md:py-12">
        <Outlet />
      </main>
    </div>
  );
};

export default Dashboard;
