import { describe, expect, it } from "vitest";
import { effectiveAllocation, maxSafeAllocationPct } from "./allocation-headroom";

describe("effectiveAllocation", () => {
  it("caps 100% at the safe maximum instead of rejecting it", () => {
    const result = effectiveAllocation(100, 10);
    expect(result.capped).toBe(true);
    expect(result.effectivePct).toBeCloseTo(maxSafeAllocationPct(10), 9);
    // 2% headroom + 0.01 USDT fee buffer on a 10 USDT balance -> 97.9%.
    expect(result.effectivePct).toBeCloseTo(97.9, 6);
    expect(result.amount).toBeCloseTo(9.79, 6);
  });

  it("uses the requested percentage when it is already within the safe maximum", () => {
    const result = effectiveAllocation(50, 10);
    expect(result.capped).toBe(false);
    expect(result.effectivePct).toBe(50);
    expect(result.amount).toBeCloseTo(5, 9);
  });

  it("allocates nothing when the balance is unknown or zero", () => {
    expect(effectiveAllocation(97, null).amount).toBe(0);
    expect(effectiveAllocation(97, 0).amount).toBe(0);
  });
});
