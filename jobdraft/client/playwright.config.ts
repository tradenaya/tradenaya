import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// E2E runs its own server + client on separate ports, against jobdraft_test,
// with every external service mocked (MOCK_EXTERNAL=true).
const SERVER_PORT = 5056;
const CLIENT_PORT = 3056;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;

// Reuse a browser that is already installed (Edge ships with Windows) instead
// of downloading one. Override with PW_CHANNEL=chrome or PW_CHANNEL=chromium.
const channel = process.env.PW_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: CLIENT_URL,
    channel: channel === "chromium" ? undefined : channel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: path.resolve(__dirname, "../server"),
      url: `${SERVER_URL}/api/health`,
      // Generous: a busy PC (other dev servers, Docker) can be slow to start these.
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        PORT: String(SERVER_PORT),
        CLIENT_URL,
        DB_NAME: "jobdraft_test",
        MOCK_EXTERNAL: "true",
        SCHEDULER_ENABLED: "false",
        // Sign-ups log in at once; the approval test switches approval on via the admin page.
        SIGNUP_APPROVAL: "false",
        GEMINI_DELAY_MS: "0",
        AUTH_RATE_LIMIT_MAX: "1000",
        GOOGLE_REDIRECT_URI: `${SERVER_URL}/api/gmail/callback`,
        MOCK_STORAGE_DIR: path.join(os.tmpdir(), "jobdraft-e2e-storage"),
        LOG_LEVEL: "warn",
      },
    },
    {
      // A real production build (NEXT_PUBLIC_API_URL is baked in at build time).
      command: `npx next build && npx next start --port ${CLIENT_PORT}`,
      cwd: __dirname,
      url: `${CLIENT_URL}/login`,
      timeout: 600_000,
      reuseExistingServer: false,
      stdout: "ignore",
      stderr: "pipe",
      env: { NEXT_PUBLIC_API_URL: SERVER_URL, JOBDRAFT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});
