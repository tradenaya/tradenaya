import type { MarketCandle } from "@/automation/types";
import {
  adxSeries,
  atrSeries,
  bollingerSeries,
  clamp,
  emaSeries,
  lastValue,
  macdSeries,
  previousValue,
  rocSeries,
  rsiSeries,
  smaSeries,
  supertrendSeries,
  vwapSeries,
  type Series,
  type MacdSeries,
  type BollingerSeries,
  type SupertrendSeries,
} from "@/automation/indicators/series";
import { REASON, type ReasonCode, type TradiAuraThresholds } from "./config";
import type { FactorResult, MarketView, SupportResistanceLevels, SwingPoint, TrendDirection } from "./types";

/**
 * Market structure + trend + momentum factors for TRADIAURA_SMART_V1.
 *
 * Every factor is a pure function of the MarketView (derived solely from the
 * closed candles it receives). Signed scores are positive for LONG and negative
 * for SHORT. No factor reads wall-clock time, randomness or anything outside
 * the candles, which is what makes the algorithm deterministic.
 */

// ---------------------------------------------------------------------------
// Market view construction
// ---------------------------------------------------------------------------

export function detectSwings(highs: number[], lows: number[], lookback: number): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const result: { highs: SwingPoint[]; lows: SwingPoint[] } = { highs: [], lows: [] };
  if (lookback <= 0) return result;

  for (let i = lookback; i < highs.length - lookback; i += 1) {
    let isHigh = true;
    let isLow = true;
    let greater = false;
    let lesser = false;
    for (let j = i - lookback; j <= i + lookback; j += 1) {
      if (highs[j] > highs[i]) isHigh = false;
      if (highs[j] !== highs[i]) greater = greater || highs[j] < highs[i];
      if (lows[j] < lows[i]) isLow = false;
      if (lows[j] !== lows[i]) lesser = lesser || lows[j] > lows[i];
    }
    if (isHigh && greater) result.highs.push({ index: i, price: highs[i] });
    if (isLow && lesser) result.lows.push({ index: i, price: lows[i] });
  }
  return result;
}

function nearestLevel(points: SwingPoint[], price: number, below: boolean, clusterAtr: number, atrValue: number): number | undefined {
  const relevant = points.filter((point) => (below ? point.price <= price : point.price >= price));
  if (relevant.length === 0) return undefined;
  // For support (below): highest level first. For resistance (above): lowest first.
  relevant.sort((a, b) => (below ? b.price - a.price : a.price - b.price));
  const best = relevant[0];
  for (const point of relevant.slice(1)) {
    if (Math.abs(point.price - best.price) > clusterAtr * atrValue) break;
  }
  return best.price;
}

export function detectSupportResistance(
  candles: MarketCandle[],
  swings: { highs: SwingPoint[]; lows: SwingPoint[] },
  price: number,
  atrValue: number,
  thresholds: TradiAuraThresholds,
): SupportResistanceLevels {
  const start = Math.max(0, candles.length - thresholds.supportResistanceWindow);
  const swingHighs = swings.highs.filter((s) => s.index >= start);
  const swingLows = swings.lows.filter((s) => s.index >= start);

  const resistance = nearestLevel(swingHighs, price, false, thresholds.srClusterAtr, atrValue);
  const support = nearestLevel(swingLows, price, true, thresholds.srClusterAtr, atrValue);

  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : undefined;
  const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : undefined;

  return {
    support,
    resistance,
    swingHigh: lastSwingHigh?.price,
    swingLow: lastSwingLow?.price,
  };
}

export function buildMarketView(candles: MarketCandle[], thresholds: TradiAuraThresholds): MarketView {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const price = closes.length > 0 ? closes[closes.length - 1] : 0;

  const atr = atrSeries(highs, lows, closes, thresholds.atrPeriod);
  const atrValue = lastValue(atr) ?? price * 0.004;

  const swings = detectSwings(highs, lows, thresholds.swingLookback);

  return {
    candles,
    closes,
    highs,
    lows,
    volumes,
    emaFast: emaSeries(closes, thresholds.emaFast),
    emaMedium: emaSeries(closes, thresholds.emaMedium),
    emaSlow: emaSeries(closes, thresholds.emaSlow),
    rsi: rsiSeries(closes, thresholds.rsiPeriod),
    macd: macdSeries(closes, thresholds.macdFast, thresholds.macdSlow, thresholds.macdSignal),
    adx: adxSeries(highs, lows, closes, thresholds.adxPeriod),
    atr,
    bollinger: bollingerSeries(closes, thresholds.bollingerPeriod, thresholds.bollingerMult),
    supertrend: supertrendSeries(highs, lows, closes, thresholds.supertrendPeriod, thresholds.supertrendMult),
    vwap: vwapSeries(candles, thresholds.volumePeriod),
    roc14: rocSeries(closes, 14),
    roc50: rocSeries(closes, 50),
    volumeAverage: smaSeries(volumes, thresholds.volumePeriod),
    swings,
    levels: detectSupportResistance(candles, swings, price, atrValue, thresholds),
    price,
    atrValue,
  };
}

