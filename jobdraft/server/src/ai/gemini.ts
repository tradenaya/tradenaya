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
 * unknown model) move on to the next model. Returns the parsed JSON.
 */
export async function geminiGenerateJson(req: GenerateRequest): Promise<unknown> {
  const { gemini } = config();
  if (!gemini.apiKey) throw new AiUnavailableError("AI (Gemini) is not configured.");
  if (!client || clientKey !== gemini.apiKey) {
    client = new GoogleGenAI({ apiKey: gemini.apiKey });
    clientKey = gemini.apiKey;
  }
  let lastErr: unknown;
  for (const model of gemini.models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
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
        const status = statusOf(err);
        if (status === 401 || status === 403) {
          log.error("gemini_auth_error", { model, status });
          throw new AiUnavailableError("The Gemini API key was rejected. Check GEMINI_API_KEY.");
        }
        const retryable = status === 429 || status === 500 || status === 503 || status === 504;
        log.warn("gemini_call_failed", { model, attempt, status, error: errInfo(err) });
        if (retryable && attempt < 3) {
          await sleep(Math.min(2000 * 2 ** (attempt - 1), 10000) + Math.floor(Math.random() * 500));
          continue;
        }
        break; // next model
      }
    }
  }
  log.error("gemini_all_models_failed", { error: errInfo(lastErr) });
  throw new AiUnavailableError();
}
