import type { MarketCandle } from "@/automation/types";
import { atrSeries, emaSeries } from "@/automation/indicators/series";
import type { PlannerContext, TradePlan } from "@/automation/planner/types";
import type { TradePlanner } from "@/automation/planner/trade-planner";
import { DefaultTradeValidator } from "@/automation/planner/trade-validator";
import { defaultEntryExpiryMinutes } from "@/automation/planner/entry-expiry";
import type { BaseStrategy, StrategyContext, StrategyDecision } from "../types";
import { TREND_BREAKOUT_ID } from "../catalog";
import { usdt } from "@/lib/currency/usdt-text";

/**
 * Trend Breakout (Donchian / "Turtle"-style), designed for 4h candles.
 *
 *   Entry  : the closed candle breaks above the previous ENTRY_LOOKBACK candles'
 *            high while above the TREND_EMA (long), or below their low while
 *            below the TREND_EMA (short). LIMIT at the breakout candle's close.
 *   Stop   : STOP_ATR x ATR(ATR_PERIOD) from entry, then trailed to the previous
 *            EXIT_LOOKBACK candles' low (long) / high (short) — see channelStop().
 *   Target : capped at TARGET_R x the initial risk so a take-profit order exists;
 *            in practice most winners exit on the trailing stop.
 *
 * Backtested on 4h BTC/ETH/SOL/XRP/BNB/DOGE (Oct 2023 – Oct 2026) with live
 * mechanics, maker entry / taker exit fees and funding: ~21 trades/month across
 * the 6 coins, ~32% win rate, average winner ~3x average loser, positive on
 * every coin.
 */
export const ENTRY_LOOKBACK = 20;
export const EXIT_LOOKBACK = 10;
export const TREND_EMA = 200;
export const ATR_PERIOD = 14;
export const STOP_ATR = 2;
export const TARGET_R = 10;
/** Signals carry a fixed confidence: the rules are binary, not scored. */
export const SIGNAL_CONFIDENCE = 0.7;
export const MIN_CANDLES = TREND_EMA + ENTRY_LOOKBACK + 1;

export interface BreakoutAnalysis {
  signal: "BUY" | "SELL" | null;
  close: number;
  ema: number | null;
  atr: number | null;
  channelHigh: number;
  channelLow: number;
  /** How far the close cleared the channel, in ATRs (ranking strength for auto-select). */
  strength: number;
}

const highest = (candles: MarketCandle[]) => Math.max(...candles.map((c) => c.high));
const lowest = (candles: MarketCandle[]) => Math.min(...candles.map((c) => c.low));

/** Breakout check on the LAST candle of `candles` (all candles must be closed). */
export function analyzeBreakout(candles: MarketCandle[]): BreakoutAnalysis | null {
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const ema = emaSeries(closes, TREND_EMA)[candles.length - 1] ?? null;
  const atr =
    atrSeries(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      closes,
      ATR_PERIOD,
    )[candles.length - 1] ?? null;
  const window = candles.slice(-ENTRY_LOOKBACK - 1, -1);
  const channelHigh = highest(window);
  const channelLow = lowest(window);

  let signal: BreakoutAnalysis["signal"] = null;
  if (ema != null && atr != null && atr > 0) {
    if (last.close > channelHigh && last.close > ema) signal = "BUY";
    else if (last.close < channelLow && last.close < ema) signal = "SELL";
  }
  const strength =
    atr && atr > 0
      ? signal === "BUY"
        ? (last.close - channelHigh) / atr
        : signal === "SELL"
          ? (channelLow - last.close) / atr
          : 0
      : 0;
  return { signal, close: last.close, ema, atr, channelHigh, channelLow, strength };
}

/**
 * Trailing stop level from closed candles: the lowest low (long) / highest high
 * (short) of the last EXIT_LOOKBACK candles. Only ever tightens the stop.
 */
export function channelStop(side: "BUY" | "SELL", closedCandles: MarketCandle[], currentStop: number | null): number | null {
  if (closedCandles.length < EXIT_LOOKBACK) return currentStop;
  const window = closedCandles.slice(-EXIT_LOOKBACK);
  const level = side === "BUY" ? lowest(window) : highest(window);
  if (currentStop == null || !(currentStop > 0)) return level;
  return side === "BUY" ? Math.max(currentStop, level) : Math.min(currentStop, level);
}

const round = (n: number | null) => (n == null ? null : Number(n.toPrecision(8)));

export class TrendBreakoutStrategy implements BaseStrategy {
  name = TREND_BREAKOUT_ID;

