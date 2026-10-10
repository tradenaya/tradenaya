import { normalizeInterval } from "@/automation/market/normalizer";

/**
 * Default lifetime of an unfilled LIMIT entry: one candle of the entry
 * timeframe, never less than 30 minutes (5m/15m -> 30 min, 1h -> 60 min,
 * 4h -> 240 min). The setup is read from the last closed candle; an entry that
 * has not filled by the next candle is usually a setup that has moved on.
 * Backtests: 1h/15m with a 1-candle/30-min expiry outperformed the old fixed
 * 120 minutes in both halves of the test period.
 *
 * Pure module (no server imports) so bot settings screens can show the value.
 */
export function defaultEntryExpiryMinutes(timeframe?: string): number {
  const minutes = timeframe ? normalizeInterval(timeframe) : null;
  return Math.max(30, minutes ?? 120);
}
