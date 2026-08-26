import type { PlannerContext } from "./types";

export interface TakeProfitPlanner {
  plan(context: PlannerContext, entryPrice: number, stopLoss: number): { takeProfit: number; reason: string } | null;
}

export class DefaultTakeProfitPlanner implements TakeProfitPlanner {
  plan(context: PlannerContext, entryPrice: number, stopLoss: number): { takeProfit: number; reason: string } | null {
    const price = Number(context.currentPrice);

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const targetRatio = context.config.minRiskRewardRatio ?? 2;
    const baseDistance = Math.max(stopDistance * targetRatio, atr * 1.8);
    const resistance = context.supportResistance?.resistance;
    const support = context.supportResistance?.support;

    if (context.strategyDecision.signal === "BUY") {
      const candidate = resistance
        ? Math.max(entryPrice + baseDistance, resistance + atr * 0.35)
        : entryPrice + baseDistance;

      return {
        takeProfit: candidate,
        reason: "BUY target aligned to reward target and resistance structure",
      };
    }

    if (context.strategyDecision.signal === "SELL") {
      const candidate = support
        ? Math.min(entryPrice - baseDistance, support - atr * 0.35)
        : entryPrice - baseDistance;

      return {
        takeProfit: candidate,
        reason: "SELL target aligned to reward target and support structure",
      };
    }

    return null;
  }
}
