import type { MarketCandle } from "@/automation/types";

/**
 * Pure, deterministic technical indicator math used by the TRADENAYA_SMART_V1
 * strategy and the technical indicator engine.
 *
 * Every function here is a pure transformation of its inputs: the same candles
 * always produce the same output. Series are aligned to the input candle array
 * (index i corresponds to candle i) and use `null` for positions that have not
 * accumulated enough data yet.
 */

export type Series = (number | null)[];

export interface MacdSeries {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export interface BollingerSeries {
  upper: Series;
  middle: Series;
  lower: Series;
}

export interface SupertrendSeries {
  value: Series;
  direction: Series;
}

export function lastValue(series: Series): number | null {
  if (series.length === 0) return null;
  return series[series.length - 1];
}

export function previousValue(series: Series, offset = 1): number | null {
  const index = series.length - 1 - offset;
  if (index < 0) return null;
  return series[index] ?? null;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((a, b) => a + (b - avg) * (b - avg), 0) / values.length;
  return Math.sqrt(variance);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Simple moving average. First valid value at index period - 1. */
export function smaSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i += 1) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average (seed = SMA of the first `period` values). */
export function emaSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  const alpha = 2 / (period + 1);
  let ema = mean(values.slice(0, period));
  out[period - 1] = ema;
  for (let i = period; i < values.length; i += 1) {
    ema = alpha * values[i] + (1 - alpha) * ema;
    out[i] = ema;
  }
  return out;
}

/** Wilder's RSI. First valid value at index `period` (needs period+1 closes). */
export function rsiSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period + 1 || period <= 0) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;

  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder's Average True Range. First valid value at index period - 1. */
export function atrSeries(highs: number[], lows: number[], closes: number[], period: number): Series {
  const out: Series = new Array(highs.length).fill(null);
  if (highs.length < period || period <= 0) return out;

  const trueRanges: number[] = [];
  for (let i = 0; i < highs.length; i += 1) {
    const prevClose = i === 0 ? closes[0] : closes[i - 1];
    trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - prevClose), Math.abs(lows[i] - prevClose)));
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = atr;
  for (let i = period; i < trueRanges.length; i += 1) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    out[i] = atr;
  }
  return out;
}

/** MACD (12/26/9 by default). Series aligned to the input closes. */
export function macdSeries(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdSeries {
  const fast = emaSeries(closes, fastPeriod);
  const slow = emaSeries(closes, slowPeriod);

  const macd: Series = new Array(closes.length).fill(null);
  const macdValues: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const f = fast[i];
    const s = slow[i];
    if (f != null && s != null) {
      const value = f - s;
      macd[i] = value;
      macdValues.push(value);
    }
  }

  const signal: Series = new Array(closes.length).fill(null);
  const histogram: Series = new Array(closes.length).fill(null);
  if (macdValues.length >= signalPeriod) {
    const signalEma = emaSeries(macdValues, signalPeriod);
    // Shift the signal EMA back onto the candle-aligned macd indices.
    const firstMacdIndex = closes.length - macdValues.length;
    for (let k = 0; k < macdValues.length; k += 1) {
      const value = signalEma[k];
      if (value != null) {
        const candleIndex = firstMacdIndex + k;
        const macdValue = macd[candleIndex];
        signal[candleIndex] = value;
        if (macdValue != null) histogram[candleIndex] = macdValue - value;
      }
    }
  }

  return { macd, signal, histogram };
}

/** Wilder's ADX. First valid value near index 2 * period - 1. */
export function adxSeries(highs: number[], lows: number[], closes: number[], period = 14): Series {
  const out: Series = new Array(highs.length).fill(null);
  if (highs.length < 2 * period + 1) return out;

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }

  let smoothedPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTr = tr.slice(0, period).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  for (let i = period; i < tr.length; i += 1) {
    smoothedPlus = smoothedPlus - smoothedPlus / period + plusDm[i];
    smoothedMinus = smoothedMinus - smoothedMinus / period + minusDm[i];
    smoothedTr = smoothedTr - smoothedTr / period + tr[i];

    const plusDi = smoothedTr === 0 ? 0 : (100 * smoothedPlus) / smoothedTr;
    const minusDi = smoothedTr === 0 ? 0 : (100 * smoothedMinus) / smoothedTr;
    const sumDi = plusDi + minusDi;
    dxValues.push(sumDi === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / sumDi);
  }

  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[2 * period] = adx;
  for (let i = period; i < dxValues.length; i += 1) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
    out[2 * period + (i - period + 1)] = adx;
  }
  return out;
}

/** Bollinger Bands (20/2 by default). First valid value at index period - 1. */
export function bollingerSeries(closes: number[], period = 20, mult = 2): BollingerSeries {
  const upper: Series = new Array(closes.length).fill(null);
  const middle: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i += 1) {
    const window = closes.slice(i - period + 1, i + 1);
    const avg = mean(window);
    const sd = stddev(window);
    middle[i] = avg;
    upper[i] = avg + mult * sd;
    lower[i] = avg - mult * sd;
  }
  return { upper, middle, lower };
}

/** Rolling VWAP over a lookback window using typical price. First valid at period - 1. */
export function vwapSeries(candles: MarketCandle[], period = 20): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length < period || period <= 0) return out;

  const typical = candles.map((c) => (c.high + c.low + c.close) / 3);

  let priceVolumeSum = 0;
  let volumeSum = 0;
  for (let i = 0; i < candles.length; i += 1) {
    priceVolumeSum += typical[i] * candles[i].volume;
    volumeSum += candles[i].volume;
    if (i >= period) {
      priceVolumeSum -= typical[i - period] * candles[i - period].volume;
      volumeSum -= candles[i - period].volume;
    }
    if (i >= period - 1) {
      out[i] = volumeSum > 0 ? priceVolumeSum / volumeSum : null;
    }
  }
  return out;
}

/** Rate of change (%). First valid value at index `period`. */
export function rocSeries(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i += 1) {
    const base = values[i - period];
    out[i] = base !== 0 ? ((values[i] - base) / base) * 100 : null;
  }
  return out;
}

/** Supertrend (10/3 by default). Direction series uses +1 (up) / -1 (down). */
export function supertrendSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 10,
  multiplier = 3,
): SupertrendSeries {
  const atr = atrSeries(highs, lows, closes, period);
  const value: Series = new Array(closes.length).fill(null);
  const direction: Series = new Array(closes.length).fill(null);

  let prevFinalUpper: number | null = null;
  let prevFinalLower: number | null = null;
  let prevClose: number | null = null;
  let prevDirection = 1;

  for (let i = 0; i < closes.length; i += 1) {
    const a = atr[i];
    if (a == null || prevClose == null) {
      prevClose = closes[i];
      continue;
    }

    const hl2 = (highs[i] + lows[i]) / 2;
    const basicUpper = hl2 + multiplier * a;
    const basicLower = hl2 - multiplier * a;

    const finalUpper: number | null =
      prevFinalUpper == null || basicUpper < prevFinalUpper || prevClose > prevFinalUpper ? basicUpper : prevFinalUpper;
    const finalLower: number | null =
      prevFinalLower == null || basicLower > prevFinalLower || prevClose < prevFinalLower ? basicLower : prevFinalLower;

    let dir = prevDirection;
    if (prevFinalUpper != null && closes[i] > prevFinalUpper) dir = 1;
    else if (prevFinalLower != null && closes[i] < prevFinalLower) dir = -1;

    value[i] = dir === 1 ? finalLower : finalUpper;
    direction[i] = dir;

    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevDirection = dir;
    prevClose = closes[i];
  }
  return { value, direction };
}
