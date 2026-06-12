import { Link, useLocation, useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { LELogoMark } from "@/v2/components/primitives/LELogoMark";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useTheme } from "@/lib/theme";

/**
 * TopNav — non-dashboard chrome only.
 *
 * The dashboard has its own left sidebar (DashboardSidebar), so TopNav
 * suppresses itself on /dashboard/* routes. The old `dashboardNav` constant
 * and the duplicate horizontal sub-nav that lived here have been removed;
 * the sidebar is now the single navigation system for the authed app.
 */
export function TopNav() {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme } = useTheme();

  // v2 shell mounts its own navigation; suppress the legacy TopNav on /v2/*.
  if (location.pathname.startsWith("/v2")) return null;

  // Index.tsx renders its own hero-style navigation with auth modal hookup.
  if (location.pathname === "/") return null;

  // Login + auth callback render their own editorial branding.
  if (location.pathname === "/login" || location.pathname.startsWith("/auth")) return null;

  // Dashboard renders its own left sidebar; suppress TopNav completely.
  if (location.pathname.startsWith("/dashboard")) return null;

  // /upload renders its own SiteNav inside Upload.tsx — suppress to avoid
  // stacking two nav bars.
  if (location.pathname === "/upload") return null;

  // /preview/:token/embed is a chrome-less iframe surface embedded in agents'
  // Sierra customer sites. LE marketing nav (logo, sign-in, CTA) must not appear.
  if (/^\/preview\/[^/]+\/embed$/.test(location.pathname)) return null;

  const isAdmin = profile?.role === "admin";
  const inDashboard = false; // always false here — /dashboard suppressed above

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
        {/* Brand */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center"
            aria-label="Listing Elevate"
          >
            <LELogoMark size={30} variant={theme === "dark" ? "light" : "dark"} />
          </Link>
        </div>

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
