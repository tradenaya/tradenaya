import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../lib/logger.js";

// server/.env — resolves the same from src/config (tsx) and dist/config (built).
export const ENV_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");

/**
 * Minimal .env parser (KEY=value, # comments). If a key appears twice, the last
 * line wins (same as dotenv). Never overrides real environment variables.
 */
export function loadEnvFile(file = ENV_FILE): void {
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  for (const [key, value] of values) if (!(key in process.env)) process.env[key] = value;
}

/**
 * JWT_SECRET and ENCRYPTION_KEY are generated on first start when missing and
 * appended to server/.env, so tokens survive restarts. Values are never logged.
 */
export function ensureSecrets(file = ENV_FILE): string[] {
  const generated: string[] = [];
  const additions: string[] = [];
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
    additions.push(`JWT_SECRET=${process.env.JWT_SECRET}`);
    generated.push("JWT_SECRET");
  }
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    additions.push(`ENCRYPTION_KEY=${process.env.ENCRYPTION_KEY}`);
    generated.push("ENCRYPTION_KEY");
  }
  if (additions.length) {
    const prefix = fs.existsSync(file) && !fs.readFileSync(file, "utf8").endsWith("\n") ? "\n" : "";
    fs.appendFileSync(file, `${prefix}\n# Generated automatically on ${new Date().toISOString()}\n${additions.join("\n")}\n`);
    log.warn("secrets_generated", { keys: generated, file: "server/.env" });
  }
  return generated;
}

function parseKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const b64 = Buffer.from(value, "base64");
  if (b64.length === 32) return b64;
  throw new Error("ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64.");
}

const bool = (v: string | undefined, fallback = false) =>
  v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase());
const int = (v: string | undefined, fallback: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

export const DEFAULT_GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];

/** Read at call time so tests can change process.env between cases. */
export function config() {
  const e = process.env;
  const nodeEnv = e.NODE_ENV || "development";
  const isProd = nodeEnv === "production";
  const port = int(e.PORT, 5055);
  return {
    nodeEnv,
    isProd,
    isTest: nodeEnv === "test",
    port,
    clientUrl: (e.CLIENT_URL || "http://localhost:3055").replace(/\/$/, ""),
    cookieSecure: bool(e.COOKIE_SECURE, isProd),
    db: {
      host: e.DB_HOST || "localhost",
      port: int(e.DB_PORT, 3306),
      user: e.DB_USER || "root",
      password: e.DB_PASSWORD || "",
      name: e.DB_NAME || "jobdraft",
    },
    jwtSecret: e.JWT_SECRET || "",
    encryptionKey: () => parseKey(e.ENCRYPTION_KEY || ""),
    cloudinary: {
      cloudName: e.CLOUDINARY_CLOUD_NAME || "",
      apiKey: e.CLOUDINARY_API_KEY || "",
      apiSecret: e.CLOUDINARY_API_SECRET || "",
    },
    // No server-wide key: every user brings their own Gemini API key (GEMINI_API_KEY is ignored).
    gemini: {
      models: (e.GEMINI_MODELS || DEFAULT_GEMINI_MODELS.join(","))
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      delayMs: int(e.GEMINI_DELAY_MS, 1500),
    },
    google: {
      clientId: e.GOOGLE_CLIENT_ID || "",
      clientSecret: e.GOOGLE_CLIENT_SECRET || "",
      redirectUri: e.GOOGLE_REDIRECT_URI || `http://localhost:${port}/api/gmail/callback`,
    },
    adzuna: { appId: e.ADZUNA_APP_ID || "", appKey: e.ADZUNA_APP_KEY || "" },
    /** Adzuna's free plan allows 250 calls a day across all users; stop short of it. */
    adzunaDailyCap: int(e.ADZUNA_DAILY_CAP, 230),
    rapidApiKey: e.RAPIDAPI_KEY || "",
    /**
     * Searches a month on the shared RAPIDAPI_KEY (JSearch free plan: 200). Each day
     * gets what is left divided by the days left in the cycle, so nothing unused is
     * lost, and that day's searches are split between the users who run.
     */
    jsearchMonthlyQuota: int(e.JSEARCH_MONTHLY_QUOTA, 200),
    /** Day of the month the shared key's RapidAPI quota resets (the day you subscribed). */
    jsearchResetDay: Math.min(31, Math.max(1, int(e.JSEARCH_RESET_DAY, 1))),
    /** Searches a month on a user's own key (JSearch free plan: 200). */
    jsearchOwnKeyMonthlyQuota: int(e.JSEARCH_OWN_KEY_MONTHLY_QUOTA, 200),
    /** Optional upper limit on shared-key searches per day across all users; 0 = from the monthly quota only. */
    jsearchDailyCap: int(e.JSEARCH_DAILY_CAP, 0),
    /** Optional upper limit on searches in one run; 0 = only the user's share for the day. */
    jsearchMaxCallsPerRun: int(e.JSEARCH_MAX_CALLS_PER_RUN, 0),
    /** Postings the AI checks per user per run; 0 = no cap (until done, the key's limit, or the run's time limit). */
    maxScreenPerRun: int(e.MAX_SCREEN_PER_RUN, 0),
    mockExternal: bool(e.MOCK_EXTERNAL, false),
    schedulerEnabled: bool(e.SCHEDULER_ENABLED, true),
    /** Default for "new sign-ups need admin approval" (the admin page can switch it). */
    signupApproval: bool(e.SIGNUP_APPROVAL, true),
    /** Google Cloud project for the "Open Google test users" link (defaults to the number in GOOGLE_CLIENT_ID). */
    googleCloudProject: e.GOOGLE_CLOUD_PROJECT || (e.GOOGLE_CLIENT_ID || "").split("-")[0] || "",
    authRateLimitMax: int(e.AUTH_RATE_LIMIT_MAX, 20),
    manualRunCooldownMin: int(e.MANUAL_RUN_COOLDOWN_MIN, 30),
    mockStorageDir: e.MOCK_STORAGE_DIR || path.resolve(path.dirname(ENV_FILE), ".mock-storage"),
  };
}

export type Config = ReturnType<typeof config>;

/** Which external services can be used right now (mock mode counts as configured). */
export function features() {
  const c = config();
  const m = c.mockExternal;
  return {
    mock: m,
    cloudinary: m || !!(c.cloudinary.cloudName && c.cloudinary.apiKey && c.cloudinary.apiSecret),
    gmail: m || !!(c.google.clientId && c.google.clientSecret && c.google.redirectUri),
    adzuna: m || !!(c.adzuna.appId && c.adzuna.appKey),
    jsearch: !m && !!c.rapidApiKey,
  };
}

export function missingFeatureMessages(): string[] {
  const f = features();
  const out: string[] = [];
  if (!f.cloudinary) out.push("Resume storage (Cloudinary) is not configured — resume upload is unavailable.");
  if (!f.gmail) out.push("Google sign-in is not configured — Gmail cannot be connected.");
  if (!f.adzuna && !f.jsearch) out.push("No job sources are configured (Adzuna or JSearch) — runs will find no jobs.");
  return out;
}

export function logFeatureStatus(): void {
  const f = features();
  log.info("feature_status", f);
  for (const msg of missingFeatureMessages()) log.warn("not_configured", { message: msg });
}
