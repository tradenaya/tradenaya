import type { MarketCandle } from "@/automation/types";

/**
 * Candlestick and chart pattern detection.
 *
 * Pure functions of the candle array. Patterns are reported on the LAST
 * (currently forming) candle where that makes sense, using the most recent
 * closed candles. We avoid using the in-progress candle's body as a signal —
 * only confirmed bodies and wicks.
 */

export interface PatternSignal {
  /** Pattern reason code (stable, lower-kebab). */
  code: string;
  /** Positive => bullish, negative => bearish, 0 => neutral. */
  direction: 1 | -1 | 0;
  /** Confidence magnitude in [0,1]. */
  strength: number;
}

const bodySize = (c: MarketCandle): number => Math.abs(c.close - c.open);
const candleRange = (c: MarketCandle): number => Math.max(c.high - c.low, 1e-9);
const upperWick = (c: MarketCandle): number => c.high - Math.max(c.open, c.close);
const lowerWick = (c: MarketCandle): number => Math.min(c.open, c.close) - c.low;

/** Bulls may be present / signal direction of the most recent closed candle. */
export function lastTwo(candles: MarketCandle[]): MarketCandle[] {
  return candles.slice(-2);
}

export function detectBullishEngulfing(candles: MarketCandle[]): PatternSignal | null {
  const [prev, curr] = lastTwo(candles);
  if (!prev || !curr) return null;
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  if (!prevBearish || !currBullish) return null;
  if (curr.close > prev.open && curr.open < prev.close) {
    return { code: "pattern-bullish-engulfing", direction: 1, strength: 0.9 };
  }
  return null;
}

export function detectBearishEngulfing(candles: MarketCandle[]): PatternSignal | null {
  const [prev, curr] = lastTwo(candles);
  if (!prev || !curr) return null;
  const prevBullish = prev.close > prev.open;
  const currBearish = curr.close < curr.open;
  if (!prevBullish || !currBearish) return null;
  if (curr.close < prev.open && curr.open > prev.close) {
    return { code: "pattern-bearish-engulfing", direction: -1, strength: 0.9 };
  }
  return null;
}

/** Hammer: small body near the top, long lower wick, little/no upper wick. */
export function detectHammer(candles: MarketCandle[]): PatternSignal | null {
  const curr = candles[candles.length - 1];
  if (!curr) return null;
  const range = candleRange(curr);
  const body = bodySize(curr);
  if (body / range > 0.4) return null;
  if (lowerWick(curr) >= 2 * body && upperWick(curr) <= body * 0.5) {
    return { code: "pattern-hammer", direction: 1, strength: 0.7 };
  }
  return null;
}

/** Shooting star: small body near the bottom, long upper wick. */
export function detectShootingStar(candles: MarketCandle[]): PatternSignal | null {
  const curr = candles[candles.length - 1];
  if (!curr) return null;
  const range = candleRange(curr);
  const body = bodySize(curr);
  if (body / range > 0.4) return null;
  if (upperWick(curr) >= 2 * body && lowerWick(curr) <= body * 0.5) {
    return { code: "pattern-shooting-star", direction: -1, strength: 0.7 };
  }
  return null;
}

/** Doji: body is a tiny fraction of the range — indecision. */
export function detectDoji(candles: MarketCandle[]): PatternSignal | null {
  const curr = candles[candles.length - 1];
  if (!curr) return null;
  const range = candleRange(curr);
  const body = bodySize(curr);
  if (body / range < 0.1) {
    return { code: "pattern-doji", direction: 0, strength: 0.3 };
  }
  return null;
}

/** Pin bar (rejection): long wick on one side with a small opposite-side wick. */
export function detectPinBar(candles: MarketCandle[]): PatternSignal | null {
  const curr = candles[candles.length - 1];
  if (!curr) return null;
  const range = candleRange(curr);
  const body = bodySize(curr);
  if (body / range > 0.35) return null;
  const longUpper = upperWick(curr) >= 2 * body && lowerWick(curr) <= body * 0.6;
  const longLower = lowerWick(curr) >= 2 * body && upperWick(curr) <= body * 0.6;
  if (longUpper) return { code: "pattern-pin-bar", direction: -1, strength: 0.75 };
  if (longLower) return { code: "pattern-pin-bar", direction: 1, strength: 0.75 };
  return null;
}

/**
 * Simple double top / double bottom detection across the given window using
 * swing highs and lows. Returns the pressure direction.
 */
export function detectDoublePattern(
  candles: MarketCandle[],
  window = 40,
  toleranceAtr?: number,
  atrValue?: number,
): PatternSignal | null {
  const start = Math.max(0, candles.length - window);
  const slice = candles.slice(start);
  if (slice.length < 8) return null;

  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const tol = toleranceAtr != null && atrValue != null && atrValue > 0 ? toleranceAtr * atrValue : 0;
  const price = candles[candles.length - 1].close;

  // Find two recent comparable swing highs (double top) and swing lows (double bottom).
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < slice.length - 2; i += 1) {
    if (highs[i] >= highs[i - 1] && highs[i] >= highs[i - 2] && highs[i] >= highs[i + 1] && highs[i] >= highs[i + 2]) {
      swingHighs.push(highs[i]);
    }
    if (lows[i] <= lows[i - 1] && lows[i] <= lows[i - 2] && lows[i] <= lows[i + 1] && lows[i] <= lows[i + 2]) {
      swingLows.push(lows[i]);
    }
  }

  if (swingHighs.length >= 2) {
    const last = swingHighs[swingHighs.length - 1];
    const prev = swingHighs[swingHighs.length - 2];
    if (Math.abs(last - prev) <= tol && price <= last) {
      return { code: "pattern-double-top", direction: -1, strength: 0.65 };
    }
  }
  if (swingLows.length >= 2) {
    const last = swingLows[swingLows.length - 1];
    const prev = swingLows[swingLows.length - 2];
    if (Math.abs(last - prev) <= tol && price >= last) {
      return { code: "pattern-double-bottom", direction: 1, strength: 0.65 };
    }
  }
  return null;
}

/** Aggregate all pattern signals for the current candle into a list. */
export function detectPatterns(
  candles: MarketCandle[],
  atrValue?: number,
  window = 40,
): PatternSignal[] {
  const signals: PatternSignal[] = [];
  const add = (signal: PatternSignal | null): void => {
    if (signal) signals.push(signal);
  };
  add(detectBullishEngulfing(candles));
  add(detectBearishEngulfing(candles));
  add(detectHammer(candles));
  add(detectShootingStar(candles));
  add(detectDoji(candles));
  add(detectPinBar(candles));
  add(detectDoublePattern(candles, window, 0.35, atrValue));
  return signals;
}
