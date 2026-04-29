import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type V2Theme = "light" | "dark";

interface V2ThemeContextValue {
  theme: V2Theme;
  setTheme: (t: V2Theme) => void;
  toggleTheme: () => void;
}

const V2ThemeContext = createContext<V2ThemeContextValue | null>(null);

function readInitialTheme(): V2Theme {
  if (typeof window === "undefined") return "dark";
  // happy-dom provides a partial localStorage stub; guard each access.
  if (typeof window.localStorage?.getItem !== "function") return "dark";
  try {
    const stored = window.localStorage.getItem("le-theme");
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function V2ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<V2Theme>(readInitialTheme);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.localStorage?.setItem !== "function") return;
    try {
      window.localStorage.setItem("le-theme", theme);
    } catch {
      // ignore quota / disabled-storage errors
    }
  }, [theme]);

  const value: V2ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
  };

  return <V2ThemeContext.Provider value={value}>{children}</V2ThemeContext.Provider>;
}

export function useV2Theme(): V2ThemeContextValue {
  const ctx = useContext(V2ThemeContext);
  if (!ctx) {
    throw new Error("useV2Theme must be used inside <V2ThemeProvider>");
  }
  return ctx;
}