// ---------------------------------------------------------------------------
// Factor evaluators
// ---------------------------------------------------------------------------

export interface RegimeResult {
  direction: 1 | -1 | 0;
  code: ReasonCode;
  htfEma: number | null;
}

/** Higher-timeframe regime: price vs. its EMA, with a dead-zone around the EMA. */
export function evaluateRegime(higherView: MarketView, thresholds: TradiAuraThresholds): RegimeResult {
  const closes = higherView.closes;
  if (closes.length < 20) return { direction: 0, code: REASON.REGIME_FLAT, htfEma: null };

  const period = Math.min(thresholds.emaMedium, closes.length);
  const ema = emaSeries(closes, period);
  const emaLast = lastValue(ema);
  const emaPrev = previousValue(ema, 1);
  if (emaLast == null) return { direction: 0, code: REASON.REGIME_FLAT, htfEma: null };

  const band = Math.max(higherView.atrValue * 0.25, emaLast * 0.002);
  const distance = higherView.price - emaLast;

  if (Math.abs(distance) <= band) return { direction: 0, code: REASON.REGIME_FLAT, htfEma: emaLast };

  if (distance > 0 && emaPrev != null && emaLast >= emaPrev) {
    return { direction: 1, code: REASON.REGIME_UP, htfEma: emaLast };
  }
  if (distance < 0 && emaPrev != null && emaLast <= emaPrev) {
    return { direction: -1, code: REASON.REGIME_DOWN, htfEma: emaLast };
  }
  return { direction: distance > 0 ? 1 : -1, code: distance > 0 ? REASON.REGIME_UP : REASON.REGIME_DOWN, htfEma: emaLast };
}

export interface TrendResult {
  score: number;
  code: ReasonCode;
  direction: TrendDirection;
}

/** Entry-timeframe trend: EMA alignment + slope, scaled by ADX trend strength. */
export function evaluateTrend(view: MarketView, thresholds: TradiAuraThresholds): TrendResult {
  const emaFast = lastValue(view.emaFast);
  const emaMedium = lastValue(view.emaMedium);
  if (emaFast == null || emaMedium == null) return { score: 0, code: REASON.TREND_FLAT, direction: "SIDEWAYS" };

  const emaFastPrev = previousValue(view.emaFast, 1);
  const emaMediumPrev = previousValue(view.emaMedium, 1);
  const slopeFast = emaFastPrev != null && emaFast > emaFastPrev;
  const slopeMedium = emaMediumPrev != null && emaMedium > emaMediumPrev;

  const alignedUp = view.price > emaFast && emaFast > emaMedium;
  const alignedDown = view.price < emaFast && emaFast < emaMedium;

  const adx = lastValue(view.adx);
  let adxFactor = 0.6;
  if (adx != null) {
    if (adx >= thresholds.adxStrong) adxFactor = 1;
    else if (adx <= thresholds.adxWeak) adxFactor = 0.4;
    else adxFactor = 0.4 + 0.6 * ((adx - thresholds.adxWeak) / (thresholds.adxStrong - thresholds.adxWeak));
  }

  if (alignedUp && (slopeFast || slopeMedium)) {
    return { score: 1 * adxFactor, code: REASON.TREND_UP, direction: "UP" };
  }
  if (alignedDown && (slopeFast || slopeMedium)) {
    return { score: -1 * adxFactor, code: REASON.TREND_DOWN, direction: "DOWN" };
  }
  if (alignedUp) return { score: 0.6 * adxFactor, code: REASON.TREND_UP, direction: "UP" };
  if (alignedDown) return { score: -0.6 * adxFactor, code: REASON.TREND_DOWN, direction: "DOWN" };
  return { score: 0, code: REASON.TREND_FLAT, direction: "SIDEWAYS" };
}

