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
      style={{ minHeight: "100vh", background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}
    >
      <main className="mx-auto w-full max-w-[1440px] px-8 py-12 md:px-12 md:py-16">
        <Outlet />
      </main>
    </div>
  );
};

export default Dashboard;
