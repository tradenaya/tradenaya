import * as ti from "technicalindicators";
import type { MarketCandle } from "@/automation/types";
import type { Series } from "./series";

/**
 * Richer technical indicators backed by the external `technicalindicators`
 * library. These are ADDITIONAL series alongside the hand-rolled ones in
 * `series.ts`.
 *
 * IMPORTANT alignment contract: every function here returns a series aligned
 * 1:1 to the input candle array (index i corresponds to candle i) using `null`
 * for warm-up positions — exactly like the hand-rolled series in `series.ts`.
 * The `technicalindicators` library trims warm-up values instead of returning
 * them, so we left-pad the library output to restore the aligned form.
 */

type NumberSeries = number[];

/** Left-pad a trimmed library series so it aligns with the input candle array. */
function align(inputLength: number, trimmed: NumberSeries): Series {
  if (trimmed.length <= 0) return new Array(inputLength).fill(null);
  const pad = Math.max(0, inputLength - trimmed.length);
  const out: Series = new Array(inputLength).fill(null);
  for (let i = 0; i < trimmed.length; i += 1) {
    const value = trimmed[i];
    if (Number.isFinite(value)) out[i + pad] = value;
  }
  return out;
}

export interface StochRsiSeries {
  k: Series;
  d: Series;
}

/** Stochastic RSI (14/14/3/3). Aligned to the input closes. */
export function stochRsiSeries(
  closes: number[],
  rsiPeriod = 14,
  stochasticPeriod = 14,
  kPeriod = 3,
  dPeriod = 3,
): StochRsiSeries {
  const result = ti.StochasticRSI.calculate({
    values: closes,
    rsiPeriod,
    stochasticPeriod,
    kPeriod,
    dPeriod,
  });
  return {
    k: align(closes.length, result.map((row) => row.k)),
    d: align(closes.length, result.map((row) => row.d)),
  };
}

export interface KeltnerSeries {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Keltner Channels (20 EMA / 10 ATR / 2x). Aligned to the candles. */
export function keltnerSeries(
  candles: MarketCandle[],
  maPeriod = 20,
  atrPeriod = 10,
  multiplier = 2,
): KeltnerSeries {
  const result = ti.KeltnerChannels.calculate({
    maPeriod,
    atrPeriod,
    useSMA: false,
    multiplier,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
  });
  const n = candles.length;
  return {
    upper: align(n, result.map((row) => row.upper)),
    middle: align(n, result.map((row) => row.middle)),
    lower: align(n, result.map((row) => row.lower)),
  };
}

export interface IchimokuSeries {
  conversion: Series;
  base: Series;
  spanA: Series;
  spanB: Series;
}

/** Ichimoku Cloud (9/26/52/26). Aligned to the candles. */
export function ichimokuSeries(
  candles: MarketCandle[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanPeriod = 52,
  displacement = 26,
): IchimokuSeries {
  const result = ti.IchimokuCloud.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    conversionPeriod,
    basePeriod,
    spanPeriod,
    displacement,
  });
  const n = candles.length;
  return {
    conversion: align(n, result.map((row) => row.conversion)),
    base: align(n, result.map((row) => row.base)),
    spanA: align(n, result.map((row) => row.spanA)),
    spanB: align(n, result.map((row) => row.spanB)),
  };
}

/** Parabolic SAR. Aligned to the candles. */
export function psarSeries(candles: MarketCandle[], step = 0.02, max = 0.2): Series {
  const result = ti.PSAR.calculate({
    step,
    max,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
  });
  return align(candles.length, result);
}

/** CCI (20). Aligned to the candles. */
export function cciSeries(candles: MarketCandle[], period = 20): Series {
  const result = ti.CCI.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
  });
  return align(candles.length, result);
}

/** Money Flow Index (14). Aligned to the candles. */
export function mfiSeries(candles: MarketCandle[], period = 14): Series {
  const result = ti.MFI.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume),
  });
  return align(candles.length, result);
}

/** On-Balance Volume. Aligned to the candles. */
export function obvSeries(candles: MarketCandle[]): Series {
  const result = ti.OBV.calculate({
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume),
  });
  return align(candles.length, result);
}

/** Williams %R (14). Aligned to the candles. */
export function williamsRSeries(candles: MarketCandle[], period = 14): Series {
  const result = ti.WilliamsR.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
  });
  return align(candles.length, result);
}

export interface AdxSeries {
  adx: Series;
  pdi: Series;
  mdi: Series;
}

/** Directional movement (ADX / +DI / -DI). Aligned to the candles. */
export function adxPdiMdiSeries(candles: MarketCandle[], period = 14): AdxSeries {
  const result = ti.ADX.calculate({
    period,
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
  });
  const n = candles.length;
  return {
    adx: align(n, result.map((row) => row.adx)),
    pdi: align(n, result.map((row) => row.pdi)),
    mdi: align(n, result.map((row) => row.mdi)),
  };
}

/** Last non-null value of a padded series. */
export function lastRich(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] != null) return series[i] as number;
  }
  return null;
}
