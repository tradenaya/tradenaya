import { TechnicalIndicatorEngine } from "@/automation/indicators/indicator-engine";
import type { MarketCandle } from "@/automation/types";

/**
 * Adaptive validity check for a resting (unfilled) entry order.
 *
 * A limit entry that never fills should not hang until a fixed clock: the
 * decision to keep waiting is re-evaluated against live market conditions.
 * Hard signals (trend flip, adverse ATR drift, stop-loss-zone breach) cancel
 * immediately; softer signals (momentum divergence, weak conviction) only
 * cancel in combination. Age is a backstop, never the sole trigger.
 */

export interface EntryValidityContext {
  side: "BUY" | "SELL";
  /** Resting limit price of the entry order. When null the entry cannot be judged — keep. */
  limitPrice: number | null;
  /** Planned stop-loss for the trade. Could be null only if the plan had none. */
  stopLoss: number | null;
  marketPrice: number;
  ageMs: number;
  /** Base analysis timeframe in minutes (e.g. 5 for 5m candles). */
  timeframeMinutes: number;
  candles: MarketCandle[];
  higherTimeframeCandles?: MarketCandle[];
  /** ATR multiplier for the adverse-drift rule. Stops cancelling a resting entry on small wiggles; only cancels once price has crossed well past the entry zone. Default 2.5. */
  driftAtr?: number;
  /** Drift band expressed as percentage of limit price (e.g. 0.005 = 0.5%). Overrides the ATR-based band if set. */
  driftPctPct?: number;
  /** Soft age factor (candles) — cancels only in combination with another soft signal. Default 24. */
  maxCandles?: number;
  /** Absolute circuit-breaker (candles) — safety net so a resting order can never sit forever. Default 48. */
  hardCapCandles?: number;
  /** Ignore regime flips smaller than this % (filters EMA noise). Default 0.3. */
  regimeTolerancePct?: number;
}

export interface EntryValidityResult {
  keep: boolean;
  reason: string | null;
  hard: string[];
  soft: string[];
}

export const DEFAULT_VALIDITY_OPTIONS = {
  // A resting entry is allowed to drift this far (×ATR) past its limit before
  // being treated as a broken entry zone. 2.5× lets the bot survive normal
  // wiggles and wait for a real pullback instead of cancelling on the first
  // small adverse move in a trending market.
  driftAtr: 2.5,
  /** Floor band as a fraction of limit price (e.g. 0.005 = 0.5%). Prevents cancelling on tiny wiggles in dead/low-vol markets. */
  minDriftPct: 0.005,
  /** ADX threshold above which the trend is considered "strong". */
  strongTrendAdx: 25,
  /** Extra patience multiplier applied to the drift band in a strong trend aligned with the entry side. */
  trendPatienceFactor: 1.5,
  maxCandles: 24,
  hardCapCandles: 48,
  rsiOverbought: 80,
  rsiOversold: 20,
  minAdx: 15,
} as const;

const engine = new TechnicalIndicatorEngine();

