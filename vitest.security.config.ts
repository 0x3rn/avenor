import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
    environment: "node",
    globals: true,
    include: ["tests/security/**/*.test.ts"],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
