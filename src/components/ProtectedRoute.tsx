import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AdminEmailVerifyWall } from "./AdminEmailVerifyWall";

// ─── RequireAuth ──────────────────────────────────────────────────────────────

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

// ─── RequireAdmin ─────────────────────────────────────────────────────────────

export function RequireAdmin() {
  const { user, profile, loading, adminVerified } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role !== "admin") return <Navigate to="/dashboard" replace />;

  // TODO (server-side follow-up): enforce email step-up on /api/admin/* server-side; client gating is defence-in-depth only.
  if (!adminVerified) return <AdminEmailVerifyWall />;

  return <Outlet />;
}
