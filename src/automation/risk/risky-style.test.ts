import { describe, it, expect } from "vitest";
import { DefaultPositionSizeCalculator } from "./position-size-calculator";
import { DefaultRiskValidator } from "./risk-validator";
import { DefaultRiskManager } from "./risk-manager";
import { DEFAULT_RISK_CONFIG } from "./types";
import type { RiskManagerInput } from "./types";
import type { TradePlan } from "@/automation/planner/types";

/**
 * Trade style. SAFE: a stop-loss hit loses at most max-risk-per-trade % of the
 * allocation. RISKY: the whole allocation is the margin at the bot's leverage.
 */
const base = { allocatedCapital: 100, leverage: 10, maxRiskPerTradePct: 2, side: "BUY" as const, limitPrice: 50, stopLoss: 49, takeProfit: 52 };

describe("position size — SAFE vs RISKY", () => {
  const calc = new DefaultPositionSizeCalculator();

  it("SAFE: size from max risk (2 USDT at a 1 USDT stop = 2 coins), loss at SL = 2% of the allocation", () => {
    const r = calc.calculate(base);
    expect(r.positionSize).toBeCloseTo(2);
    expect(r.expectedLoss).toBeCloseTo(2);
    expect(r.margin).toBeCloseTo(10);
  });

  it("RISKY: whole allocation as margin (100 × 10x / 50 = 20 coins), loss at SL = 20%", () => {
    const r = calc.calculate({ ...base, fullAllocation: true });
    expect(r.valid).toBe(true);
    expect(r.positionSize).toBeCloseTo(20);
    expect(r.margin).toBeCloseTo(100);
    expect(r.expectedLoss).toBeCloseTo(20);
    expect(r.riskPercentage).toBeCloseTo(20);
  });

  it("RISKY ignores a zero max-risk setting", () => {
    expect(calc.calculate({ ...base, maxRiskPerTradePct: 0, fullAllocation: true }).valid).toBe(true);
    expect(calc.calculate({ ...base, maxRiskPerTradePct: 0 }).valid).toBe(false);
  });

  it("RISKY still rejects a stop-loss on the wrong side", () => {
    expect(calc.calculate({ ...base, stopLoss: 51, fullAllocation: true }).valid).toBe(false);
  });
});

describe("risk checks — RISKY skips only max-risk-per-trade", () => {
  const plan = { riskRewardRatio: 2 } as TradePlan;
  const config = { ...DEFAULT_RISK_CONFIG, maxRiskPerTradePct: 2 };

  it("SAFE: a 20% loss at SL fails the max-risk check", () => {
    const checks = new DefaultRiskValidator().check({ plan, leverage: 10, riskPercentage: 20, wallet: { balance: 100 }, config });
    expect(checks.find((c) => c.name === "max-risk-per-trade")?.passed).toBe(false);
  });

  it("RISKY: same trade passes and says how much a stop-loss hit loses", () => {
    const checks = new DefaultRiskValidator().check({ plan, leverage: 10, riskPercentage: 20, wallet: { balance: 100 }, config: { ...config, fullAllocation: true } });
    const c = checks.find((x) => x.name === "max-risk-per-trade");
    expect(c?.passed).toBe(true);
    expect(c?.message).toContain("20.00%");
  });

  it("RISKY: the R:R minimum and leverage cap still apply", () => {
    const checks = new DefaultRiskValidator().check({ plan: { riskRewardRatio: 1 } as TradePlan, leverage: 200, riskPercentage: 20, wallet: { balance: 100 }, config: { ...config, fullAllocation: true, maxLeverage: 100 } });
    expect(checks.find((c) => c.name === "risk-reward")?.passed).toBe(false);
    expect(checks.find((c) => c.name === "max-leverage")?.passed).toBe(false);
  });
});

describe("risk manager — RISKY end to end", () => {
  const input = (fullAllocation: boolean, realizedPnl = 0): RiskManagerInput => ({
    config: { ...DEFAULT_RISK_CONFIG, maxRiskPerTradePct: 2, maxCapitalAllocationPct: 100, maxLeverage: 100, dailyLossLimitPct: 30, minRiskRewardRatio: 1.5, fullAllocation },
    wallet: { balance: 100 },
    capital: { mode: "percent", percent: 100, leverage: 10 },
    plan: { action: "BUY", entryType: "LIMIT", limitPrice: 50, stopLoss: 49, takeProfit: 52, riskRewardRatio: 2, confidence: 0.8, reason: "t", expiryTime: new Date(Date.now() + 3600_000).toISOString(), symbol: "XRPUSDT" } as TradePlan,
    openPositions: [],
    openOrders: [],
    daily: { date: new Date().toISOString().slice(0, 10), realizedPnl, tradeCount: 0 },
    runningBots: 0,
  });

  it("approves a full-allocation size", () => {
    const d = new DefaultRiskManager().evaluate(input(true));
    expect(d.approved).toBe(true);
    expect(d.positionSize).toBeCloseTo(20);
  });

  it("the daily loss limit still stops it after a bad day", () => {
    const d = new DefaultRiskManager().evaluate(input(true, -40));
    expect(d.approved).toBe(false);
  });
});
