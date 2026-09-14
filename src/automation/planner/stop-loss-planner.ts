import type { PlannerContext } from "./types";

export interface StopLossPlanner {
  plan(context: PlannerContext, entryPrice: number): { stopLoss: number; reason: string } | null;
}

/**
 * Stop-loss placement that is structure-aware and volatility-clamped.
 *
 * The stop is placed BEYOND the nearest structural level (support/resistance or
 * the last swing) with an ATR buffer, but is never tighter than the ATR /
 * min-distance floor (prevents premature stop-outs) and never wider than the
 * configured max distance (keeps risk capped).
 */
export class DefaultStopLossPlanner implements StopLossPlanner {
  plan(context: PlannerContext, entryPrice: number): { stopLoss: number; reason: string } | null {
    const price = Number(context.currentPrice);

    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return null;
    }

    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const minStopDistancePct = context.config.minStopDistancePct ?? 0.008;
    const maxStopDistancePct = context.config.maxStopDistancePct ?? 0.05;
    const support = context.supportResistance?.support;
    const resistance = context.supportResistance?.resistance;
    const bufferAtr = atr * 0.5;

    // Minimum distance floor: at least the ATR-based volatility distance, but
    // never tighter than the configured minimum stop distance.
    const minDistance = Math.max(atr * 1.35, price * minStopDistancePct * 1.01);
    const maxDistance = Math.max(minDistance, price * maxStopDistancePct);

    if (context.strategyDecision.signal === "BUY") {
      const structural = support != null ? support - bufferAtr : entryPrice - minDistance;
      // Clamp so the stop is between [entry - maxDistance, entry - minDistance].
      const candidate = Math.min(Math.max(structural, entryPrice - maxDistance), entryPrice - minDistance);

      return {
        stopLoss: candidate,
        reason: "BUY stop placed beyond support with ATR buffer, clamped to min/max risk distance",
      };
    }

    if (context.strategyDecision.signal === "SELL") {
      const structural = resistance != null ? resistance + bufferAtr : entryPrice + minDistance;
      // Clamp so the stop is between [entry + minDistance, entry + maxDistance].
      const candidate = Math.max(Math.min(structural, entryPrice + maxDistance), entryPrice + minDistance);

      return {
        stopLoss: candidate,
        reason: "SELL stop placed beyond resistance with ATR buffer, clamped to min/max risk distance",
      };
    }

    return null;
  }
}
