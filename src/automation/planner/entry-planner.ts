import type { PlannerContext } from "./types";

export interface EntryPlanner {
  plan(context: PlannerContext): { entryPrice: number; reason: string } | null;
}

export class DefaultEntryPlanner implements EntryPlanner {
  plan(context: PlannerContext): { entryPrice: number; reason: string } | null {
    const price = Number(context.currentPrice);

    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    const atr = Math.max(Number(context.atr) || 0, price * 0.002);
    const support = context.supportResistance?.support;
    const resistance = context.supportResistance?.resistance;
    const buffer = Math.max(atr * 0.6, price * 0.003);

    if (context.strategyDecision.signal === "BUY") {
      const candidate = support
        ? Math.max(price - buffer, support + buffer * 0.25)
        : price - buffer;

      return {
        entryPrice: candidate,
        reason: "BUY signal with a pullback-based limit entry",
      };
    }

    if (context.strategyDecision.signal === "SELL") {
      const candidate = resistance
        ? Math.min(price + buffer, resistance - buffer * 0.25)
        : price + buffer;

      return {
        entryPrice: candidate,
        reason: "SELL signal with a rally-based limit entry",
      };
    }

    return null;
  }
}
