import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoginDialog } from "./LoginDialog";

interface LoginDialogContextValue {
  open: boolean;
  openLogin: () => void;
  closeLogin: () => void;
}

const LoginDialogContext = createContext<LoginDialogContextValue>({
  open: false,
  openLogin: () => {},
  closeLogin: () => {},
});

/**
 * LoginDialogProvider — global provider for the sign-in modal.
 *
 * Mount once near the top of the tree (inside the router, below
 * AuthProvider). Exposes `openLogin()` / `closeLogin()` via
 * `useLoginDialog()` so any component can trigger the dialog without
 * navigating to a standalone page.
 *
 * Auto-opens when the URL carries `?login=1` — /login routes redirect
 * into this so bookmarked links still work.
 */
export function LoginDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const openLogin = useCallback(() => setOpen(true), []);
  const closeLogin = useCallback(() => {
    setOpen(false);
    // Clean up the ?login=1 query so reopening is intentional.
    const params = new URLSearchParams(location.search);
    if (params.has("login")) {
      params.delete("login");
      const qs = params.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : "" },
        { replace: true },
      );
    }
  }, [location.pathname, location.search, navigate]);

  // Honour ?login=1 query param (used by /login redirect + magic-link fallback).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("login") === "1") setOpen(true);
  }, [location.search]);

  return (
    <LoginDialogContext.Provider value={{ open, openLogin, closeLogin }}>
      {children}
      <LoginDialog open={open} onClose={closeLogin} />
    </LoginDialogContext.Provider>
  );
}

export function useLoginDialog() {
  return useContext(LoginDialogContext);
}
