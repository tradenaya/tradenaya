// A user's own RapidAPI key for JSearch (optional): checked with one real
// search, stored encrypted, and used for that user's JSearch searches with its
// own monthly quota. Without one, the user shares the server's key.
import { z } from "zod";
import { config } from "../config/env.js";
import { execute } from "../db/pool.js";
import { clock } from "../lib/clock.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { HttpError } from "../lib/errors.js";
import { istDate } from "../lib/time.js";
import { markOwnKeyExhausted } from "./jsearch-budget.js";
import { JSEARCH_HOST, jsearchParams } from "./jsearch.js";

/** The JSearch page on RapidAPI, on its Pricing tab (where the free Basic plan is subscribed). */
export const JSEARCH_SUBSCRIBE_URL = "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing";
/** Where RapidAPI shows the key (the "Playground" of the JSearch page). */
export const JSEARCH_PLAYGROUND_URL = "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/playground";

export type JSearchKeyStatus = "valid" | "not_subscribed" | "invalid";

/**
 * People copy the key from RapidAPI's code samples, so a pasted
 * `'x-rapidapi-key': 'abc…',` or `X-RapidAPI-Key: abc…` is reduced to the key.
 */
export function cleanJSearchKey(raw: string): string {
  return raw
    .trim()
    .replace(/^["']?x-rapidapi-key["']?\s*[:=]\s*/i, "")
    .replace(/[,;]$/, "")
    .replace(/^["'](.*)["']$/, "$1")
    .trim();
}

export const jsearchKeySchema = z
  .string({ error: "Paste your RapidAPI key." })
  .transform(cleanJSearchKey)
  .refine((v) => v.length > 0, "Paste your RapidAPI key.")
  // Loose on purpose: RapidAPI decides whether the key works.
  .refine((v) => /^\S{20,200}$/.test(v), "That doesn't look like a RapidAPI key. Copy the long value next to X-RapidAPI-Key.");

export type KeyCheck = { status: JSearchKeyStatus } | { status: "quota_used" };

type Verifier = (key: string) => Promise<KeyCheck>;
let verifier: Verifier | null = null;
/** Tests can simulate RapidAPI's answers. */
export function setJSearchKeyVerifierForTests(fn: Verifier | null) {
  verifier = fn;
}

/** RapidAPI answers 403 for both a wrong key and a key that isn't subscribed to the API; the message tells them apart. */
export function classifyRapidApiRefusal(status: number, message: string): JSearchKeyStatus | null {
  if (status === 403 && /not subscribed/i.test(message)) return "not_subscribed";
  if (status === 401 || status === 403) return "invalid";
  return null;
}

/** One real search (it uses 1 of the key's monthly searches). */
async function verifyWithRapidApi(key: string): Promise<KeyCheck> {
  const res = await fetch(`https://${JSEARCH_HOST}/search-v2?${jsearchParams({ query: "software developer in Bengaluru, India" })}`, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": JSEARCH_HOST },
    signal: AbortSignal.timeout(20000),
  });
  if (res.ok) return { status: "valid" };
  if (res.status === 429) return { status: "quota_used" };
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  const refused = classifyRapidApiRefusal(res.status, String(body?.message ?? ""));
  if (refused) return { status: refused };
  throw new Error(`RapidAPI answered ${res.status}`);
}

/** Mock mode: every well-formed key works, except one containing "notsubscribed" (for the end-to-end tests). */
async function mockVerify(key: string): Promise<KeyCheck> {
  return { status: /notsubscribed/i.test(key) ? "not_subscribed" : "valid" };
}

export type SavedCheck = "valid" | "quota_used" | "not_subscribed";

/**
 * Checks the key with RapidAPI. Rejected → 400; RapidAPI unreachable → 503.
 * "not_subscribed" = a real key that still needs the free plan (saved, so the
 * user only has to subscribe and check again); "quota_used" = it works but this
 * month's searches are used up (saved anyway).
 */
export async function checkJSearchKey(key: string): Promise<SavedCheck> {
  const verify = verifier ?? (config().mockExternal ? mockVerify : verifyWithRapidApi);
  let result: KeyCheck;
  try {
    result = await verify(key);
  } catch {
    throw new HttpError(503, "Couldn't reach RapidAPI to check the key. Please try again in a minute.");
  }
  if (result.status === "invalid") {
    throw new HttpError(400, "RapidAPI didn't accept this key. Copy the whole value next to X-RapidAPI-Key and paste it again.", "validation", { key: "RapidAPI didn't accept this key." });
  }
  return result.status;
}

/**
 * Stores the key encrypted, with only its last 4 characters in clear. A new key
 * starts a new count, and its subscription (so its monthly cycle) starts about now.
 */
export async function saveJSearchKey(userId: number, key: string, check: SavedCheck): Promise<void> {
  const now = clock.now();
  await execute("UPDATE profiles SET rapidapi_key_enc = ?, rapidapi_key_hint = ?, rapidapi_key_status = ?, rapidapi_key_updated_at = ? WHERE user_id = ?", [
    encrypt(key, config().encryptionKey()),
    key.slice(-4),
    check === "not_subscribed" ? "not_subscribed" : "valid",
    now,
    userId,
  ]);
  await execute("DELETE FROM jsearch_user_usage WHERE user_id = ? AND own_key = 1", [userId]);
  await recordCheck(userId, check, now);
}

/** A successful check was a real search: it counts against the key's quota. */
async function recordCheck(userId: number, check: SavedCheck, now: Date) {
  // Refused calls (not subscribed, quota used up) aren't counted by RapidAPI.
  if (check === "quota_used") await markOwnKeyExhausted(userId, now);
  if (check !== "valid") return;
  await execute(
    "INSERT INTO jsearch_user_usage (user_id, day, own_key, calls) VALUES (?, ?, 1, 1) ON DUPLICATE KEY UPDATE calls = calls + 1",
    [userId, istDate(now)],
  );
}

/**
 * Checks the saved key again (after subscribing on RapidAPI). When it now
 * works and was "not subscribed", its monthly cycle starts today.
 */
export async function recheckJSearchKey(userId: number, profile: { rapidApiKeyEnc: string | null; rapidApiKeyStatus: JSearchKeyStatus | null }): Promise<void> {
  if (!profile.rapidApiKeyEnc) throw new HttpError(404, "No RapidAPI key is saved.");
  const key = decrypt(profile.rapidApiKeyEnc, config().encryptionKey());
  let check: SavedCheck;
  try {
    check = await checkJSearchKey(key);
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) await setJSearchKeyStatus(userId, "invalid");
    throw err;
  }
  const now = clock.now();
  const status = check === "not_subscribed" ? "not_subscribed" : "valid";
  if (status === "valid" && profile.rapidApiKeyStatus !== "valid") {
    await execute("UPDATE profiles SET rapidapi_key_status = 'valid', rapidapi_key_updated_at = ? WHERE user_id = ?", [now, userId]);
  } else await setJSearchKeyStatus(userId, status);
  await recordCheck(userId, check, now);
}

export async function removeJSearchKey(userId: number): Promise<void> {
  await execute("UPDATE profiles SET rapidapi_key_enc = NULL, rapidapi_key_hint = NULL, rapidapi_key_status = NULL, rapidapi_key_updated_at = NULL WHERE user_id = ?", [userId]);
  await execute("DELETE FROM jsearch_user_usage WHERE user_id = ? AND own_key = 1", [userId]);
}

/** RapidAPI refused the saved key during a run: the user is asked to fix it on Setup. */
export async function setJSearchKeyStatus(userId: number, status: JSearchKeyStatus): Promise<void> {
  await execute("UPDATE profiles SET rapidapi_key_status = ? WHERE user_id = ? AND rapidapi_key_enc IS NOT NULL", [status, userId]);
}

/** The decrypted key when one is saved and RapidAPI accepted it last time, else null. */
export function usableJSearchKey(profile: { rapidApiKeyEnc: string | null; rapidApiKeyStatus: JSearchKeyStatus | null }): string | null {
  if (!profile.rapidApiKeyEnc || profile.rapidApiKeyStatus !== "valid") return null;
  return decrypt(profile.rapidApiKeyEnc, config().encryptionKey());
}
