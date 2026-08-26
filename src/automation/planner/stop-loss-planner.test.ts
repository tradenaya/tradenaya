import { describe, it, expect } from "vitest";
import { DefaultTradePlanner } from "./trade-planner";
import type { PlannerContext } from "./types";
import type { StrategyDecision } from "@/automation/strategy/types";

function decision(signal: "BUY" | "SELL", confidence: number): StrategyDecision {
  return {
    signal,
    confidence,
    trend: signal === "BUY" ? "UP" : "DOWN",
    reasons: ["test"],
    indicators: {},
    timestamp: new Date().toISOString(),
  };
}

function context(signal: "BUY" | "SELL", price: number, atr: number, support: number | undefined, resistance: number | undefined, minStopDistancePct?: number): PlannerContext {
  return {
    strategyDecision: decision(signal, 0.8),
    currentPrice: price,
    indicators: {},
    marketStructure: { trend: signal === "BUY" ? "UP" : "DOWN" },
    supportResistance: { support, resistance },
    atr,
    config: {
      symbol: "LINKUSDT",
      timeframe: "5m",
      capital: 1,
      leverage: 15,
      capitalMode: "percent",
      walletPercent: 100,
      minStopDistancePct,
    },
  };
}

describe("stop-loss planner boundary", () => {
  it("does not reject a stop that sits exactly on the min-distance boundary (floating point)", () => {
    // baseDistance === price * 0.008 to every printed decimal; a one-ULP float
    // error used to flip this into "Stop loss is too close to entry".
    const plan = new DefaultTradePlanner().plan(context("SELL", 8.851, 0.0292, 8.833, 8.899));
    expect(plan.action).toBe("SELL");
    expect(plan.stopLoss).not.toBeNull();
    expect(plan.reason).not.toContain("Stop loss is too close to entry");
  });

  it("respects a custom minStopDistancePct instead of hardcoding 0.008", () => {
    const price = 100;
    const plan = new DefaultTradePlanner().plan(context("BUY", price, 0.1, 99.9, undefined, 0.02));
    expect(plan.action).toBe("BUY");
    const stopDistance = Math.abs(Number(plan.stopLoss) - Number(plan.limitPrice));
    expect(stopDistance).toBeGreaterThan(price * 0.02);
    expect(plan.reason).not.toContain("Stop loss is too close to entry");
  });
});
