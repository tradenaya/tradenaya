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
import { lastRich, stochRsiSeries, keltnerSeries, ichimokuSeries, psarSeries, cciSeries, mfiSeries, obvSeries, williamsRSeries, adxPdiMdiSeries } from "./rich";
import { detectPatterns } from "./patterns";

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

    const stoch = stochRsiSeries(closes, 14, 14, 3, 3);
    const keltner = keltnerSeries(candles, 20, 10, 2);
    const ichimoku = ichimokuSeries(candles, 9, 26, 52, 26);
    const dm = adxPdiMdiSeries(candles, 14);
    const obv = obvSeries(candles);
    const obvNow = lastRich(obv);
    const obvPrev = obv.length > 1 ? obv[obv.length - 2] : null;
    const atrLast = lastRich(dm.adx) != null ? atr : undefined;

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
      ta: {
        stochRsiK: lastRich(stoch.k) ?? undefined,
        stochRsiD: lastRich(stoch.d) ?? undefined,
        cci: lastRich(cciSeries(candles, 20)) ?? undefined,
        mfi: lastRich(mfiSeries(candles, 14)) ?? undefined,
        obv: obvNow ?? undefined,
        obvSlope: obvNow != null && obvPrev != null ? obvNow - obvPrev : undefined,
        williamsR: lastRich(williamsRSeries(candles, 14)) ?? undefined,
        psar: lastRich(psarSeries(candles)) ?? undefined,
        pdi: lastRich(dm.pdi) ?? undefined,
        mdi: lastRich(dm.mdi) ?? undefined,
        keltnerUpper: lastRich(keltner.upper) ?? undefined,
        keltnerMiddle: lastRich(keltner.middle) ?? undefined,
        keltnerLower: lastRich(keltner.lower) ?? undefined,
        ichimokuConversion: lastRich(ichimoku.conversion) ?? undefined,
        ichimokuBase: lastRich(ichimoku.base) ?? undefined,
        ichimokuSpanA: lastRich(ichimoku.spanA) ?? undefined,
        ichimokuSpanB: lastRich(ichimoku.spanB) ?? undefined,
        patterns: detectPatterns(candles, atrLast).map((p) => p.code),
      },
    };
  }
}