export interface StructureResult {
  score: number;
  code: ReasonCode;
}

/** Market structure: higher-high/higher-low vs lower-high/lower-low, plus breakouts. */
export function evaluateStructure(view: MarketView, thresholds: TradiAuraThresholds): StructureResult {
  const { highs, lows } = view.swings;
  if (highs.length < 2 || lows.length < 2) return { score: 0, code: REASON.STRUCTURE_CONSOLIDATION };

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  const higherHigh = lastHigh.price > prevHigh.price;
  const higherLow = lastLow.price > prevLow.price;
  const lowerHigh = lastHigh.price < prevHigh.price;
  const lowerLow = lastLow.price < prevLow.price;

  const breakoutUp = view.price > (view.levels.resistance ?? view.levels.swingHigh ?? 0) && lastHigh.price > prevHigh.price;
  const breakoutDown = view.price < (view.levels.support ?? view.levels.swingLow ?? Number.POSITIVE_INFINITY) && lastLow.price < prevLow.price;

  const bullish = higherHigh || higherLow;
  const bearish = lowerHigh || lowerLow;

  if (bullish && !bearish) {
    const magnitude = breakoutUp || (higherHigh && higherLow) ? 1 : 0.7;
    return { score: magnitude, code: breakoutUp ? REASON.STRUCTURE_BREAKOUT_UP : REASON.STRUCTURE_HH_HL };
  }
  if (bearish && !bullish) {
    const magnitude = breakoutDown || (lowerHigh && lowerLow) ? 1 : 0.7;
    return { score: -magnitude, code: breakoutDown ? REASON.STRUCTURE_BREAKOUT_DOWN : REASON.STRUCTURE_LH_LL };
  }
  return { score: 0, code: REASON.STRUCTURE_CONSOLIDATION };
}

export interface MomentumResult {
  score: number;
  code: ReasonCode;
  overbought: boolean;
  oversold: boolean;
}

/** Momentum: RSI zone + MACD histogram. Flags extreme zones for reporting. */
export function evaluateMomentum(view: MarketView, thresholds: TradiAuraThresholds): MomentumResult {
  const rsi = lastValue(view.rsi);
  const macdValue = lastValue(view.macd.macd);
  const macdSignal = lastValue(view.macd.signal);
  const histogram = lastValue(view.macd.histogram);
  const histogramPrev = previousValue(view.macd.histogram, 1);

  if (rsi == null) return { score: 0, code: REASON.MOMENTUM_RSI_NEUTRAL, overbought: false, oversold: false };

  const overbought = rsi >= thresholds.rsiOverbought;
  const oversold = rsi <= thresholds.rsiOversold;

  let rsiScore = 0;
  if (rsi >= 85) {
    rsiScore = -0.2; // extreme: chasing is penalized but not blocked
  } else if (rsi > thresholds.rsiOverbought) {
    rsiScore = 0.2;
  } else if (rsi >= 70) {
    rsiScore = 0.5;
  } else if (rsi >= 55) {
    rsiScore = 0.8;
  } else if (rsi >= thresholds.rsiNeutral) {
    rsiScore = 0.4;
  } else if (rsi <= 15) {
    rsiScore = 0.2;
  } else if (rsi < thresholds.rsiOversold) {
    rsiScore = -0.2;
  } else if (rsi < 40) {
    rsiScore = -0.7;
  } else {
    rsiScore = -0.4;
  }

  let macdScore = 0;
  if (macdValue != null && macdSignal != null) {
    const above = macdValue > macdSignal;
    const rising = histogram != null && histogramPrev != null && histogram > histogramPrev;
    if (above && rising) macdScore = 0.6;
    else if (above) macdScore = 0.4;
    else if (rising) macdScore = -0.2;
    else macdScore = -0.5;
  }

  const score = clamp(0.6 * rsiScore + 0.4 * macdScore, -1, 1);

  let code: ReasonCode = REASON.MOMENTUM_RSI_NEUTRAL;
  if (overbought) code = REASON.MOMENTUM_OVERBOUGHT;
  else if (oversold) code = REASON.MOMENTUM_OVERSOLD;
  else if (score > 0.2) code = REASON.MOMENTUM_RSI_UP;
  else if (score < -0.2) code = REASON.MOMENTUM_RSI_DOWN;
  else code = REASON.MOMENTUM_RSI_NEUTRAL;

  return { score, code, overbought, oversold };
}

