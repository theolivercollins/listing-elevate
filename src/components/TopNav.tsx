import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  LayoutDashboard,
  UserCircle,
  Upload as UploadIcon,
  User,
  LayoutGrid,
  GitBranch,
  Building2,
  FileText,
  Settings as SettingsIcon,
  DollarSign,
  Beaker,
  BookOpen,
  Code2,
  ChevronDown,
  GitPullRequest,
  ListChecks,
  Activity,
  Image as ImageIcon,
  Newspaper,
  LayoutTemplate,
  Search,
  Bell,
} from "lucide-react";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useTheme } from "@/lib/theme";

const dashboardNav = [
  { to: "/dashboard", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/dashboard/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/dashboard/properties", label: "Listings", icon: Building2 },
  { to: "/dashboard/logs", label: "Logs", icon: FileText },
  { to: "/dashboard/finances", label: "Finances", icon: DollarSign },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

const dashboardNavClass = (active: boolean) =>
  `inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-2xl border px-3.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition duration-300 ${
    active
      ? "border-slate-900 bg-[#121417] text-white shadow-[0_14px_34px_rgba(17,20,23,.18)]"
      : "border-transparent bg-white/48 text-slate-500 hover:border-white/80 hover:bg-white hover:text-slate-950 hover:shadow-sm"
  }`;

const menuClass = "w-58 rounded-2xl border-white/80 bg-white/95 p-2 text-slate-700 shadow-[0_24px_70px_rgba(15,23,42,.16)] backdrop-blur-2xl";

function DevelopmentNav() {
  const location = useLocation();
  const active = location.pathname.startsWith("/dashboard/development") || location.pathname === "/dashboard/rating-ledger";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={dashboardNavClass(active)}>
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.6} /> Dev
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.6} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuClass}>
        <DropdownMenuItem asChild><Link to="/dashboard/development"><Code2 className="mr-2 h-3.5 w-3.5" /> Overview</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/development/prompt-lab"><Beaker className="mr-2 h-3.5 w-3.5" /> Prompt Lab</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/development/prompt-lab/recipes"><BookOpen className="mr-2 h-3.5 w-3.5" /> Recipes</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/development/proposals"><GitPullRequest className="mr-2 h-3.5 w-3.5" /> Proposals</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/rating-ledger"><ListChecks className="mr-2 h-3.5 w-3.5" /> Rating Ledger</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/development/system-status"><Activity className="mr-2 h-3.5 w-3.5" /> System Status</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlogNav() {
  const location = useLocation();
  const active = location.pathname.startsWith("/dashboard/blog");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={dashboardNavClass(active)}>
          <Newspaper className="h-3.5 w-3.5" strokeWidth={1.6} /> Blog
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.6} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={menuClass}>
        <DropdownMenuItem asChild><Link to="/dashboard/blog/posts"><FileText className="mr-2 h-3.5 w-3.5" /> Posts</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/blog/images"><ImageIcon className="mr-2 h-3.5 w-3.5" /> Image Library</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/dashboard/blog/templates"><LayoutTemplate className="mr-2 h-3.5 w-3.5" /> Templates</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav() {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();

  if (location.pathname.startsWith("/v2")) return null;
  if (location.pathname === "/") return null;
  if (location.pathname === "/login" || location.pathname.startsWith("/auth")) return null;

  const inDashboard = location.pathname.startsWith("/dashboard");
  const previewDashboard = import.meta.env.DEV && inDashboard && window.location.hostname.endsWith(".manus.computer");
  const isAdmin = profile?.role === "admin" || previewDashboard;
  const signedIn = Boolean(user) || previewDashboard;

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <header
      className={
        inDashboard
          ? "sticky top-0 z-50 w-full border-b border-white/60 bg-[#eef2f5]/70 text-slate-900 shadow-[0_12px_40px_rgba(15,23,42,.08)] backdrop-blur-2xl backdrop-saturate-150"
          : "sticky top-0 z-50 w-full border-b border-border/60 bg-background/55 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/40"
      }
      style={{ fontFamily: "var(--le-font-sans)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1480px] items-center gap-3 px-4 sm:px-6 md:h-[72px] xl:px-8">
        <div className="flex shrink-0 items-center gap-3">
          <Link to={inDashboard ? "/dashboard" : "/"} className="inline-flex items-center" aria-label="Listing Elevate">
            <LELogoMark size={30} variant={inDashboard || theme === "light" ? "dark" : "light"} />
          </Link>
          {inDashboard && (
            <>
              <span className="h-5 w-px bg-slate-300/80" aria-hidden />
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Studio</span>
            </>
          )}
        </div>

        {inDashboard && isAdmin && (
          <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto rounded-[22px] border border-white/70 bg-white/45 p-1.5 shadow-sm lg:flex">
            {dashboardNav.slice(0, -1).map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => dashboardNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} /> {label}
              </NavLink>
            ))}
            <DevelopmentNav />
            <BlogNav />
            {dashboardNav.slice(-1).map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => dashboardNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} /> {label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {signedIn ? (
            <>
              {!inDashboard && (
                <>
                  <Link to="/upload" className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">New video</Link>
                  {isAdmin && <Link to="/dashboard" className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">Dashboard</Link>}
                </>
              )}
              {inDashboard && <button type="button" className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/58 text-slate-500 shadow-sm transition hover:bg-white sm:inline-flex" aria-label="Search"><Search className="h-4 w-4" /></button>}
              {inDashboard && <button type="button" className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/58 text-slate-500 shadow-sm transition hover:bg-white sm:inline-flex" aria-label="Notifications"><Bell className="h-4 w-4" /></button>}
              {inDashboard ? (
                <Link to="/upload" className="hidden h-10 items-center gap-2 rounded-2xl bg-[#121417] px-4 text-xs font-semibold text-white shadow-[0_14px_34px_rgba(17,20,23,.18)] transition hover:bg-black sm:inline-flex">
                  <UploadIcon className="h-3.5 w-3.5" /> New Video
                </Link>
              ) : (
                <Button asChild size="sm" variant="outline"><Link to="/upload"><UploadIcon className="h-3.5 w-3.5" /> New video</Link></Button>
              )}
              {!inDashboard && <ThemeToggle className="ml-2" />}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={
                      inDashboard
                        ? "flex h-10 w-10 items-center justify-center rounded-2xl border border-white/70 bg-white/70 text-slate-700 shadow-sm transition hover:bg-white"
                        : "ml-1 flex h-9 w-9 items-center justify-center border border-border text-foreground transition-all duration-500 ease-cinematic hover:border-foreground/40 hover:bg-secondary"
                    }
                    aria-label="Account menu"
                  >
                    <User className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={inDashboard ? menuClass : "w-60"}>
                  <div className="truncate px-3 py-2 text-xs font-medium text-slate-500">{user?.email ?? "preview@listing-elevate.local"}</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild><Link to="/upload"><UploadIcon className="mr-2 h-4 w-4" /> New video</Link></DropdownMenuItem>
                  {isAdmin ? <DropdownMenuItem asChild><Link to="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard</Link></DropdownMenuItem> : <DropdownMenuItem asChild><Link to="/account"><UserCircle className="mr-2 h-4 w-4" /> Account</Link></DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSignOut}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <ThemeToggle />
              <Link to="/?login=1" className="label hidden text-muted-foreground transition-colors hover:text-foreground md:inline">Sign in</Link>
              <Link to="/upload" className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-[13px] font-medium text-[#07080c] no-underline shadow-sm">Get started</Link>
            </>
          )}
        </div>
      </div>

      {inDashboard && isAdmin && (
        <div className="border-t border-white/60 bg-[#eef2f5]/78 px-4 py-3 lg:hidden">
          <nav className="mx-auto flex max-w-[1480px] gap-2 overflow-x-auto">
            {[...dashboardNav, { to: "/dashboard/development", label: "Dev", icon: Code2 }, { to: "/dashboard/blog/posts", label: "Blog", icon: Newspaper }].map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => dashboardNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} /> {label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
