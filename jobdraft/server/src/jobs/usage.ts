// Daily call counts per job source, shared by every user and process.
import { execute, queryOne } from "../db/pool.js";
import { istDate } from "../lib/time.js";
import type { SourceName } from "./types.js";

/**
 * Takes one call from today's (IST) budget. Atomic: two runs at once can never
 * go over the cap. False when the cap is reached or the source is exhausted.
 */
export async function reserveCall(source: SourceName, cap: number, now: Date): Promise<boolean> {
  const day = istDate(now);
  await execute("INSERT IGNORE INTO api_usage (source, day, calls) VALUES (?, ?, 0)", [source, day]);
  const res = await execute("UPDATE api_usage SET calls = calls + 1 WHERE source = ? AND day = ? AND exhausted = 0 AND calls < ?", [source, day, cap]);
  return res.affectedRows === 1;
}

/** The provider said the plan's quota is used up: no more calls today. */
export async function markExhausted(source: SourceName, now: Date): Promise<void> {
  const day = istDate(now);
  await execute(
    "INSERT INTO api_usage (source, day, calls, exhausted) VALUES (?, ?, 0, 1) ON DUPLICATE KEY UPDATE exhausted = 1",
    [source, day],
  );
}

export async function usageOn(source: SourceName, now: Date): Promise<{ calls: number; exhausted: boolean }> {
  const row = await queryOne<{ calls: number; exhausted: number }>("SELECT calls, exhausted FROM api_usage WHERE source = ? AND day = ?", [source, istDate(now)]);
  return { calls: Number(row?.calls ?? 0), exhausted: !!row?.exhausted };
}
