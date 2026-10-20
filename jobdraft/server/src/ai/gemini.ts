import { GoogleGenAI } from "@google/genai";
import { config } from "../config/env.js";
import { errInfo, log } from "../lib/logger.js";
import { sleep } from "../lib/errors.js";

export class AiUnavailableError extends Error {
  constructor(message = "The AI service is unavailable right now. Please try again later.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  schema: object;
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

let client: GoogleGenAI | undefined;
let clientKey = "";

/**
 * Calls Gemini with structured JSON output. Tries each model in GEMINI_MODELS in
 * order: 429/500/503 are retried with exponential backoff, other errors (e.g.
 * unknown model) and calls slower than `callTimeoutMs` move on to the next
 * model. Nothing new starts after `deadline`. Returns the parsed JSON.
 */
export async function geminiGenerateJson(req: GenerateRequest): Promise<unknown> {
  const { gemini } = config();
  if (!gemini.apiKey) throw new AiUnavailableError("AI (Gemini) is not configured.");
  if (!client || clientKey !== gemini.apiKey) {
    client = new GoogleGenAI({ apiKey: gemini.apiKey });
    clientKey = gemini.apiKey;
  }
  const callTimeoutMs = req.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const remaining = () => (req.deadline ?? Infinity) - Date.now();
  let lastErr: unknown;
  outer: for (const model of orderModels(gemini.models, req.fast)) {
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
        if (isTimeout(err)) {
          log.warn("gemini_call_timeout", { model, attempt, ms: Date.now() - started });
          break; // too slow right now: next model
        }
        const status = statusOf(err);
        if (status === 401 || status === 403) {
          log.error("gemini_auth_error", { model, status });
          throw new AiUnavailableError("The Gemini API key was rejected. Check GEMINI_API_KEY.");
        }
        const retryable = status === 429 || status === 500 || status === 503 || status === 504;
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
  if (remaining() < 3000) {
    log.error("gemini_deadline_reached", { error: errInfo(lastErr) });
    throw new AiUnavailableError("The AI is responding slowly right now. Please try again in a few minutes.");
  }
  log.error("gemini_all_models_failed", { error: errInfo(lastErr) });
  throw new AiUnavailableError();
}
