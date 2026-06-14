import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "lib/**/*.{test,spec}.ts", "lib/**/__tests__/**/*.{test,spec}.ts", "api/**/__tests__/**/*.{test,spec}.ts", "scripts/**/*.{test,spec}.ts"],
    globals: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