export interface ParticipationResult {
  score: number;
  code: ReasonCode;
  dead: boolean;
}

/**
 * Rolling participation ratio: total volume of the last `window` candles vs the
 * `window` before that. Using a window instead of the single last candle makes
 * the factor robust to a live in-progress candle, whose accumulated volume is
 * only a fraction of a full bar and would otherwise trigger a spurious
 * "volume too low" veto at the start of every candle.
 */
export function participationRatio(view: MarketView, thresholds: TradiAuraThresholds): { ratio: number | null; window: number } {
  const volumes = view.volumes;
  const window = Math.min(thresholds.volumePeriod, Math.max(1, Math.floor(volumes.length / 2)));
  if (volumes.length < window + 1) return { ratio: null, window };

  const sum = (from: number, to: number): number => volumes.slice(from, to).reduce((acc, v) => acc + Math.max(0, v), 0);
  const currentWindow = sum(volumes.length - window, volumes.length);
  const baseline = sum(volumes.length - 2 * window, volumes.length - window);
  if (!(baseline > 0)) return { ratio: null, window };

  return { ratio: currentWindow / baseline, window };
}

/** Volume participation: recent volume vs. its average. Confirmation only. */
export function evaluateParticipation(view: MarketView, thresholds: TradiAuraThresholds): ParticipationResult {
  const { ratio } = participationRatio(view, thresholds);
  if (ratio == null) return { score: 0, code: REASON.PARTICIPATION_WEAK, dead: false };

  if (ratio <= thresholds.volumeVetoRatio) {
    return { score: 0, code: REASON.PARTICIPATION_VETO, dead: true };
  }
  if (ratio < thresholds.volumeMinRatio) {
    return { score: 0, code: REASON.PARTICIPATION_WEAK, dead: false };
  }
  const score = clamp((ratio - thresholds.volumeMinRatio) / (thresholds.volumeIdealRatio - thresholds.volumeMinRatio), 0, 1);
  return { score, code: REASON.PARTICIPATION_CONFIRMED, dead: false };
}

export interface VolatilityResult {
  score: number;
  code: ReasonCode;
  tooHigh: boolean;
}

/** Volatility regime: ATR% must be inside a tradable band. Symmetric. */
export function evaluateVolatility(view: MarketView, thresholds: TradiAuraThresholds): VolatilityResult {
  const atrPct = view.price > 0 ? (view.atrValue / view.price) * 100 : 0;

  if (atrPct > thresholds.atrPctMax) {
    return { score: 0, code: REASON.VOLATILITY_VETO, tooHigh: true };
  }
  if (atrPct < thresholds.atrPctMin) {
    return { score: 0, code: REASON.VOLATILITY_LOW, tooHigh: false };
  }
  if (atrPct >= thresholds.atrPctIdealLow && atrPct <= thresholds.atrPctIdealHigh) {
    return { score: 1, code: REASON.VOLATILITY_IDEAL, tooHigh: false };
  }
  // Between the minimum and the ideal band, scale proportionally.
  const lowRamp = clamp((atrPct - thresholds.atrPctMin) / Math.max(thresholds.atrPctIdealLow - thresholds.atrPctMin, 1e-9), 0, 1);
  const highRamp = clamp((thresholds.atrPctMax - atrPct) / Math.max(thresholds.atrPctMax - thresholds.atrPctIdealHigh, 1e-9), 0, 1);
  return { score: Math.max(lowRamp, highRamp), code: REASON.VOLATILITY_HIGH, tooHigh: false };
}

