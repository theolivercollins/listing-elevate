import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Upload as UploadIcon, User, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useAuth } from "@/lib/auth";

const PAGE_TITLES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/dashboard\/?$/, label: "Overview" },
  { pattern: /^\/dashboard\/orders\/pipeline/, label: "Pipeline" },
  { pattern: /^\/dashboard\/orders/, label: "Orders" },
  { pattern: /^\/dashboard\/users/, label: "Users" },
  { pattern: /^\/dashboard\/listings/, label: "Listings" },
  { pattern: /^\/dashboard\/finances/, label: "Finances" },
  { pattern: /^\/dashboard\/tools\/blog/, label: "Blog" },
  { pattern: /^\/dashboard\/dev\/prompt-lab/, label: "Prompt Lab" },
  { pattern: /^\/dashboard\/dev\/recipes/, label: "Recipes" },
  { pattern: /^\/dashboard\/dev\/knowledge-map/, label: "Knowledge Map" },
  { pattern: /^\/dashboard\/dev\/system-status/, label: "System Status" },
  { pattern: /^\/dashboard\/dev/, label: "Development" },
];

function resolveTitle(pathname: string): string {
  for (const { pattern, label } of PAGE_TITLES) {
    if (pattern.test(pathname)) return label;
  }
  return "Dashboard";
}

export function TopBar() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const title = resolveTitle(location.pathname);

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div
      className="flex h-14 items-center gap-4 border-b px-6"
      style={{
        background: "var(--le-bg)",
        borderColor: "var(--le-border)",
      }}
    >
      <h1 className="le-display text-[20px] font-medium tracking-tight" style={{ color: "var(--le-text)" }}>
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-3">
        <Button asChild size="sm" variant="outline">
          <Link to="/upload">
            <UploadIcon className="mr-2 h-3.5 w-3.5" /> New video
          </Link>
        </Button>
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-[8px] border transition-colors hover:bg-[color:var(--le-bg-sunken)]"
              style={{ borderColor: "var(--le-border)" }}
              aria-label="Account menu"
            >
              <User className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-3 py-2 text-xs" style={{ color: "var(--le-text-muted)" }}>{user?.email}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account" className="cursor-pointer">
                <UserCircle className="mr-2 h-4 w-4" /> Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} className="cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
