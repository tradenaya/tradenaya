// JSearch quota: RapidAPI counts calls per key per month (free plan: 200).
// Shared key: each day may use what is left of the month divided by the days
// left, so unused searches carry over instead of being lost, and that day's
// searches are split equally between the active users with automation on.
// A user's own key: their own monthly quota, spread over the month the same way.
import { DateTime } from "luxon";
import { config } from "../config/env.js";
import { execute, query, queryOne } from "../db/pool.js";
import { IST_TZ, istDate } from "../lib/time.js";
import { reserveCall } from "./usage.js";

/** The quota cycle around `now` for a quota that resets on `resetDay`: its first day (IST) and the days left including today. */
export function quotaCycle(now: Date, resetDay: number): { start: string; daysLeft: number } {
  const today = DateTime.fromJSDate(now, { zone: IST_TZ }).startOf("day");
  const resetIn = (month: DateTime) => month.set({ day: Math.min(resetDay, month.daysInMonth ?? 28) });
  let start = resetIn(today);
  if (start > today) start = resetIn(today.minus({ months: 1 }).startOf("month"));
  const next = resetIn(start.plus({ months: 1 }).startOf("month"));
  return { start: start.toISODate()!, daysLeft: Math.max(1, Math.round(next.diff(today, "days").days)) };
}

/** Today's allowance: what is left of the cycle spread evenly over the days left (at least 1 while anything is left). */
export function dailyAllowance(quota: number, usedBeforeToday: number, daysLeft: number): number {
  const left = Math.max(0, quota - usedBeforeToday);
  return left > 0 ? Math.max(1, Math.floor(left / Math.max(1, daysLeft))) : 0;
}

export interface SharedBudget {
  /** Shared-key searches all users together may make today. */
  pool: number;
  /** Users sharing them (active, automation on, Gmail connected, no own working key; plus the user running now). */
  sharers: number;
  /** This user's share of today's pool. */
  share: number;
  usedToday: number;
  usedThisCycle: number;
  quota: number;
  daysLeft: number;
}

/** Users who share the server's key today. */
export async function sharerIds(): Promise<Set<number>> {
  const rows = await query<{ user_id: number }>(
    `SELECT p.user_id FROM profiles p
     JOIN users u ON u.id = p.user_id
     JOIN gmail_connections g ON g.user_id = p.user_id
     WHERE p.automation_enabled = 1 AND u.status = 'active' AND g.status = 'connected' AND g.refresh_token_enc IS NOT NULL
       AND NOT (p.rapidapi_key_enc IS NOT NULL AND p.rapidapi_key_status = 'valid')`,
  );
  return new Set(rows.map((r) => r.user_id));
}

export async function sharedBudget(now: Date, userId?: number): Promise<SharedBudget> {
  const cfg = config();
  const { start, daysLeft } = quotaCycle(now, cfg.jsearchResetDay);
  const today = istDate(now);
  const rows = await query<{ day: string | Date; calls: number }>("SELECT day, calls FROM api_usage WHERE source = 'jsearch' AND day >= ?", [start]);
  let usedBefore = 0;
  let usedToday = 0;
  for (const r of rows) {
    const day = typeof r.day === "string" ? r.day.slice(0, 10) : istDate(new Date(r.day));
    if (day === today) usedToday += Number(r.calls);
    else if (day < today) usedBefore += Number(r.calls);
  }
  let pool = dailyAllowance(cfg.jsearchMonthlyQuota, usedBefore, daysLeft);
  if (cfg.jsearchDailyCap > 0) pool = Math.min(pool, cfg.jsearchDailyCap);
  const ids = await sharerIds();
  const sharers = Math.max(1, ids.size + (userId !== undefined && !ids.has(userId) ? 1 : 0));
  // Equal shares; with more users than searches, the first to run each get one.
  const share = userId === undefined ? pool : pool > 0 ? Math.max(1, Math.floor(pool / sharers)) : 0;
  return { pool, sharers, share, usedToday, usedThisCycle: usedBefore + usedToday, quota: cfg.jsearchMonthlyQuota, daysLeft };
}

