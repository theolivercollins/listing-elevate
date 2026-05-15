import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Command,
  LayoutGrid,
  Search,
  Sparkles,
} from "lucide-react";
import "@/v2/styles/v2.css";

const routeLabels: Record<string, string> = {
  "/dashboard": "Realtime Overview",
  "/dashboard/pipeline": "Production Pipeline",
  "/dashboard/properties": "Listings",
  "/dashboard/logs": "Activity Logs",
  "/dashboard/finances": "Finance Studio",
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

const railItems = [
  { icon: LayoutGrid, label: "Overview", active: true },
  { icon: Activity, label: "Pipeline" },
  { icon: BarChart3, label: "Analytics" },
  { icon: CircleDollarSign, label: "Finance" },
  { icon: CalendarDays, label: "Calendar" },
];

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
    <div className="le-root le-dashboard-light min-h-screen overflow-hidden bg-[#e9edf2] text-[#17191d]" data-theme="light">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,255,255,.95),transparent_32%),radial-gradient(circle_at_88%_12%,rgba(178,220,255,.52),transparent_30%),linear-gradient(135deg,#f8faf8_0%,#edf1f4_46%,#dfe5ea_100%)]" />
        <div className="absolute inset-0 opacity-[0.36] [background-image:linear-gradient(rgba(255,255,255,.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.85)_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>

      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 gap-4 px-3 py-3 sm:px-5 sm:py-5 lg:grid-cols-[72px_minmax(0,1fr)] lg:gap-5 xl:px-8">
        <aside className="hidden min-h-[calc(100vh-2.5rem)] flex-col justify-between rounded-[30px] border border-white/70 bg-white/58 p-3 shadow-[0_30px_90px_rgba(31,42,55,.14)] backdrop-blur-2xl lg:flex">
          <div className="space-y-3">
            <Link to="/dashboard" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#121417] text-white shadow-[0_16px_38px_rgba(17,20,23,.22)]" aria-label="Dashboard home">
              <Command className="h-4 w-4" strokeWidth={1.8} />
            </Link>
            <div className="h-px bg-slate-200/80" />
            <nav className="flex flex-col gap-2">
              {railItems.map(({ icon: Icon, label, active }) => (
                <button
                  key={label}
                  type="button"
                  className={`group flex h-11 w-11 items-center justify-center rounded-2xl border transition duration-300 ${
                    active
                      ? "border-slate-900/10 bg-white text-[#14161a] shadow-[0_14px_32px_rgba(15,23,42,.10)]"
                      : "border-transparent bg-white/34 text-slate-500 hover:border-white hover:bg-white/80 hover:text-slate-900"
                  }`}
                  aria-label={label}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.7} />
                </button>
              ))}
            </nav>
          </div>
          <div className="space-y-2">
            <button type="button" className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/70 bg-white/45 text-slate-600 backdrop-blur-xl transition hover:bg-white" aria-label="Notifications">
              <Bell className="h-4 w-4" strokeWidth={1.7} />
            </button>
            <Link to="/upload" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#a7ff57] text-[#10130e] shadow-[0_18px_35px_rgba(117,190,47,.28)] transition hover:scale-[1.03]" aria-label="New video">
              <ArrowUpRight className="h-4 w-4" strokeWidth={1.9} />
            </Link>
          </div>
        </aside>

        <main className="min-w-0 rounded-[28px] border border-white/72 bg-white/50 p-3 shadow-[0_36px_120px_rgba(31,41,55,.16)] backdrop-blur-2xl sm:p-4 lg:rounded-[34px] lg:p-5">
          <section className="mb-4 rounded-[24px] border border-white/76 bg-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.95),0_18px_60px_rgba(15,23,42,.07)] sm:p-5 lg:mb-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                  <span>Listing Elevate</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>Studio OS</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h1 className="truncate text-[clamp(30px,4vw,54px)] font-medium leading-[.92] tracking-[-0.06em] text-[#111317]">
                    {routeLabel}
                  </h1>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Live
                  </span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex h-11 min-w-0 items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/78 px-3 text-sm text-slate-400 shadow-sm sm:w-[310px]">
                  <Search className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <input className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none" placeholder="Search listing, client, or task" />
                </label>
                <div className="grid grid-cols-3 gap-2 sm:w-[330px]">
                  {[
                    ["Mode", "Admin"],
                    ["Queue", "Live"],
                    ["Style", "Light"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/80 bg-white/62 px-3 py-2 text-center shadow-sm">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
                      <p className="mt-1 inline-flex items-center justify-center gap-1 text-xs font-semibold text-slate-800">
                        {label === "Style" && <Sparkles className="h-3 w-3 text-lime-500" strokeWidth={1.8} />}
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="le-dashboard-canvas min-w-0 rounded-[24px] border border-white/70 bg-white/64 p-3 pb-10 shadow-[inset_0_1px_0_rgba(255,255,255,.9)] sm:p-5 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
