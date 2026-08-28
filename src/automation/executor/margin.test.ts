import { describe, expect, it } from "vitest";
import { maxSafeAllocationPct, MARGIN_HEADROOM, MARGIN_FEE_BUFFER } from "./order-executor";

describe("maxSafeAllocationPct", () => {
  it("returns a percentage that leaves the configured headroom + fee buffer untouched", () => {
    const available = 10.7887;
    const pct = maxSafeAllocationPct(available, MARGIN_HEADROOM, MARGIN_FEE_BUFFER);
    const alloc = available * (pct / 100);
    // alloc + fee buffer must be <= available * (1 - headroom)
    expect(alloc + MARGIN_FEE_BUFFER).toBeLessThanOrEqual(available * (1 - MARGIN_HEADROOM) + 1e-9);
  });

  it("is always strictly below 100% whenever a fee buffer is applied", () => {
    expect(maxSafeAllocationPct(10.7887, 0.02, 0.01)).toBeLessThan(100);
  });

  it("returns 0 for a non-positive balance", () => {
    expect(maxSafeAllocationPct(0, 0.02, 0.01)).toBe(0);
    expect(maxSafeAllocationPct(-5, 0.02, 0.01)).toBe(0);
  });

  it("would have blocked the 100%-allocation case that previously failed", () => {
    // The bug: at 100% allocation the order margin (~= available) consumed the
    // entire free balance and the exchange rejected with "Insufficient balance"
    // over a few cents. The executor caps spendable to available*(1-headroom).
    const available = 10.7887;
    const safePct = maxSafeAllocationPct(available, MARGIN_HEADROOM, MARGIN_FEE_BUFFER);
    // a 100% allocation must be flagged (it exceeds the safe %)
    expect(100).toBeGreaterThan(safePct);
    // a 75% allocation (known to work) is comfortably within the safe range
    expect(safePct).toBeGreaterThan(75);
  });
});
