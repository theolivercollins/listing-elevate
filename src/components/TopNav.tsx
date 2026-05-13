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
import { isDashboardV3Enabled } from "@/lib/featureFlags";

const dashboardNav = [
  { to: "/dashboard", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/dashboard/pipeline", label: "Pipeline", icon: GitBranch },
  { to: "/dashboard/properties", label: "Listings", icon: Building2 },
  { to: "/dashboard/logs", label: "Logs", icon: FileText },
  { to: "/dashboard/finances", label: "Finances", icon: DollarSign },
  { to: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

function DevelopmentNav() {
  const location = useLocation();
  const active = location.pathname.startsWith("/dashboard/development");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`relative flex items-center gap-2 whitespace-nowrap py-[26px] text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500 ease-cinematic outline-none ${
            active ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[1px] after:bg-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          Development
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem asChild>
          <Link to="/dashboard/development" className="cursor-pointer">
            <Code2 className="mr-2 h-3.5 w-3.5" /> Overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/development/prompt-lab" className="cursor-pointer">
            <Beaker className="mr-2 h-3.5 w-3.5" /> Prompt Lab
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/development/prompt-lab/recipes" className="cursor-pointer">
            <BookOpen className="mr-2 h-3.5 w-3.5" /> Recipes
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/development/proposals" className="cursor-pointer">
            <GitPullRequest className="mr-2 h-3.5 w-3.5" /> Proposals
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/rating-ledger" className="cursor-pointer">
            <ListChecks className="mr-2 h-3.5 w-3.5" /> Rating ledger
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/development/system-status" className="cursor-pointer">
            <Activity className="mr-2 h-3.5 w-3.5" /> System status
          </Link>
        </DropdownMenuItem>
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
        <button
          type="button"
          className={`relative flex items-center gap-2 whitespace-nowrap py-[26px] text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500 ease-cinematic outline-none ${
            active ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[1px] after:bg-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Newspaper className="h-3.5 w-3.5" strokeWidth={1.5} />
          Blog
          <ChevronDown className="h-3 w-3 opacity-70" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem asChild>
          <Link to="/dashboard/blog/posts" className="cursor-pointer">
            <FileText className="mr-2 h-3.5 w-3.5" /> Posts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/blog/images" className="cursor-pointer">
            <ImageIcon className="mr-2 h-3.5 w-3.5" /> Image library
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/blog/templates" className="cursor-pointer">
            <LayoutTemplate className="mr-2 h-3.5 w-3.5" /> Templates
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav() {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();

  // v2 shell mounts its own navigation; suppress the legacy TopNav on /v2/*.
  if (location.pathname.startsWith("/v2")) return null;

  // Dashboard v3 shell mounts its own sidebar+topbar; suppress the legacy TopNav.
  if (isDashboardV3Enabled() && location.pathname.startsWith("/dashboard")) return null;

  // Index.tsx renders its own hero-style navigation with auth modal hookup.
  if (location.pathname === "/") return null;

  // Login + auth callback render their own editorial branding.
  if (location.pathname === "/login" || location.pathname.startsWith("/auth")) return null;

  const isAdmin = profile?.role === "admin";
  const inDashboard = location.pathname.startsWith("/dashboard");

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/55 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/40"
      style={{ fontFamily: "var(--le-font-sans)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-6 md:h-[72px] md:px-10">
        {/* Brand — identical size/layout on every page */}
        <div className="flex items-center gap-3">
          <Link
            to={inDashboard ? "/dashboard" : "/"}
            className="inline-flex items-center"
            aria-label="Listing Elevate"
          >
            <LELogoMark size={30} variant={theme === "dark" ? "light" : "dark"} />
          </Link>
          {inDashboard && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Studio
              </span>
            </>
          )}
        </div>

        {/* Dashboard sub-nav — lives in the header when we're in /dashboard */}
        {inDashboard && isAdmin && (
          <nav className="ml-10 hidden items-center gap-8 md:flex">
            {dashboardNav.slice(0, -1).map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 whitespace-nowrap py-[26px] text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500 ease-cinematic ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  } ${
                    isActive
                      ? "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[1px] after:bg-foreground"
                      : ""
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {label}
              </NavLink>
            ))}
            <DevelopmentNav />
            <BlogNav />
            {dashboardNav.slice(-1).map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex items-center gap-2 whitespace-nowrap py-[26px] text-[11px] font-medium uppercase tracking-[0.18em] transition-colors duration-500 ease-cinematic ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  } ${
                    isActive
                      ? "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[1px] after:bg-foreground"
                      : ""
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-2 md:gap-4">
          {user ? (
            <>
              {!inDashboard && (
                <>
                  <Link
                    to="/upload"
                    className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
                  >
                    New video
                  </Link>
                  {isAdmin && (
                    <Link
                      to="/dashboard"
                      className="label hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
                    >
                      Dashboard
                    </Link>
                  )}
                </>
              )}
              {inDashboard && (
                <Button asChild size="sm" variant="outline">
                  <Link to="/upload">
                    <UploadIcon className="h-3.5 w-3.5" /> New video
                  </Link>
                </Button>
              )}
              <ThemeToggle className="ml-2" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-1 flex h-9 w-9 items-center justify-center border border-border text-foreground transition-all duration-500 ease-cinematic hover:border-foreground/40 hover:bg-secondary"
                    aria-label="Account menu"
                  >
                    <User className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="label truncate px-3 py-2 text-muted-foreground">{user.email}</div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/upload" className="cursor-pointer">
                      <UploadIcon className="mr-2 h-4 w-4" /> New video
                    </Link>
                  </DropdownMenuItem>
                  {isAdmin ? (
                    <DropdownMenuItem asChild>
                      <Link to="/dashboard" className="cursor-pointer">
                        <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
                      </Link>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem asChild>
                      <Link to="/account" className="cursor-pointer">
                        <UserCircle className="mr-2 h-4 w-4" /> Account
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleSignOut} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <ThemeToggle />
              <Link
                to="/?login=1"
                className="label hidden text-muted-foreground transition-colors hover:text-foreground md:inline"
              >
                Sign in
              </Link>
              <Link
                to="/upload"
                style={{
                  background: "#fff",
                  color: "#07080c",
                  borderRadius: 4,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: "none",
                  fontFamily: "var(--le-font-sans)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
