/**
 * Strong-momentum entry filter.
 *
 * Backtests of TRADENAYA_SMART_V1 found that the only consistently profitable
 * subset of its signals were entries where momentum was already extreme in the
 * trade's direction (RSI14 >= 80 for a long, <= 20 for a short): trend
 * continuation, not mean reversion. Every other subset was roughly break-even
 * before fees. The filter keeps those entries and skips the rest.
 *
 * It is ALWAYS on for Smart (Nov 2026 replay, 6 majors, Nov 2024 – Nov 2026,
 * live rules): without it, 1,351 trades averaged -0.02R after fees (49–82%
 * drawdowns at 5% risk); with it +0.14R. Old bot settings with the filter off
 * are ignored.
 */
export const MOMENTUM_RSI_THRESHOLD = 80;

/**
 * A momentum entry also needs a momentum CANDLE: the signal candle's body must
 * be at least this many ATRs. Small-body signals lost in both halves of the
 * replay (year 1: -0.24R/trade, 26% win; year 2: -0.12R, 30% win).
 */
export const MIN_MOMENTUM_BODY_ATR = 0.6;

export function passesMomentumFilter(side: "BUY" | "SELL" | "LONG" | "SHORT", rsi: number | null | undefined, threshold = MOMENTUM_RSI_THRESHOLD): boolean {
  const value = Number(rsi);
  if (!Number.isFinite(value)) return false;
  const long = side === "BUY" || side === "LONG";
  return long ? value >= threshold : value <= 100 - threshold;
}

/** The signal candle has a real body (≥ MIN_MOMENTUM_BODY_ATR × ATR). Unknown ATR never blocks. */
export function hasMomentumBody(candle: { open: number; close: number } | undefined, atr: number | null | undefined): boolean {
  if (!candle || !(Number(atr) > 0)) return true;
  return Math.abs(candle.close - candle.open) / Number(atr) >= MIN_MOMENTUM_BODY_ATR - 1e-9;
}
