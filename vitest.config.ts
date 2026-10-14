import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@avenor/types": path.resolve(__dirname, "./packages/types/src/index.ts"),
      "@avenor/config": path.resolve(__dirname, "./packages/config/src/index.ts"),
      "@avenor/ui": path.resolve(__dirname, "./packages/ui/src/index.ts"),
      "@avenor/database": path.resolve(__dirname, "./packages/database/src/index.ts"),
      "@avenor/auth": path.resolve(__dirname, "./packages/auth/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "src/app/**/layout.tsx"],
    },
  },
});
