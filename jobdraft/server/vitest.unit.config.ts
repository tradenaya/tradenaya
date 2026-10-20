import { defineConfig } from "vitest/config";

// Unit tests only: pure logic, no database (runs even when MySQL is down).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
    setupFiles: ["./test/setup-env.ts"],
    testTimeout: 30000,
  },
});