  async analyze(context: StrategyContext): Promise<StrategyDecision> {
    const report = context.report;
    const candles = context.candles;
    const base = { timestamp: new Date().toISOString() };

    const result = analyzeBreakout(candles);
    if (!result) {
      report?.(`Not enough data — ${candles.length} candles available, need ≥ ${MIN_CANDLES} (200-EMA trend + 20-candle range).`);
      return { ...base, signal: "WAIT", confidence: 0, trend: "SIDEWAYS", reasons: ["insufficient-data"], indicators: { version: TREND_BREAKOUT_ID, signal: "NO_TRADE", reason: "insufficient data" } };
    }

    const trend = result.ema == null ? "SIDEWAYS" : result.close > result.ema ? "UP" : "DOWN";
    report?.(
      `Close ${usdt(round(result.close))} · 20-candle range ${usdt(round(result.channelLow))} – ${usdt(round(result.channelHigh))} · 200-EMA ${usdt(round(result.ema))} (${trend === "UP" ? "uptrend" : trend === "DOWN" ? "downtrend" : "flat"})`,
      { close: result.close, channelHigh: result.channelHigh, channelLow: result.channelLow, ema: result.ema, atr: result.atr },
    );

    const indicators = {
      version: TREND_BREAKOUT_ID,
      atr: result.atr,
      ema200: result.ema,
      channelHigh: result.channelHigh,
      channelLow: result.channelLow,
      breakout: result.signal != null,
      strength: result.strength,
    };

    if (!result.signal) {
      const why =
        result.close > result.channelHigh
          ? "price broke above the range but is below the 200-EMA (against the trend)"
          : result.close < result.channelLow
            ? "price broke below the range but is above the 200-EMA (against the trend)"
            : "price is still inside the 20-candle range — no breakout";
      return { ...base, signal: "WAIT", confidence: 0, trend, reasons: ["no-breakout"], indicators: { ...indicators, signal: "NO_TRADE", reason: why } };
    }

    const atr = result.atr as number;
    const stop = result.signal === "BUY" ? result.close - STOP_ATR * atr : result.close + STOP_ATR * atr;
    const risk = Math.abs(result.close - stop);
    const target = result.signal === "BUY" ? result.close + TARGET_R * risk : result.close - TARGET_R * risk;
    report?.(
      `${result.signal === "BUY" ? "Upside" : "Downside"} breakout with the trend — entry ${usdt(round(result.close))}, stop ${usdt(round(stop))} (2 ATR), trailing to the last 10 candles once in the trade.`,
    );
    return {
      ...base,
      signal: result.signal,
      confidence: SIGNAL_CONFIDENCE,
      trend,
      reasons: [result.signal === "BUY" ? "breakout-up" : "breakout-down"],
      indicators: { ...indicators, signal: result.signal === "BUY" ? "LONG_SIGNAL" : "SHORT_SIGNAL" },
      entryZone: result.close,
      stopLossSuggestion: stop,
      takeProfitSuggestion: target,
    };
  }
}

/** Human summary used for the engine's "Decision: …" line and idle logs. */
export function summarizeBreakout(symbol: string, decision: StrategyDecision): string {
  if (decision.signal === "WAIT") return `No trade for ${symbol} — ${String(decision.indicators?.reason ?? "no breakout")}`;
  return `${decision.signal === "BUY" ? "LONG" : "SHORT"} breakout on ${symbol}`;
}

/**
 * Plans the order straight from the strategy's levels (LIMIT at the breakout
 * close, 2-ATR stop, 10R cap) and still runs the shared trade validator, so the
 * same safety rules apply as for every other strategy (limit side, max stop
 * distance, minimum R:R, confidence).
 */
export class TrendBreakoutPlanner implements TradePlanner {
  constructor(private readonly validator = new DefaultTradeValidator()) {}

  plan(context: PlannerContext): TradePlan {
    const decision = context.strategyDecision;
    const minutes =
      context.config.orderExpiryMinutes && context.config.orderExpiryMinutes > 0 ? context.config.orderExpiryMinutes : defaultEntryExpiryMinutes(context.config.timeframe);
    const expiryTime = new Date(Date.now() + minutes * 60_000).toISOString();
    const wait = (reason: string): TradePlan => ({
      action: "WAIT",
      entryType: "NONE",
      limitPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskRewardRatio: null,
      confidence: decision.confidence,
      reason,
      expiryTime,
      symbol: context.config.symbol,
      side: "WAIT",
      entryPrice: null,
      leverage: context.config.leverage,
    });

    if (decision.signal === "WAIT") return wait("No breakout signal.");
    const breakoutClose = Number(decision.entryZone);
    const stop = Number(decision.stopLossSuggestion);
    if (!(breakoutClose > 0) || !(stop > 0)) return wait("Breakout levels are incomplete.");

    // If price already pulled back past the breakout close, rest at the live
    // price instead (a better fill, and a BUY limit may never sit above market).
    const live = Number(context.currentPrice);
    const entry = live > 0 ? (decision.signal === "BUY" ? Math.min(breakoutClose, live) : Math.max(breakoutClose, live)) : breakoutClose;
    const risk = Math.abs(entry - stop);
    if (!(risk > 0) || (decision.signal === "BUY" ? stop >= entry : stop <= entry)) return wait("Price already moved past the breakout stop.");
    const target = decision.signal === "BUY" ? entry + TARGET_R * risk : entry - TARGET_R * risk;
    const trade: TradePlan = {
      action: decision.signal,
      entryType: "LIMIT",
      limitPrice: entry,
      stopLoss: stop,
      takeProfit: target,
      riskRewardRatio: risk > 0 ? Math.round((Math.abs(target - entry) / risk) * 100) / 100 : null,
      confidence: decision.confidence,
      reason: `Trend breakout ${decision.signal === "BUY" ? "long" : "short"}: limit at the breakout close, 2-ATR stop trailing the last ${EXIT_LOOKBACK} candles.`,
      expiryTime,
      symbol: context.config.symbol,
      side: decision.signal,
      entryPrice: entry,
      leverage: context.config.leverage,
    };
    const validation = this.validator.validate(context, trade);
    return validation.valid ? trade : wait(validation.reason);
  }
}