export function evaluateEntryValidity(ctx: EntryValidityContext): EntryValidityResult {
  const hard: string[] = [];
  const soft: string[] = [];

  if (!ctx.limitPrice || !Number.isFinite(ctx.limitPrice) || ctx.candles.length === 0) {
    return { keep: true, reason: null, hard, soft };
  }

  const base = engine.compute(ctx.candles);
  const htf = ctx.higherTimeframeCandles && ctx.higherTimeframeCandles.length > 0
    ? engine.compute(ctx.higherTimeframeCandles)
    : null;

  // 1) Structure & regime alignment.
  const regimeTol = (ctx.regimeTolerancePct ?? 0.3) / 100;
  if (base.ema20 != null && base.ema50 != null) {
    if (ctx.side === "BUY" && base.ema20 < base.ema50 * (1 - regimeTol)) {
      hard.push(`base trend flipped bearish (EMA20 ${base.ema20.toFixed(2)} < EMA50 ${base.ema50.toFixed(2)}; ${(100 * (base.ema20 - base.ema50) / base.ema50).toFixed(2)}% under EMA50)`);
    }
    if (ctx.side === "SELL" && base.ema20 > base.ema50 * (1 + regimeTol)) {
      hard.push(`base trend flipped bullish (EMA20 ${base.ema20.toFixed(2)} > EMA50 ${base.ema50.toFixed(2)}; ${(100 * (base.ema20 - base.ema50) / base.ema50).toFixed(2)}% above EMA50)`);
    }
  }
  if (htf && htf.ema20 != null && htf.ema50 != null) {
    if (ctx.side === "BUY" && htf.ema20 < htf.ema50 * (1 - regimeTol)) {
      hard.push(`higher-timeframe regime flipped down (HTF EMA20 ${htf.ema20.toFixed(2)} < EMA50 ${htf.ema50.toFixed(2)}; ${(100 * (htf.ema20 - htf.ema50) / htf.ema50).toFixed(2)}% under EMA50)`);
    }
    if (ctx.side === "SELL" && htf.ema20 > htf.ema50 * (1 + regimeTol)) {
      hard.push(`higher-timeframe regime flipped up (HTF EMA20 ${htf.ema20.toFixed(2)} > EMA50 ${htf.ema50.toFixed(2)}; ${(100 * (htf.ema20 - htf.ema50) / htf.ema50).toFixed(2)}% above EMA50)`);
    }
  }

  // 2) Adverse drift -- the "lost rhythm / breakout" case.
  // The band auto-adapts to the market so the same rule behaves sensibly in BOTH
  // quiet and roaring, dead and trending price action:
  //   - base = driftAtr * ATR  -> scales with CURRENT volatility (wide when volatile,
  //     tight when quiet);
  //   - minDriftPct floor      -> stops tiny wiggles in dead/low-vol markets from
  //     cancelling a resting entry;
  //   - trendPatienceFactor    -> widens the band when the regime is strongly aligned
  //     with the entry side, because trending markets often keep running before a
  //     pullback materialises (wait, don't bail and miss it).
  const driftAtrUsed = ctx.driftAtr ?? DEFAULT_VALIDITY_OPTIONS.driftAtr;
  const atr = base.atr ?? 0;
  const minDriftPct = ctx.minDriftPct ?? DEFAULT_VALIDITY_OPTIONS.minDriftPct;
  let band = driftAtrUsed * atr;
  if (ctx.limitPrice > 0 && band < minDriftPct * ctx.limitPrice) {
    band = minDriftPct * ctx.limitPrice;
  }
  if (
    base.adx != null &&
    base.adx >= DEFAULT_VALIDITY_OPTIONS.strongTrendAdx &&
    base.ema20 != null &&
    base.ema50 != null &&
    base.ema20 > 0 &&
    base.ema50 > 0
  ) {
    const aligned = ctx.side === "BUY" ? base.ema20 > base.ema50 : base.ema20 < base.ema50;
    if (aligned) band *= DEFAULT_VALIDITY_OPTIONS.trendPatienceFactor;
  }
  if (band > 0) {
    if (ctx.side === "BUY" && ctx.marketPrice > ctx.limitPrice + band) {
      const movePct = (100 * (ctx.marketPrice - ctx.limitPrice) / ctx.limitPrice).toFixed(1);
      const moves = ((ctx.marketPrice - ctx.limitPrice) / band).toFixed(1);
      hard.push(`price moved ${movePct}% above the buy level (${moves}x drift band = ${driftAtrUsed}xATR(${atr.toFixed(2)}); entry zone broken)`);
    }
    if (ctx.side === "SELL" && ctx.marketPrice < ctx.limitPrice - band) {
      const movePct = (100 * (ctx.limitPrice - ctx.marketPrice) / ctx.limitPrice).toFixed(1);
      const moves = ((ctx.limitPrice - ctx.marketPrice) / band).toFixed(1);
      hard.push(`price moved ${movePct}% below the sell level (${moves}x drift band = ${driftAtrUsed}xATR(${atr.toFixed(2)}); entry zone broken)`);
    }
  }

  // 3) Stop-loss zone breach before fill.
  if (ctx.stopLoss != null) {
    if (ctx.side === "BUY" && ctx.marketPrice <= ctx.stopLoss) hard.push("price breached stop-loss zone before fill");
    if (ctx.side === "SELL" && ctx.marketPrice >= ctx.stopLoss) hard.push("price breached stop-loss zone before fill");
  }

  // 4) Momentum divergence (soft).
  if (base.rsi != null) {
    if (ctx.side === "BUY" && base.rsi > DEFAULT_VALIDITY_OPTIONS.rsiOverbought) soft.push(`overbought (RSI ${base.rsi.toFixed(1)}) — pullback unlikely`);
    if (ctx.side === "SELL" && base.rsi < DEFAULT_VALIDITY_OPTIONS.rsiOversold) soft.push(`oversold (RSI ${base.rsi.toFixed(1)}) — rally unlikely`);
  }
  if (base.adx != null && base.adx < DEFAULT_VALIDITY_OPTIONS.minAdx) soft.push(`weak trend conviction (ADX ${base.adx.toFixed(1)})`);

  // 5) Time. Soft factor (needs another soft vote) + absolute safety-net cap.
  const frameMs = ctx.timeframeMinutes > 0 ? ctx.timeframeMinutes * 60_000 : 60_000;
  const candlesElapsed = ctx.ageMs > 0 && frameMs > 0 ? ctx.ageMs / frameMs : 0;
  const maxCandles = ctx.maxCandles ?? DEFAULT_VALIDITY_OPTIONS.maxCandles;
  const hardCapCandles = ctx.hardCapCandles ?? DEFAULT_VALIDITY_OPTIONS.hardCapCandles;
  if (candlesElapsed >= maxCandles) soft.push(`sitting ${Math.floor(candlesElapsed)} candles (backstop ${maxCandles})`);
  if (candlesElapsed >= hardCapCandles) hard.push(`sitting ${Math.floor(candlesElapsed)} candles — circuit-breaker cap ${hardCapCandles}`);

  const keep = !(hard.length > 0 || soft.length >= 2);
  const reason = hard.length > 0 || soft.length >= 2
    ? [...hard, ...soft].join("; ")
    : null;
  return { keep, reason, hard, soft };
}