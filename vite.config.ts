import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Email editor stack — heavy, admin-only, never on first paint
          if (
            id.includes("/node_modules/react-email-editor/") ||
            id.includes("/node_modules/easy-email-core/") ||
            id.includes("/node_modules/easy-email-editor/") ||
            id.includes("/node_modules/easy-email-extensions/") ||
            id.includes("/node_modules/mjml-browser/")
          )
            return "email-editor";

          // Tiptap rich text editor — editor routes only
          if (id.includes("/node_modules/@tiptap/")) return "tiptap";

          // Arco Design component library
          if (id.includes("/node_modules/@arco-design/")) return "arco";

          // Framer Motion animation library
          if (id.includes("/node_modules/framer-motion/")) return "motion";

          // React core — stable, long-lived cache
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router-dom/")
          )
            return "react-vendor";
        },
      },
    },
  },
}));
