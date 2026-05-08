import { Sun, Moon } from "lucide-react";
import { useV2Theme } from "@/v2/lib/theme-context";

export function V2ThemeToggle() {
  const { theme, toggleTheme } = useV2Theme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="le-btn le-btn-glass"
      style={{ padding: "6px 10px", borderRadius: 999 }}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
