import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import "@/v2/styles/v2.css";

export function DashboardShell() {
  return (
    <div
      className="le-root flex min-h-screen"
      style={{ background: "var(--le-bg)", color: "var(--le-text)", fontFamily: "var(--le-font-sans)" }}
    >
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