/** Entry location: pullback to support/EMA, breakout, or extended (chasing). Side-aware. */
export function evaluateEntryLocation(view: MarketView, side: "LONG" | "SHORT", thresholds: TradiAuraThresholds): FactorResult {
  const price = view.price;
  const atr = view.atrValue;
  const emaFast = lastValue(view.emaFast);
  const emaMedium = lastValue(view.emaMedium);
  const { support, resistance, swingHigh, swingLow } = view.levels;

  if (side === "LONG") {
    const pullbackAnchor = emaFast != null ? emaFast : support ?? price - atr;
    const nearAnchor = price <= pullbackAnchor + thresholds.entryPullbackMaxAtr * atr && price >= pullbackAnchor - 2 * atr;
    const nearSupport = support != null && price >= support - 0.3 * atr && price <= support + thresholds.entryPullbackMaxAtr * atr;
    const retestingSwing = swingLow != null && price >= swingLow - 0.3 * atr && price <= swingLow + 0.6 * atr;
    const breakingOut = (resistance != null && price > resistance) || (swingHigh != null && price > swingHigh);

    if (nearAnchor || nearSupport || retestingSwing) {
      return { code: REASON.ENTRY_PULLBACK, score: 1, magnitude: 1 };
    }
    if (breakingOut) {
      return { code: REASON.ENTRY_BREAKOUT, score: 0.7, magnitude: 0.7 };
    }
    if (emaMedium != null && price > emaMedium + thresholds.entryExtensionMaxAtr * atr) {
      return { code: REASON.ENTRY_EXTENDED, score: 0.2, magnitude: 0.2 };
    }
    return { code: REASON.ENTRY_PULLBACK, score: 0.55, magnitude: 0.55 };
  }

  const pullbackAnchor = emaFast != null ? emaFast : resistance ?? price + atr;
  const nearAnchor = price >= pullbackAnchor - thresholds.entryPullbackMaxAtr * atr && price <= pullbackAnchor + 2 * atr;
  const nearResistance = resistance != null && price <= resistance + 0.3 * atr && price >= resistance - thresholds.entryPullbackMaxAtr * atr;
  const retestingSwing = swingHigh != null && price <= swingHigh + 0.3 * atr && price >= swingHigh - 0.6 * atr;
  const breakingDown = (support != null && price < support) || (swingLow != null && price < swingLow);

  if (nearAnchor || nearResistance || retestingSwing) {
    return { code: REASON.ENTRY_PULLBACK, score: 1, magnitude: 1 };
  }
  if (breakingDown) {
    return { code: REASON.ENTRY_BREAKOUT, score: 0.7, magnitude: 0.7 };
  }
  if (emaMedium != null && price < emaMedium - thresholds.entryExtensionMaxAtr * atr) {
    return { code: REASON.ENTRY_EXTENDED, score: 0.2, magnitude: 0.2 };
  }
  return { code: REASON.ENTRY_PULLBACK, score: 0.55, magnitude: 0.55 };
}

export interface RiskRewardResult extends FactorResult {
  stop?: number;
  target?: number;
  ratio: number;
}

/** Reward/risk from structure + ATR-based stop and target for one side. */
export function evaluateRiskReward(view: MarketView, side: "LONG" | "SHORT", thresholds: TradiAuraThresholds): RiskRewardResult {
  const price = view.price;
  const atr = view.atrValue;
  const { support, resistance } = view.levels;
  const epsilon = price * 1e-6;

  if (side === "LONG") {
    const stop = Math.min(support != null ? support - 0.3 * atr : Number.POSITIVE_INFINITY, price - thresholds.stopAtrMult * atr);
    const stopDist = Math.max(price - stop, epsilon);
    const targetBase = price + stopDist * thresholds.targetRMultiple;
    const target = resistance != null ? Math.max(targetBase, resistance) : targetBase;
    const ratio = Math.max((target - price) / stopDist, 0);
    return scoreRatio(ratio, thresholds, REASON.RR_OK, REASON.RR_LOW, stop, target);
  }

  const stop = Math.max(resistance != null ? resistance + 0.3 * atr : Number.NEGATIVE_INFINITY, price + thresholds.stopAtrMult * atr);
  const stopDist = Math.max(stop - price, epsilon);
  const targetBase = price - stopDist * thresholds.targetRMultiple;
  const target = support != null ? Math.min(targetBase, support) : targetBase;
  const ratio = Math.max((price - target) / stopDist, 0);
  return scoreRatio(ratio, thresholds, REASON.RR_OK, REASON.RR_LOW, stop, target);
}

function scoreRatio(
  ratio: number,
  thresholds: TradiAuraThresholds,
  okCode: ReasonCode,
  lowCode: ReasonCode,
  stop: number,
  target: number,
): RiskRewardResult {
  if (ratio >= thresholds.rrIdeal) {
    return { code: okCode, score: 1, magnitude: 1, stop, target, ratio };
  }
  if (ratio >= thresholds.rrMin) {
    return { code: okCode, score: (ratio - thresholds.rrMin) / (thresholds.rrIdeal - thresholds.rrMin), magnitude: 1, stop, target, ratio };
  }
  return { code: lowCode, score: 0, magnitude: 0, stop, target, ratio };
}
