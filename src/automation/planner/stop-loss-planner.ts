import type { PlannerContext } from "./types";

export interface StopLossPlanner {
  plan(context: PlannerContext, entryPrice: number): { stopLoss: number; reason: string } | null;
}

export class DefaultStopLossPlanner implements StopLossPlanner {
  plan(context: PlannerContext, entryPrice: number): { stopLoss: number; reason: string } | null {
    const price = Number(context.currentPrice);

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const support = context.supportResistance?.support;
    const minStopDistancePct = context.config.minStopDistancePct ?? 0.008;
    // Use a small safety margin above the validator's minimum so floating-point
    // rounding at the equality boundary can never make the stop look "too close".
    const baseDistance = Math.max(atr * 1.35, price * minStopDistancePct * 1.01);

    if (context.strategyDecision.signal === "BUY") {
      const fallback = entryPrice - baseDistance;
      const candidate = support ? Math.min(fallback, support - atr * 0.25) : fallback;

      return {
        stopLoss: candidate,
        reason: "BUY stop placed below support and ATR-based volatility",
      };
    }

    if (context.strategyDecision.signal === "SELL") {
      const fallback = entryPrice + baseDistance;
      const candidate = context.supportResistance?.resistance
        ? Math.max(fallback, context.supportResistance.resistance + atr * 0.25)
        : fallback;

      return {
        stopLoss: candidate,
        reason: "SELL stop placed above resistance and ATR-based volatility",
      };
    }

    return null;
  }
}
