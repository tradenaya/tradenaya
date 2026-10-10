/**
 * Strong-momentum entry filter.
 *
 * Backtests of TRADENAYA_SMART_V1 found that the only consistently profitable
 * subset of its signals were entries where momentum was already extreme in the
 * trade's direction (RSI14 >= 80 for a long, <= 20 for a short): trend
 * continuation, not mean reversion. Every other subset was roughly break-even
 * before fees. The filter keeps those entries and skips the rest.
 */
export const MOMENTUM_RSI_THRESHOLD = 80;

export function passesMomentumFilter(side: "BUY" | "SELL" | "LONG" | "SHORT", rsi: number | null | undefined, threshold = MOMENTUM_RSI_THRESHOLD): boolean {
  const value = Number(rsi);
  if (!Number.isFinite(value)) return false;
  const long = side === "BUY" || side === "LONG";
  return long ? value >= threshold : value <= 100 - threshold;
}
