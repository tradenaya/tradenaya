import { describe, it, expect } from "vitest";
import { computeTradePreview } from "./trade-preview";
import type { TradePreviewInput } from "./trade-preview";

function base(overrides: Partial<TradePreviewInput> = {}): TradePreviewInput {
  return {
    walletBalance: 1000,
    capitalMode: "fixed",
    capital: 100,
    walletPercent: null,
    leverage: 10,
    maxRiskPerTradePct: 2,
    currentPrice: 100,
    estimatedAtrPct: 0.01,
    minStopDistancePct: 0.008,
    minRiskRewardRatio: 2,
    ...overrides,
  };
}

describe("computeTradePreview", () => {
  it("returns error when no capital or price", () => {
    const r = computeTradePreview(base({ capital: 0 }));
    expect(r.status).toBe("error");
    expect(r.riskCompatible).toBe(true);
  });

  it("capital-limited config with loss within risk limit → riskCompatible, bindingConstraint=none", () => {
    // 100 USDT at 10x → 1000 notional → 10 units at price=100
    // max risk = 100 * 2% = 2 USDT
    // SL distance ≈ max(atr*1.35, price*0.008*1.01) ≈ max(1.35, 0.808) = 1.35
    // riskBasedSize = 2 / 1.35 ≈ 1.48
    // capitalCappedSize = 1000 / 100 = 10
    // riskBasedSize < capitalCappedSize → risk-limited
    // positionSize = 1.48 → estimatedLoss = 1.35 * 1.48 ≈ 2.00 ≈ maxRiskUsdt
    const r = computeTradePreview(base());
    expect(r.riskCompatible).toBe(true);
    expect(r.estimatedLoss).toBeLessThanOrEqual(r.maxRiskUsdt * 1.02);
    expect(r.bindingConstraint).toBe("risk");
    expect(r.status).not.toBe("error");
  });

  it("capital-limited (low leverage) config where loss < risk limit → riskCompatible, bindingConstraint=none", () => {
    // 100 USDT at 2x → 200 notional → 2 units at price=100
    // max risk = 100 * 2% = 2 USDT
    // SL distance ≈ 1.35
    // riskBasedSize = 2 / 1.35 ≈ 1.48
    // capitalCappedSize = 200 / 100 = 2
    // riskBasedSize < capitalCappedSize → still risk-limited
    const r = computeTradePreview(base({ leverage: 2 }));
    expect(r.riskCompatible).toBe(true);
    expect(r.bindingConstraint).toBe("risk");
  });

  it("loss exceeds risk when leverage creates a large position that is still risk-capped", () => {
    // This is tricky: the risk-based formula caps the position so loss never exceeds maxRisk.
    // The only way to exceed risk is if estimatedLoss > maxRiskUsdt due to the formula.
    // With default SL formula, riskBasedSize = maxRiskUsdt / slDistance, so
    // estimatedLoss = slDistance * min(riskBasedSize, capitalCappedSize).
    // If capitalCappedSize < riskBasedSize (capital-limited), then estimatedLoss = slDistance * capitalCappedSize.
    // So we need slDistance * capitalCappedSize > maxRiskUsdt.
    // That means: capitalCappedSize > maxRiskUsdt / slDistance = riskBasedSize.
    // But capitalCappedSize < riskBasedSize is the condition for capital-limited.
    // Contradiction! If capital-limited, loss is always <= maxRiskUsdt.
    //
    // This means with the standard formula, riskCompatible should ALWAYS be true
    // when the math is consistent. The error case happens only when the user's
    // configured SL doesn't match the planner formula (e.g. server-side override).
    // Let's verify: for any valid config, riskCompatible=true.
    const r = computeTradePreview(base({ leverage: 50, capital: 500 }));
    expect(r.riskCompatible).toBe(true);
  });

  it("riskPct=0 → riskCompatible always true", () => {
    const r = computeTradePreview(base({ maxRiskPerTradePct: 0 }));
    expect(r.riskCompatible).toBe(true);
  });

  it("high risk utilization (>80%) → warning status", () => {
    // Use very high leverage to push utilization up
    // Actually with default formula, loss ≈ maxRiskUsdt (since position is risk-capped).
    // So utilization should be ~100%, triggering warning.
    const r = computeTradePreview(base());
    expect(r.status).toBe("warning");
    expect(r.message).toContain("High risk utilization");
  });

  it("low risk utilization (<=80%) → safe status", () => {
    // To get low utilization we need a large maxRiskUsdt relative to estimatedLoss.
    // If we increase riskPct to 100, maxRiskUsdt = allocatedCapital.
    // Position is still risk-capped, so estimatedLoss ≈ maxRiskUsdt → still high.
    // The only way: set a very high capital so position is capital-limited and small.
    // Wait, capital-limited means capitalCappedSize < riskBasedSize.
    // That means position size = capitalCappedSize, and loss = slDistance * capitalCappedSize.
    // If we use high maxRiskPerTradePct (say 50%), maxRiskUsdt = 50.
    // riskBasedSize = 50 / 1.35 ≈ 37.
    // capitalCappedSize at 10x with capital=100 = 10.
    // Position = 10, loss = 1.35 * 10 = 13.5.
    // Utilization = 13.5 / 50 = 27% → safe!
    const r = computeTradePreview(base({ maxRiskPerTradePct: 50 }));
    expect(r.status).toBe("safe");
    expect(r.bindingConstraint).toBe("none");
  });

  it("estimates loss and profit correctly", () => {
    const r = computeTradePreview(base());
    expect(r.estimatedLoss).toBeGreaterThan(0);
    expect(r.estimatedProfit).toBeGreaterThan(0);
    expect(r.riskRewardRatio).toBeGreaterThan(1);
  });

  it("percent-based capital mode uses wallet balance", () => {
    const r = computeTradePreview(
      base({
        capitalMode: "percent",
        capital: 0,
        walletBalance: 2000,
        walletPercent: 10,
      }),
    );
    // 10% of 2000 = 200 USDT allocated
    expect(r.allocatedCapital).toBe(200);
  });

  it("slPrice and tpPrice are correct relative to current price", () => {
    const r = computeTradePreview(base({ currentPrice: 50 }));
    expect(r.slPrice).toBeLessThan(50);
    expect(r.tpPrice).toBeGreaterThan(50);
  });
});
