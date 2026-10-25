import { GoogleGenAI } from "@google/genai";
import { config } from "../config/env.js";
import { sha1 } from "../lib/crypto.js";
import { errInfo, log } from "../lib/logger.js";
import { sleep } from "../lib/errors.js";

export class AiUnavailableError extends Error {
  constructor(message = "The AI service is unavailable right now. Please try again later.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** The user hasn't saved a Gemini API key. */
export class AiKeyMissingError extends AiUnavailableError {
  constructor() {
    super("Add your Gemini API key in Setup to use JobDraft's AI.");
    this.name = "AiKeyMissingError";
  }
}

/** The user's key has used up its quota on every model (it resets daily). */
export class AiQuotaError extends AiUnavailableError {
  constructor() {
    super("Your Gemini API key has reached its usage limit for now. Please try again in a few hours.");
    this.name = "AiQuotaError";
  }
}

/** Google rejected the user's Gemini API key (invalid, deleted or restricted). */
export class AiKeyRejectedError extends AiUnavailableError {
  constructor() {
    super("Your Gemini API key was rejected by Google. Update it in Setup.");
    this.name = "AiKeyRejectedError";
  }
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  schema: object;
  /** The user's own Gemini API key (the server has none of its own). */
  apiKey?: string;
  /** Try the quick "lite" models first (simple extraction, a user is waiting). */
  fast?: boolean;
  /** Abort a single model call after this long and move on to the next model. */
  callTimeoutMs?: number;
  /** Absolute time (epoch ms) after which no new call or retry is started. */
  deadline?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

/** For `fast` requests the lite models go first; otherwise the configured order is kept. */
export function orderModels(models: string[], fast = false): string[] {
  if (!fast) return models;
  const lite = (m: string) => /lite/i.test(m);
  return [...models.filter(lite), ...models.filter((m) => !lite(m))];
}

/** (key, model) pairs whose quota ran out, skipped until this time (in-memory; one server process). */
const exhaustedUntil = new Map<string, number>();

export function resetGeminiStateForTests() {
  exhaustedUntil.clear();
  clients.clear();
}

/** One SDK client per key, reused (bounded). */
const clients = new Map<string, GoogleGenAI>();
function clientFor(apiKey: string): GoogleGenAI {
  let c = clients.get(apiKey);
  if (!c) {
    if (clients.size >= 200) clients.delete(clients.keys().next().value!);
    c = new GoogleGenAI({ apiKey });
    clients.set(apiKey, c);
  }
  return c;
}

/** Never the key itself: a short hash, for the quota map. */
const keyId = (apiKey: string) => sha1(apiKey).slice(0, 12);

/** Google's answer to a bad key is HTTP 400 "API key not valid" (API_KEY_INVALID), or 401/403. */
export function isKeyRejected(err: unknown): boolean {
  const status = statusOf(err);
  const msg = (err as { message?: string })?.message ?? "";
  return status === 401 || status === 403 || (status === 400 && /api[ _]?key[ _]?(not valid|invalid)|API_KEY_INVALID/i.test(msg));
}

/**
 * Checks a key with Google before it is saved: lists models (free, no
 * generation quota used). Throws AiKeyRejectedError for a bad key, or
 * AiUnavailableError when Google can't be reached.
 */
export async function verifyGeminiKey(apiKey: string): Promise<void> {
  try {
    const pager = await new GoogleGenAI({ apiKey }).models.list({ config: { pageSize: 1, abortSignal: AbortSignal.timeout(15_000) } });
    void pager;
  } catch (err) {
    if (isKeyRejected(err)) throw new AiKeyRejectedError();
    log.warn("gemini_key_check_failed", { error: errInfo(err) });
    throw new AiUnavailableError("Couldn't reach Google to check the key. Please try again in a moment.");
  }
}

/** 429 "You exceeded your current quota" (plan limit), as opposed to a short "slow down". */
export function isQuotaError(err: unknown): boolean {
  return statusOf(err) === 429 && /quota/i.test((err as { message?: string })?.message ?? "");
}

/** A daily limit is skipped for an hour (it resets daily); a per-minute one for a minute. */
export function quotaCooldownMs(err: unknown): number {
  return /per ?day|daily/i.test((err as { message?: string })?.message ?? "") ? 60 * 60_000 : 60_000;
}

/** "fetch failed", connection resets: a blip worth one more try. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { message?: string; cause?: { code?: string } };
  return statusOf(err) === 0 && (/fetch failed|socket|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(e?.message ?? "") || !!e?.cause?.code);
}

function isTimeout(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === "AbortError" || e?.name === "TimeoutError" || /aborted|timed? ?out/i.test(e?.message ?? "");
}

function statusOf(err: unknown): number {
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  const m = /\b(4\d\d|5\d\d)\b/.exec(e.message ?? "");
  return m ? Number(m[1]) : 0;
}

/**
 * Calls Gemini with the user's own key and structured JSON output. Tries each
 * model in GEMINI_MODELS in order: 429/500/503 are retried with exponential
 * backoff, other errors (e.g. unknown model) and calls slower than
 * `callTimeoutMs` move on to the next model. Nothing new starts after
 * `deadline`. Returns the parsed JSON.
 */
export async function geminiGenerateJson(req: GenerateRequest): Promise<unknown> {
  const { gemini } = config();
  if (!req.apiKey) throw new AiKeyMissingError();
  const client = clientFor(req.apiKey);
  const kid = keyId(req.apiKey);
  const callTimeoutMs = req.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const remaining = () => (req.deadline ?? Infinity) - Date.now();
  let lastErr: unknown;
  let onlyQuotaErrors = true;
  outer: for (const model of orderModels(gemini.models, req.fast)) {
    if ((exhaustedUntil.get(`${kid}|${model}`) ?? 0) > Date.now()) continue; // this key's quota used up: don't waste a call
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (remaining() < 3000) break outer;
      const started = Date.now();
      try {
        const res = await client.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.schema,
            temperature: 0.2,
            maxOutputTokens: 8192,
            abortSignal: AbortSignal.timeout(Math.min(callTimeoutMs, remaining())),
          },
        });
        const text = res.text ?? "";
        try {
          return JSON.parse(text);
        } catch {
          // Occasionally wrapped in a code fence.
          const m = /\{[\s\S]*\}/.exec(text);
          if (m) return JSON.parse(m[0]);
          throw new Error("Model returned non-JSON output");
        }
      } catch (err) {
        lastErr = err;
        if (isQuotaError(err)) {
          // The plan's limit for this model is used up: retrying only fails again.
          const ms = quotaCooldownMs(err);
          exhaustedUntil.set(`${kid}|${model}`, Date.now() + ms);
          log.warn("gemini_quota_exhausted", { model, skipMinutes: Math.round(ms / 60_000) });
          break; // next model
        }
        onlyQuotaErrors = false;
        if (isTimeout(err)) {
          log.warn("gemini_call_timeout", { model, attempt, ms: Date.now() - started });
          break; // too slow right now: next model
        }
        const status = statusOf(err);
        if (isKeyRejected(err)) {
          log.warn("gemini_key_rejected", { model, status });
          throw new AiKeyRejectedError();
        }
        const retryable = status === 429 || status === 500 || status === 503 || status === 504 || isNetworkError(err);
        log.warn("gemini_call_failed", { model, attempt, status, error: errInfo(err) });
        const backoff = Math.min(2000 * 2 ** (attempt - 1), 10000) + Math.floor(Math.random() * 500);
        if (retryable && attempt < 3 && remaining() > backoff + 3000) {
          await sleep(backoff);
          continue;
        }
        break; // next model
      }
    }
  }
  if (onlyQuotaErrors && remaining() >= 3000) {
    log.error("gemini_quota_reached", { models: gemini.models.length });
    throw new AiQuotaError();
  }
  if (remaining() < 3000) {
    log.error("gemini_deadline_reached", { error: errInfo(lastErr) });
    throw new AiUnavailableError("The AI is responding slowly right now. Please try again in a few minutes.");
  }
  log.error("gemini_all_models_failed", { error: errInfo(lastErr) });
  throw new AiUnavailableError();
}
