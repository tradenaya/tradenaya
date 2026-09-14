import type { PlannerContext } from "./types";

export interface TakeProfitPlanner {
  plan(context: PlannerContext, entryPrice: number, stopLoss: number): { takeProfit: number; reason: string } | null;
}

/**
 * Take-profit placement that targets the NEARER of the R-multiple target and the
 * opposing structural level (resistance for longs, support for shorts).
 *
 * This keeps TPs realistic and reachable — a target sitting past a structural
 * level is unlikely to be filled. The minimum reward/risk requirement is
 * enforced by the risk-reward validator, not by inflating the target beyond
 * structure.
 */
export class DefaultTakeProfitPlanner implements TakeProfitPlanner {
  plan(context: PlannerContext, entryPrice: number, stopLoss: number): { takeProfit: number; reason: string } | null {
    const price = Number(context.currentPrice);

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const targetRatio = context.config.minRiskRewardRatio ?? 2;
    // Never tighter than 1.8 x ATR even when the stop is tiny, so the TP is not
    // absurdly close to entry on a micro-scalp.
    const baseDistance = Math.max(stopDistance * targetRatio, atr * 1.8);
    const resistance = context.supportResistance?.resistance;
    const support = context.supportResistance?.support;

    if (context.strategyDecision.signal === "BUY") {
      const base = entryPrice + baseDistance;
      const structural = resistance != null ? resistance + atr * 0.35 : base;
      return {
        takeProfit: Math.min(base, structural),
        reason: "BUY target is the nearer of the R-multiple target and structural resistance",
      };
    }

    if (context.strategyDecision.signal === "SELL") {
      const base = entryPrice - baseDistance;
      const structural = support != null ? support - atr * 0.35 : base;
      return {
        takeProfit: Math.max(base, structural),
        reason: "SELL target is the nearer of the R-multiple target and structural support",
      };
    }

    return null;
  }
}
