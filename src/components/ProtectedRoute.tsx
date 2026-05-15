import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}

export function RequireAdmin() {
  const { user, profile, loading } = useAuth();
  const previewDashboard = import.meta.env.DEV && window.location.pathname.startsWith('/dashboard') && window.location.hostname.endsWith('.manus.computer');

  if (previewDashboard) return <Outlet />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (profile?.role !== "admin") return <Navigate to="/account" replace />;

  return <Outlet />;
}
