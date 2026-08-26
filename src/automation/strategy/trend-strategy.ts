import type { Strategy, StrategyContext, StrategySignal } from "@/automation/types";

export class TrendStrategy implements Strategy {
  name = "TrendStrategy";
  description = "A simple trend-following strategy based on price and moving-average context";

  async analyze(context: StrategyContext): Promise<StrategySignal> {
    const { market, indicators } = context;
    const price = market.price;
    const ema = Number(indicators.ema ?? 0);
    const sma = Number(indicators.sma ?? 0);

    if (!price || !ema || !sma) {
      return "WAIT";
    }

    if (price > ema && price > sma) {
      return "BUY";
    }

    if (price < ema && price < sma) {
      return "SELL";
    }

    return "WAIT";
  }
}
