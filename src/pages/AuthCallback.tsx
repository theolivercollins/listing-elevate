import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/brand/Wordmark";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function AuthCallback() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (session) {
          // Wait a tick for profile to load via auth state change
          setTimeout(() => {
            if (cancelled) return;
            if (profile?.role === "admin") {
              navigate("/dashboard", { replace: true });
            } else {
              navigate("/account", { replace: true });
            }
          }, 500);
        } else {
          navigate("/?login=1", { replace: true });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Sign-in failed");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, profile]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-background px-8 py-12 text-foreground">
      <Wordmark size="md" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
        className="text-center"
      >
        {error ? (
          <>
            <span className="label text-destructive">— Error</span>
            <h1 className="display-md mt-4">Sign-in interrupted.</h1>
            <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">{error}</p>
            <Link
              to="/?login=1"
              className="mt-8 inline-flex items-center gap-2 text-xs text-foreground underline underline-offset-4"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
          </>
        ) : (
          <>
            <span className="label text-muted-foreground">— Authenticating</span>
            <h1 className="display-md mt-4">
              Signing you in
              <motion.span
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              >
                .
              </motion.span>
              <motion.span
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
              >
                .
              </motion.span>
              <motion.span
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
              >
                .
              </motion.span>
            </h1>
            <p className="mt-4 text-sm text-muted-foreground">A moment while we get you set up.</p>
          </>
        )}
      </motion.div>
      <span className="label text-muted-foreground/60">— Listing Elevate</span>
    </div>
  );
}
