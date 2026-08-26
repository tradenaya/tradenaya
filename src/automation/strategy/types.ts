import type { IndicatorBundle, MarketCandle, MarketSnapshot } from "@/automation/types";

export type StrategySignal = "BUY" | "SELL" | "WAIT";

export interface StrategyDecision {
  signal: StrategySignal;
  confidence: number;
  trend: "UP" | "DOWN" | "SIDEWAYS";
  reasons: string[];
  indicators: Record<string, number | string | boolean | null | undefined>;
  entryZone?: number;
  stopLossSuggestion?: number;
  takeProfitSuggestion?: number;
  timestamp: string;
}

export interface StrategyContext {
  symbol: string;
  market: MarketSnapshot;
  timeframe: string;
  indicators: IndicatorBundle;
  candles: MarketCandle[];
  higherTimeframeCandles?: MarketCandle[];
  mediumTimeframeCandles?: MarketCandle[];
  lowerTimeframeCandles?: MarketCandle[];
  /** Optional live reporter so a strategy can stream its internal steps. */
  report?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface BaseStrategy {
  name: string;
  analyze(context: StrategyContext): Promise<StrategyDecision>;
}
