import { describe, it, expect } from "vitest";

/**
 * Replicates the risk validation math from BotScheduler.validateLiveConstraints
 * to verify correctness independent of the full scheduler dependency tree.
 *
 * The logic:
 *   slDistance = max(atr*1.35, price*minStopDistancePct*1.01)
 *   riskBasedSize = maxRiskUsdt / slDistance
 *   capitalCappedSize = (allocated * leverage) / price
 *   positionSize = min(riskBasedSize, capitalCappedSize)
 *   expectedLoss = slDistance * positionSize
 *   reject if expectedLoss > maxRiskUsdt * 1.01
 */
function checkRisk(params: {
  allocated: number;
  leverage: number;
  price: number;
  maxRiskPct: number;
}) {
  const { allocated, leverage, price, maxRiskPct } = params;
  const maxRiskUsdt = allocated * (maxRiskPct / 100);
  const minStopDistancePct = 0.008;
  const estimatedAtr = price * 0.01;
  const slDistance = Math.max(estimatedAtr * 1.35, price * minStopDistancePct * 1.01);
  const positionNotional = allocated * leverage;
  const capitalCappedSize = positionNotional / price;
  const riskBasedSize = maxRiskUsdt / slDistance;
  const positionSize = Math.min(riskBasedSize, capitalCappedSize);
  const expectedLoss = slDistance * positionSize;

  return {
    maxRiskUsdt,
    slDistance,
    riskBasedSize,
    capitalCappedSize,
    positionSize,
    expectedLoss,
    riskLimited: riskBasedSize <= capitalCappedSize,
    compatible: expectedLoss <= maxRiskUsdt * 1.01,
    excess: expectedLoss - maxRiskUsdt,
  };
}

describe("BotScheduler risk validation math", () => {
  it("risk-limited config → loss within max risk", () => {
    // 100 USDT, 10x, price=100, 2% risk
    const r = checkRisk({ allocated: 100, leverage: 10, price: 100, maxRiskPct: 2 });
    // slDistance ≈ max(100*0.01*1.35, 100*0.008*1.01) = max(1.35, 0.808) = 1.35
    // riskBasedSize = 2 / 1.35 ≈ 1.48
    // capitalCappedSize = 1000 / 100 = 10
    // position is risk-limited
    expect(r.riskLimited).toBe(true);
    expect(r.compatible).toBe(true);
    expect(r.expectedLoss).toBeLessThanOrEqual(r.maxRiskUsdt * 1.02);
  });

  it("capital-limited config → loss within max risk", () => {
    // 100 USDT, 1x, price=100, 2% risk
    const r = checkRisk({ allocated: 100, leverage: 1, price: 100, maxRiskPct: 2 });
    // slDistance ≈ 1.35
    // riskBasedSize = 2 / 1.35 ≈ 1.48
    // capitalCappedSize = 100 / 100 = 1
    // position is capital-limited (capitalCappedSize < riskBasedSize)
    // estimatedLoss = slDistance * capitalCappedSize = 1.35 * 1 = 1.35
    // maxRiskUsdt = 2
    // 1.35 <= 2 → compatible
    expect(r.riskLimited).toBe(false);
    expect(r.compatible).toBe(true);
    expect(r.expectedLoss).toBeLessThan(r.maxRiskUsdt);
  });

  it("capital-limited with high leverage → loss still within risk", () => {
    // 50 USDT, 20x, price=100, 2% risk
    const r = checkRisk({ allocated: 50, leverage: 20, price: 100, maxRiskPct: 2 });
    // maxRiskUsdt = 1
    // slDistance ≈ 1.35
    // riskBasedSize = 1 / 1.35 ≈ 0.74
    // capitalCappedSize = 1000 / 100 = 10
    // risk-limited
    expect(r.riskLimited).toBe(true);
    expect(r.compatible).toBe(true);
  });

  it("large capital, low leverage → capital-limited, loss within risk", () => {
    // 10000 USDT, 2x, price=100, 5% risk
    const r = checkRisk({ allocated: 10000, leverage: 2, price: 100, maxRiskPct: 5 });
    // maxRiskUsdt = 500
    // slDistance ≈ 1.35
    // riskBasedSize = 500 / 1.35 ≈ 370
    // capitalCappedSize = 20000 / 100 = 200
    // capital-limited
    // estimatedLoss = 1.35 * 200 = 270
    // maxRiskUsdt = 500
    // 270 <= 500 → compatible
    expect(r.riskLimited).toBe(false);
    expect(r.compatible).toBe(true);
    expect(r.expectedLoss).toBeLessThan(r.maxRiskUsdt);
  });

  it("very high risk pct → always compatible (loss << maxRisk)", () => {
    // 100 USDT, 10x, price=100, 80% risk
    const r = checkRisk({ allocated: 100, leverage: 10, price: 100, maxRiskPct: 80 });
    // maxRiskUsdt = 80
    // riskBasedSize = 80 / 1.35 ≈ 59.3
    // capitalCappedSize = 10
    // capital-limited
    // estimatedLoss = 1.35 * 10 = 13.5
    // maxRiskUsdt = 80 → very compatible
    expect(r.riskLimited).toBe(false);
    expect(r.compatible).toBe(true);
    expect(r.expectedLoss / r.maxRiskUsdt).toBeLessThan(0.2);
  });

  it("tiny position → tiny loss, always compatible", () => {
    // 1 USDT, 1x, price=10000, 1% risk
    const r = checkRisk({ allocated: 1, leverage: 1, price: 10000, maxRiskPct: 1 });
    // maxRiskUsdt = 0.01
    // slDistance ≈ max(10000*0.01*1.35, 10000*0.008*1.01) = max(135, 80.8) = 135
    // riskBasedSize = 0.01 / 135 ≈ 0.000074
    // capitalCappedSize = 1 / 10000 = 0.0001
    // risk-limited
    // estimatedLoss = 135 * 0.000074 ≈ 0.01
    expect(r.compatible).toBe(true);
  });

  it("slDistance scales with price", () => {
    const r1 = checkRisk({ allocated: 100, leverage: 10, price: 100, maxRiskPct: 2 });
    const r2 = checkRisk({ allocated: 100, leverage: 10, price: 200, maxRiskPct: 2 });
    // Both should be compatible
    expect(r1.compatible).toBe(true);
    expect(r2.compatible).toBe(true);
    // SL distance should be roughly proportional to price
    expect(r2.slDistance).toBeGreaterThan(r1.slDistance);
  });
});
