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

const studioNavClass = (active: boolean) =>
  `inline-flex h-9 items-center gap-2 whitespace-nowrap border px-3 text-[11px] font-medium uppercase tracking-[0.16em] transition duration-300 ease-cinematic ${
    active
      ? "border-white bg-white text-[#050710] shadow-[0_10px_34px_rgba(255,255,255,.08)]"
      : "border-white/10 bg-white/[0.025] text-white/58 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
  }`;

function DevelopmentNav() {
  const location = useLocation();
  const active = location.pathname.startsWith("/dashboard/development") || location.pathname === "/dashboard/rating-ledger";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={studioNavClass(active)}>
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.5} /> Development
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 border-white/10 bg-[#080a13] text-white shadow-2xl">
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
        <button type="button" className={studioNavClass(active)}>
          <Newspaper className="h-3.5 w-3.5" strokeWidth={1.5} /> Blog
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52 border-white/10 bg-[#080a13] text-white shadow-2xl">
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

  const isAdmin = profile?.role === "admin";
  const inDashboard = location.pathname.startsWith("/dashboard");

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <header
      className={
        inDashboard
          ? "sticky top-0 z-50 w-full border-b border-white/10 bg-[#050710]/88 text-white shadow-[0_18px_70px_rgba(0,0,0,.32)] backdrop-blur-2xl backdrop-saturate-150"
          : "sticky top-0 z-50 w-full border-b border-border/60 bg-background/55 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/40"
      }
      style={{ fontFamily: "var(--le-font-sans)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1540px] items-center gap-4 px-4 sm:px-6 md:h-[76px] md:px-8 xl:px-10">
        <div className="flex shrink-0 items-center gap-3">
          <Link to={inDashboard ? "/dashboard" : "/"} className="inline-flex items-center" aria-label="Listing Elevate">
            <LELogoMark size={30} variant={inDashboard || theme === "dark" ? "light" : "dark"} />
          </Link>
          {inDashboard && (
            <>
              <span className="h-4 w-px bg-white/12" aria-hidden />
              <span className="label text-white/45">Studio</span>
            </>
          )}
        </div>

        {inDashboard && isAdmin && (
          <nav className="ml-4 hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto lg:flex">
            {dashboardNav.slice(0, -1).map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => studioNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} /> {label}
              </NavLink>
            ))}
            <DevelopmentNav />
            <BlogNav />
            {dashboardNav.slice(-1).map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => studioNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} /> {label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 md:gap-3">
          {user ? (
            <>
              {!inDashboard && (
                <>
                  <Link to="/upload" className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">New video</Link>
                  {isAdmin && <Link to="/dashboard" className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline">Dashboard</Link>}
                </>
              )}
              {inDashboard ? (
                <Link to="/upload" className="hidden h-9 items-center gap-2 border border-white/10 bg-white px-3 text-xs font-medium text-[#050710] transition hover:bg-white/85 sm:inline-flex">
                  <UploadIcon className="h-3.5 w-3.5" /> New Video
                </Link>
              ) : (
                <Button asChild size="sm" variant="outline"><Link to="/upload"><UploadIcon className="h-3.5 w-3.5" /> New video</Link></Button>
              )}
              <ThemeToggle className={inDashboard ? "hidden sm:inline-flex" : "ml-2"} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={
                      inDashboard
                        ? "flex h-9 w-9 items-center justify-center border border-white/10 bg-white/[0.035] text-white transition hover:border-white/25 hover:bg-white/[0.08]"
                        : "ml-1 flex h-9 w-9 items-center justify-center border border-border text-foreground transition-all duration-500 ease-cinematic hover:border-foreground/40 hover:bg-secondary"
                    }
                    aria-label="Account menu"
                  >
                    <User className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={inDashboard ? "w-60 border-white/10 bg-[#080a13] text-white" : "w-60"}>
                  <div className="label truncate px-3 py-2 text-muted-foreground">{user.email}</div>
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
              <Link to="/upload" className="inline-flex items-center gap-2 bg-white px-4 py-2 text-[13px] font-medium text-[#07080c] no-underline">Get started</Link>
            </>
          )}
        </div>
      </div>

      {inDashboard && isAdmin && (
        <div className="border-t border-white/10 bg-[#050710]/94 px-4 py-3 lg:hidden">
          <nav className="mx-auto flex max-w-[1540px] gap-2 overflow-x-auto">
            {[...dashboardNav, { to: "/dashboard/development", label: "Dev", icon: Code2 }, { to: "/dashboard/blog/posts", label: "Blog", icon: Newspaper }].map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => studioNavClass(isActive)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} /> {label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
