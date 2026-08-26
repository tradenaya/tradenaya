import type { IndicatorBundle, MarketSnapshot } from "./market";

export type StrategySignal = "BUY" | "SELL" | "WAIT";

export interface StrategyContext {
  symbol: string;
  timeframe: string;
  market: MarketSnapshot;
  indicators: IndicatorBundle;
  position?: unknown;
}

export interface Strategy {
  name: string;
  description: string;
  analyze(context: StrategyContext): Promise<StrategySignal>;
}
