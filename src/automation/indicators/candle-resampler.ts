import type { MarketCandle } from "@/automation/types";
import { normalizeInterval } from "@/automation/market/normalizer";

/**
 * Deterministic candle-to-candle resampling for multi-timeframe analysis.
 *
 * The live market data service can only fetch one timeframe per request and the
 * backtest engine only holds a single historical timeframe, so higher-timeframe
 * candles are derived from the entry-timeframe candles by aggregation. Buckets
 * are aligned to the target timeframe grid (buckets always start at a multiple
 * of the target interval) and only COMPLETED buckets are emitted. A bucket is
 * completed when its last source candle closes on or before the bucket end, so
 * a partially-formed live bucket is never used — the strategy can never observe
 * a higher-timeframe candle that has not fully closed.
 *
 * Because the rule is based purely on candle timestamps and closes, live and
 * backtest produce identical higher-timeframe series for the same closed
 * candles. This is the structural guard against look-ahead bias for the
 * multi-timeframe factors.
 */
export function resampleCandles(candles: MarketCandle[], targetMinutes: number, sourceMinutes: number): MarketCandle[] {
  if (candles.length === 0) return [];

  if (targetMinutes <= 0 || sourceMinutes <= 0) return [];
  if (targetMinutes === sourceMinutes) return candles.slice();
  if (targetMinutes < sourceMinutes || targetMinutes % sourceMinutes !== 0) return [];

  const targetMs = targetMinutes * 60_000;
  const sourceMs = sourceMinutes * 60_000;

  const result: MarketCandle[] = [];
  let current: MarketCandle | null = null;

  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / targetMs) * targetMs;

    if (current === null || current.timestamp !== bucketStart) {
      if (current !== null) result.push(current);
      current = {
        timestamp: bucketStart,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        timeframe: String(targetMinutes),
      };
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    }
  }

  // The final bucket is only complete once its whole window has elapsed: the
  // last source candle must have closed at or after the bucket end. A bucket
  // whose last candle closed mid-window is still forming and is dropped.
  const lastSource = candles[candles.length - 1];
  if (current !== null && lastSource.timestamp + sourceMs >= current.timestamp + targetMs) {
    result.push(current);
  }

  return result;
}

/**
 * Resample using timeframe labels ("5m", "1h"). Returns null when the target
 * is not a clean integer multiple of the source interval.
 */
export function resampleByLabel(candles: MarketCandle[], targetLabel: string, sourceLabel: string): MarketCandle[] | null {
  const target = normalizeInterval(targetLabel);
  const source = normalizeInterval(sourceLabel);
  if (target === null || source === null) return null;
  return resampleCandles(candles, target, source);
}
