// Each user's own Gemini API key: checked with Google, stored encrypted, and
// used for that user's resume reading, job screening, emails and follow-ups.
import { z } from "zod";
import { config } from "../config/env.js";
import { execute } from "../db/pool.js";
import { clock } from "../lib/clock.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { AiKeyRejectedError, verifyGeminiKey } from "./gemini.js";

/** Where users create a key (free, signed in with Google). */
export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

export const geminiKeySchema = z
  .string({ error: "Paste your Gemini API key." })
  .trim()
  .min(1, "Paste your Gemini API key.")
  // Loose on purpose: Google key formats change; Google itself decides whether it works.
  .refine((v) => /^\S{20,300}$/.test(v), "That doesn't look like a Gemini API key. Copy the whole key from Google AI Studio.");

type Verifier = (key: string) => Promise<void>;
let verifier: Verifier | null = null;
/** Tests can simulate Google accepting or rejecting a key. */
export function setKeyVerifierForTests(fn: Verifier | null) {
  verifier = fn;
}

/**
 * Asks Google whether the key works (in mock mode every well-formed key does).
 * Bad key → 400 on the key field; Google unreachable → 503.
 */
export async function checkGeminiKey(key: string, field = "geminiKey"): Promise<void> {
  const verify = verifier ?? (config().mockExternal ? async () => undefined : verifyGeminiKey);
  try {
    await verify(key);
  } catch (err) {
    if (err instanceof AiKeyRejectedError) {
      throw new HttpError(400, "Google rejected this key. Check you copied the whole key, or create a new one.", "validation", { [field]: "Google rejected this key." });
    }
    throw new HttpError(503, err instanceof Error ? err.message : "Couldn't check the key. Please try again.");
  }
}

/** Stores the key encrypted, with only its last 4 characters in clear. */
export async function saveGeminiKey(userId: number, key: string): Promise<void> {
  await execute("UPDATE profiles SET gemini_key_enc = ?, gemini_key_hint = ?, gemini_key_status = 'valid', gemini_key_updated_at = ? WHERE user_id = ?", [
    encrypt(key, config().encryptionKey()),
    key.slice(-4),
    clock.now(),
    userId,
  ]);
}

export async function removeGeminiKey(userId: number): Promise<void> {
  await execute("UPDATE profiles SET gemini_key_enc = NULL, gemini_key_hint = NULL, gemini_key_status = NULL, gemini_key_updated_at = ? WHERE user_id = ?", [
    clock.now(),
    userId,
  ]);
}

/** Google rejected the saved key during a run: the user is asked to update it. */
export async function markGeminiKeyInvalid(userId: number): Promise<void> {
  await execute("UPDATE profiles SET gemini_key_status = 'invalid' WHERE user_id = ? AND gemini_key_enc IS NOT NULL", [userId]);
}

/** The decrypted key, or null when none is saved. */
export function geminiKeyOf(profile: { geminiKeyEnc: string | null }): string | null {
  return profile.geminiKeyEnc ? decrypt(profile.geminiKeyEnc, config().encryptionKey()) : null;
}
