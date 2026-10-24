import { defineConfig } from "vitest/config";
import path from "node:path";

/** End-to-end trading simulation (needs a local MySQL; see src/test/e2e). Run: npm run test:e2e */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/test/e2e/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    env: { E2E: "1" },
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