async function takeUserCall(userId: number, ownKey: boolean, limit: number, now: Date): Promise<boolean> {
  const day = istDate(now);
  await execute("INSERT IGNORE INTO jsearch_user_usage (user_id, day, own_key, calls) VALUES (?, ?, ?, 0)", [userId, day, ownKey ? 1 : 0]);
  const res = await execute("UPDATE jsearch_user_usage SET calls = calls + 1 WHERE user_id = ? AND day = ? AND own_key = ? AND exhausted = 0 AND calls < ?", [
    userId,
    day,
    ownKey ? 1 : 0,
    limit,
  ]);
  return res.affectedRows === 1;
}

/**
 * One shared-key search: within this user's share and today's pool, both
 * atomic. "share" = this user's share is used; "pool" = today's pool is used
 * (or the provider said the quota is exhausted).
 */
export async function reserveSharedCall(b: SharedBudget, now: Date, userId?: number): Promise<"ok" | "share" | "pool"> {
  if (userId !== undefined && !(await takeUserCall(userId, false, b.share, now))) return "share";
  if (await reserveCall("jsearch", b.pool, now)) return "ok";
  if (userId !== undefined) {
    await execute("UPDATE jsearch_user_usage SET calls = calls - 1 WHERE user_id = ? AND day = ? AND own_key = 0 AND calls > 0", [userId, istDate(now)]);
  }
  return "pool";
}

export interface OwnKeyBudget {
  /** Searches on the user's own key today. */
  allowance: number;
  usedToday: number;
  usedThisCycle: number;
  quota: number;
  daysLeft: number;
  /** The provider said this key's quota is used up (today). */
  exhausted: boolean;
}

/**
 * The user's own key. RapidAPI's monthly cycle starts on the day they
 * subscribed, which is about when they saved the key, so that day of the month
 * is used as the reset day. Calls made with an earlier key don't count.
 */
export async function ownKeyBudget(userId: number, keySavedAt: Date | null, now: Date): Promise<OwnKeyBudget> {
  const saved = keySavedAt ? new Date(keySavedAt) : null;
  const resetDay = saved ? DateTime.fromJSDate(saved, { zone: IST_TZ }).day : 1;
  const { start, daysLeft } = quotaCycle(now, resetDay);
  const from = saved && istDate(saved) > start ? istDate(saved) : start;
  const today = istDate(now);
  const rows = await query<{ day: string | Date; calls: number; exhausted: number }>(
    "SELECT day, calls, exhausted FROM jsearch_user_usage WHERE user_id = ? AND own_key = 1 AND day >= ?",
    [userId, from],
  );
  let usedBefore = 0;
  let usedToday = 0;
  let exhausted = false;
  for (const r of rows) {
    const day = typeof r.day === "string" ? r.day.slice(0, 10) : istDate(new Date(r.day));
    if (day === today) {
      usedToday += Number(r.calls);
      exhausted = !!r.exhausted;
    } else if (day < today) usedBefore += Number(r.calls);
  }
  const quota = config().jsearchOwnKeyMonthlyQuota;
  return { allowance: dailyAllowance(quota, usedBefore, daysLeft), usedToday, usedThisCycle: usedBefore + usedToday, quota, daysLeft, exhausted };
}

export function reserveOwnCall(userId: number, b: OwnKeyBudget, now: Date): Promise<boolean> {
  return takeUserCall(userId, true, b.allowance, now);
}

/** RapidAPI said the user's own key has no quota left: don't use it again today. */
export async function markOwnKeyExhausted(userId: number, now: Date): Promise<void> {
  await execute(
    "INSERT INTO jsearch_user_usage (user_id, day, own_key, calls, exhausted) VALUES (?, ?, 1, 0, 1) ON DUPLICATE KEY UPDATE exhausted = 1",
    [userId, istDate(now)],
  );
}

/** Shared-key searches this user made today (for the Setup page). */
export async function sharedCallsToday(userId: number, now: Date): Promise<number> {
  const row = await queryOne<{ calls: number }>("SELECT calls FROM jsearch_user_usage WHERE user_id = ? AND day = ? AND own_key = 0", [userId, istDate(now)]);
  return Number(row?.calls ?? 0);
}
