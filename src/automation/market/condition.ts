import type { MarketCandle } from "@/automation/types";
import { adxSeries, atrSeries, lastValue } from "@/automation/indicators/series";

/**
 * "Is the market predictable right now?" — a plain-language read of recent
 * candles that helps the user choose between the SAFE and RISKY trade styles.
 *
 * Three things decide it, all on the bot's own timeframe:
 *  - Swings: current ATR vs its usual (median) level. Much bigger than usual
 *    means price is jumping around → volatile.
 *  - Direction: ADX (trend strength) and the efficiency ratio (how much of the
 *    recent movement went one way). Strong + efficient → a clear trend.
 *  - Spikes: a recent candle several times larger than normal → volatile.
 *
 * Pure: the same candles always give the same answer.
 */

export type MarketConditionLevel = "PREDICTABLE" | "NORMAL" | "VOLATILE";

export interface CoinCondition {
  symbol: string;
  level: MarketConditionLevel;
  /** Average candle range as % of price. */
  atrPct: number;
  /** Current swing size vs its usual size (1 = normal). */
  swingRatio: number;
  /** Trend strength 0–100 (≥25 = clear trend, <20 = no direction). */
  adx: number;
  /** 0–1: how much of the recent movement went in one direction. */
  efficiency: number;
  /** Largest recent candle vs a normal candle. */
  spike: number;
  direction: "UP" | "DOWN" | "SIDEWAYS";
  reasons: string[];
}

export interface MarketCondition {
  level: MarketConditionLevel;
  /** RISKY only when the market is predictable. */
  recommended: "SAFE" | "RISKY";
  headline: string;
  coins: CoinCondition[];
}

const SWING_LOOKBACK = 100;
const EFFICIENCY_PERIOD = 20;
const SPIKE_LOOKBACK = 5;

const VOLATILE_SWING_RATIO = 1.5;
const VOLATILE_SPIKE = 3;
const CALM_SWING_RATIO = 1.25;
const TREND_ADX = 25;
const NO_TREND_ADX = 20;
const TREND_EFFICIENCY = 0.3;

export const MIN_CANDLES_FOR_CONDITION = 60;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/** Read one coin's candles. Null when there is not enough history to judge. */
export function assessCoinCondition(symbol: string, candles: MarketCandle[]): CoinCondition | null {
  if (candles.length < MIN_CANDLES_FOR_CONDITION) return null;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  if (!(price > 0)) return null;

  const atr = atrSeries(highs, lows, closes, 14);
  const atrNow = lastValue(atr);
  const recentAtr = atr.slice(-SWING_LOOKBACK).filter((v): v is number => v != null && v > 0);
  if (atrNow == null || !(atrNow > 0) || recentAtr.length < 20) return null;
  const usualAtr = median(recentAtr);
  const swingRatio = atrNow / usualAtr;

  const adx = lastValue(adxSeries(highs, lows, closes, 14)) ?? 0;

  const from = closes[closes.length - 1 - EFFICIENCY_PERIOD];
  let path = 0;
  for (let i = closes.length - EFFICIENCY_PERIOD; i < closes.length; i += 1) path += Math.abs(closes[i] - closes[i - 1]);
  const netMove = price - from;
  const efficiency = path > 0 ? Math.abs(netMove) / path : 0;

  const spike = Math.max(...candles.slice(-SPIKE_LOOKBACK).map((c) => c.high - c.low)) / usualAtr;

  const trending = adx >= TREND_ADX && efficiency >= TREND_EFFICIENCY;
  const direction: CoinCondition["direction"] = trending ? (netMove > 0 ? "UP" : "DOWN") : "SIDEWAYS";

  const reasons: string[] = [];
  if (swingRatio >= VOLATILE_SWING_RATIO) reasons.push(`Price swings are ${swingRatio.toFixed(1)}× bigger than usual`);
  else if (swingRatio <= CALM_SWING_RATIO) reasons.push("Price swings are normal");
  else reasons.push(`Price swings are a bit bigger than usual (${swingRatio.toFixed(1)}×)`);
  if (spike >= VOLATILE_SPIKE) reasons.push(`A sudden big candle (${spike.toFixed(1)}× a normal one) in the last ${SPIKE_LOOKBACK} candles`);
  if (trending) reasons.push(`Clear ${direction === "UP" ? "up" : "down"}trend (strength ${adx.toFixed(0)})`);
  else if (adx < NO_TREND_ADX) reasons.push("No clear direction — price is going sideways / choppy");
  else reasons.push("Trend is weak — direction is not clear yet");

  const volatile = swingRatio >= VOLATILE_SWING_RATIO || spike >= VOLATILE_SPIKE;
  const level: MarketConditionLevel = volatile
    ? "VOLATILE"
    : trending && swingRatio <= CALM_SWING_RATIO
      ? "PREDICTABLE"
      : "NORMAL";

  return {
    symbol,
    level,
    atrPct: round((atrNow / price) * 100, 3),
    swingRatio: round(swingRatio),
    adx: round(adx, 1),
    efficiency: round(efficiency),
    spike: round(spike),
    direction,
    reasons,
  };
}

/**
 * Combine several coins (e.g. the market leaders for an auto-select bot).
 * Predictable only when most coins are predictable and none is volatile;
 * volatile as soon as a third of them are.
 */
export function combineConditions(coins: CoinCondition[]): MarketCondition {
  if (coins.length === 0) {
    return { level: "NORMAL", recommended: "SAFE", headline: "Not enough market data to judge right now — Safe is recommended.", coins };
  }
  const volatile = coins.filter((c) => c.level === "VOLATILE").length;
  const predictable = coins.filter((c) => c.level === "PREDICTABLE").length;
  let level: MarketConditionLevel;
  if (volatile / coins.length >= 1 / 3) level = "VOLATILE";
  else if (volatile === 0 && predictable / coins.length > 0.5) level = "PREDICTABLE";
  else level = "NORMAL";

  const headline =
    level === "PREDICTABLE"
      ? "Market is calm with a clear direction — Risky can be considered."
      : level === "VOLATILE"
        ? "Market is jumping around — use Safe."
        : "Market is mixed — no clear direction or a bit jumpy. Safe is recommended.";
  return { level, recommended: level === "PREDICTABLE" ? "RISKY" : "SAFE", headline, coins };
}
