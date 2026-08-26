import type { IndicatorBundle, MarketCandle } from "@/automation/types";
import {
  adxSeries,
  atrSeries,
  bollingerSeries,
  emaSeries,
  lastValue,
  macdSeries,
  rocSeries,
  rsiSeries,
  smaSeries,
  supertrendSeries,
  vwapSeries,
} from "./series";

export interface IndicatorEngine {
  compute(candles: MarketCandle[]): IndicatorBundle;
}

/**
 * Technical indicator engine. Produces the latest indicator values for the
 * current candle set. The TRADIAURA_SMART_V1 strategy reuses the same pure
 * series functions from `./series` so live and backtest computations are
 * identical.
 */
export class TechnicalIndicatorEngine implements IndicatorEngine {
  compute(candles: MarketCandle[]): IndicatorBundle {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const ema20 = lastValue(emaSeries(closes, 20)) ?? undefined;
    const ema50 = lastValue(emaSeries(closes, 50)) ?? undefined;
    const ema200 = lastValue(emaSeries(closes, 200)) ?? undefined;
    const sma20 = lastValue(smaSeries(closes, 20)) ?? undefined;
    const sma50 = lastValue(smaSeries(closes, 50)) ?? undefined;
    const sma200 = lastValue(smaSeries(closes, 200)) ?? undefined;
    const ema12 = lastValue(emaSeries(closes, 12)) ?? undefined;
    const ema26 = lastValue(emaSeries(closes, 26)) ?? undefined;
    const rsi = lastValue(rsiSeries(closes, 14)) ?? undefined;
    const atr = lastValue(atrSeries(highs, lows, closes, 14)) ?? undefined;
    const adx = lastValue(adxSeries(highs, lows, closes, 14)) ?? undefined;
    const vwap = lastValue(vwapSeries(candles, 20)) ?? undefined;
    const bollinger = bollingerSeries(closes, 20, 2);
    const supertrend = supertrendSeries(highs, lows, closes, 10, 3);
    const macd = macdSeries(closes, 12, 26, 9);
    const roc14 = lastValue(rocSeries(closes, 14)) ?? undefined;
    const roc50 = lastValue(rocSeries(closes, 50)) ?? undefined;

    const current = volumes.length > 0 ? volumes[volumes.length - 1] : undefined;
    const average = lastValue(smaSeries(volumes, 20)) ?? undefined;
    const lastClose = closes[closes.length - 1];

    return {
      ema: ema20,
      sma: sma50,
      ema20,
      ema50,
      ema200,
      sma20,
      sma50,
      sma200,
      ema12,
      ema26,
      rsi,
      macd: {
        macd: lastValue(macd.macd) ?? undefined,
        signal: lastValue(macd.signal) ?? undefined,
        histogram: lastValue(macd.histogram) ?? undefined,
      },
      adx,
      atr,
      atrPct: lastClose && atr != null ? (atr / lastClose) * 100 : undefined,
      vwap,
      bollinger: {
        upper: lastValue(bollinger.upper) ?? undefined,
        middle: lastValue(bollinger.middle) ?? undefined,
        lower: lastValue(bollinger.lower) ?? undefined,
      },
      supertrend: {
        direction: lastValue(supertrend.direction) ?? 1,
        value: lastValue(supertrend.value) ?? undefined,
      },
      volume: {
        current,
        average,
        ratio: average && average > 0 && current != null ? current / average : undefined,
      },
      roc14,
      roc50,
    };
  }
}
