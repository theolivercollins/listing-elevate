import { Link, Outlet, useLocation } from "react-router-dom";
import { Activity, ArrowUpRight, Gauge, Sparkles } from "lucide-react";
import "@/v2/styles/v2.css";

const routeLabels: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/pipeline": "Pipeline",
  "/dashboard/properties": "Listings",
  "/dashboard/logs": "Logs",
  "/dashboard/finances": "Finances",
  "/dashboard/settings": "Settings",
  "/dashboard/development": "Development",
  "/dashboard/development/prompt-lab": "Prompt Lab",
  "/dashboard/development/prompt-lab/recipes": "Recipes",
  "/dashboard/development/proposals": "Proposals",
  "/dashboard/development/knowledge-map": "Knowledge Map",
  "/dashboard/development/system-status": "System Status",
  "/dashboard/development/lab": "Lab",
  "/dashboard/rating-ledger": "Rating Ledger",
  "/dashboard/blog/posts": "Blog Posts",
  "/dashboard/blog/images": "Image Library",
  "/dashboard/blog/templates": "Templates",
};

function getRouteLabel(pathname: string) {
  const direct = routeLabels[pathname];
  if (direct) return direct;
  if (pathname.startsWith("/dashboard/properties/")) return "Listing Detail";
  if (pathname.startsWith("/dashboard/blog/posts/")) return "Post Editor";
  if (pathname.startsWith("/dashboard/blog/templates/")) return "Template Editor";
  if (pathname.startsWith("/dashboard/development/lab/")) return "Lab Listing";
  if (pathname.startsWith("/dashboard/development/knowledge-map/")) return "Knowledge Cell";
  return "Studio";
}

const Dashboard = () => {
  const location = useLocation();
  const routeLabel = getRouteLabel(location.pathname);

  return (
    <div className="le-root dark relative min-h-screen overflow-hidden bg-[#050710] text-white" data-theme="dark">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.10),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(99,122,255,0.12),transparent_30%),linear-gradient(180deg,#050710_0%,#03040b_62%,#020207_100%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="absolute left-0 top-0 h-full w-px bg-gradient-to-b from-white/20 via-white/5 to-transparent" />
        <div className="absolute inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:64px_64px]" />
      </div>

      <div className="mx-auto grid w-full max-w-[1540px] grid-cols-1 px-4 py-5 sm:px-6 md:px-8 lg:grid-cols-[72px_minmax(0,1fr)] lg:gap-6 lg:py-8 xl:px-10">
        <aside className="sticky top-24 hidden h-[calc(100vh-8rem)] flex-col justify-between border border-white/10 bg-white/[0.035] p-3 backdrop-blur-xl lg:flex">
          <div className="space-y-3">
            <div className="flex h-11 w-11 items-center justify-center border border-white/10 bg-white/[0.04]">
              <Gauge className="h-4 w-4 text-white/70" strokeWidth={1.5} />
            </div>
            <div className="h-px bg-white/10" />
            <div className="flex h-11 w-11 items-center justify-center border border-white/10 bg-white/[0.025]">
              <Activity className="h-4 w-4 text-white/55" strokeWidth={1.5} />
            </div>
          </div>
          <Link
            to="/upload"
            className="flex h-11 w-11 items-center justify-center border border-white/10 bg-white text-[#050710] transition duration-300 hover:bg-white/85"
            aria-label="New video"
          >
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.7} />
          </Link>
        </aside>

        <main className="min-w-0">
          <section className="mb-6 border border-white/10 bg-white/[0.035] p-4 shadow-[0_24px_80px_rgba(0,0,0,.28)] backdrop-blur-xl sm:p-5 lg:mb-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="label text-white/40">Listing Elevate / Studio</div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 w-2 bg-white" />
                  <p className="truncate text-sm font-medium tracking-[-0.01em] text-white">{routeLabel}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-px overflow-hidden border border-white/10 bg-white/10 text-center sm:min-w-[380px]">
                <div className="bg-[#070914]/95 px-3 py-3">
                  <p className="label text-white/35">Mode</p>
                  <p className="mt-1 text-xs font-medium text-white">Admin</p>
                </div>
                <div className="bg-[#070914]/95 px-3 py-3">
                  <p className="label text-white/35">System</p>
                  <p className="mt-1 text-xs font-medium text-white">Live</p>
                </div>
                <div className="bg-[#070914]/95 px-3 py-3">
                  <p className="label text-white/35">Style</p>
                  <p className="mt-1 inline-flex items-center justify-center gap-1 text-xs font-medium text-white">
                    <Sparkles className="h-3 w-3" strokeWidth={1.6} /> Modo
                  </p>
                </div>
              </div>
            </div>
          </section>

          <div className="min-w-0 pb-16">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
