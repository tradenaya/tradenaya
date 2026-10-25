import os from "node:os";
import path from "node:path";
import { loadEnvFile } from "../src/config/env.js";

export const TEST_DB = "jobdraft_test";

/** Test environment: mock externals, separate jobdraft_test database, fixed secrets. */
export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    MOCK_EXTERNAL: "true",
    DB_NAME: TEST_DB,
    JWT_SECRET: "test-jwt-secret-not-for-production-0123456789",
    ENCRYPTION_KEY: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    SCHEDULER_ENABLED: "false",
    // Sign-ups log in at once in tests; the approval flow is tested explicitly.
    SIGNUP_APPROVAL: "false",
    GEMINI_DELAY_MS: "0",
    AUTH_RATE_LIMIT_MAX: "1000",
    CLIENT_URL: "http://localhost:3055",
    GOOGLE_REDIRECT_URI: "http://localhost:5055/api/gmail/callback",
    MOCK_STORAGE_DIR: path.join(os.tmpdir(), "jobdraft-test-storage"),
  });
  // DB host/user/password come from server/.env (never overrides the values above).
  loadEnvFile();
}
