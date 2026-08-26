import { REASON, type ReasonCode } from "./config";
import type { StrategyDecision } from "@/automation/strategy/types";

const REASON_TEXT: Record<ReasonCode, string> = {
  [REASON.NOT_ENOUGH_DATA]: "not enough market data yet",
  [REASON.REGIME_UP]: "higher timeframe trending up",
  [REASON.REGIME_DOWN]: "higher timeframe trending down",
  [REASON.REGIME_FLAT]: "higher timeframe flat",
  [REASON.REGIME_VETO_LONG]: "higher timeframe trend opposes long",
  [REASON.REGIME_VETO_SHORT]: "higher timeframe trend opposes short",
  [REASON.TREND_UP]: "uptrend confirmed",
  [REASON.TREND_DOWN]: "downtrend confirmed",
  [REASON.TREND_FLAT]: "trend is flat",
  [REASON.TREND_WEAK_ADX]: "trend weak (low ADX)",
  [REASON.TREND_VETO]: "trend opposes the signal",
  [REASON.STRUCTURE_HH_HL]: "higher highs / higher lows",
  [REASON.STRUCTURE_LH_LL]: "lower highs / lower lows",
  [REASON.STRUCTURE_BREAKOUT_UP]: "upside breakout",
  [REASON.STRUCTURE_BREAKOUT_DOWN]: "downside breakout",
  [REASON.STRUCTURE_CONSOLIDATION]: "price consolidating",
  [REASON.MOMENTUM_RSI_UP]: "RSI rising",
  [REASON.MOMENTUM_RSI_DOWN]: "RSI falling",
  [REASON.MOMENTUM_RSI_NEUTRAL]: "RSI neutral",
  [REASON.MOMENTUM_MACD_UP]: "MACD bullish",
  [REASON.MOMENTUM_MACD_DOWN]: "MACD bearish",
  [REASON.MOMENTUM_OVERBOUGHT]: "market overbought",
  [REASON.MOMENTUM_OVERSOLD]: "market oversold",
  [REASON.MOMENTUM_VETO]: "momentum opposes the signal",
  [REASON.PARTICIPATION_CONFIRMED]: "volume confirms the move",
  [REASON.PARTICIPATION_WEAK]: "volume weak",
  [REASON.PARTICIPATION_VETO]: "volume too low to trade",
  [REASON.VOLATILITY_IDEAL]: "volatility is healthy",
  [REASON.VOLATILITY_HIGH]: "volatility too high",
  [REASON.VOLATILITY_LOW]: "volatility too low",
  [REASON.VOLATILITY_VETO]: "volatility vetoed the trade",
  [REASON.ENTRY_PULLBACK]: "price near ideal pullback zone",
  [REASON.ENTRY_BREAKOUT]: "price at breakout level",
  [REASON.ENTRY_EXTENDED]: "price too extended from EMA",
  [REASON.RR_OK]: "reward/risk is good",
  [REASON.RR_LOW]: "reward/risk too low",
  [REASON.SCORE_LONG]: "long score above threshold",
  [REASON.SCORE_SHORT]: "short score above threshold",
  [REASON.SCORE_NO_TRADE]: "no side cleared the score threshold",
};

export function humanizeReason(code: ReasonCode): string {
  return REASON_TEXT[code] ?? code;
}

export const humanizeFactor = humanizeReason;

export function humanizeReasons(codes: readonly string[] | undefined | null): string[] {
  return (codes ?? []).map((code) => humanizeReason(code as ReasonCode));
}

export function trendLabel(trend: "UP" | "DOWN" | "SIDEWAYS"): string {
  return trend === "UP" ? "Uptrend" : trend === "DOWN" ? "Downtrend" : "Sideways";
}

export function confidenceLabel(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 75) return `${pct}% — strong signal`;
  if (pct >= 55) return `${pct}% — moderate signal`;
  return `${pct}%`;
}

export function summarizeDecision(
  symbol: string,
  timeframe: string,
  price: number | null,
  decision: StrategyDecision,
): string {
  const reasons = humanizeReasons(decision.reasons);
  const trend = trendLabel(decision.trend).toLowerCase();
  const pct = Math.round(decision.confidence * 100);
  const priced = price != null && Number.isFinite(price) ? price.toLocaleString("en-US", { maximumFractionDigits: 4 }) : null;

  const base = `${symbol} (${timeframe}): ${trend}, ${pct}% confidence${priced ? ` at ${priced}` : ""}`;

  if (reasons.length === 0) return base;
  return `${base} — ${reasons.slice(0, 3).join(", ")}`;
}
