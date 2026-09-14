import { describe, it, expect } from "vitest";
import { DefaultDrawdownProtection } from "./drawdown-protection";

const sut = new DefaultDrawdownProtection();

describe("DefaultDrawdownProtection", () => {
  it("blocks when equity drops below peak beyond limit", () => {
    const result = sut.check({ balance: 85, equity: 85, peakBalance: 100 }, 15);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("15.00%");
  });

  it("passes when drawdown is exactly at the boundary (just under)", () => {
    // 14.99% drawdown — just under 15% limit
    const result = sut.check({ balance: 85.01, equity: 85.01, peakBalance: 100 }, 15);
    expect(result.passed).toBe(true);
  });

  it("blocks when drawdown equals the limit exactly", () => {
    // exactly 15% drawdown
    const result = sut.check({ balance: 85, equity: 85, peakBalance: 100 }, 15);
    expect(result.passed).toBe(false);
  });

  it("passes when peak equals equity (0% drawdown)", () => {
    const result = sut.check({ balance: 100, equity: 100, peakBalance: 100 }, 15);
    expect(result.passed).toBe(true);
    expect(result.message).toContain("0.00%");
  });

  it("passes when equity is above peak (new high)", () => {
    const result = sut.check({ balance: 110, equity: 110, peakBalance: 100 }, 15);
    expect(result.passed).toBe(true);
  });

  it("passes when peak or equity is zero (not applicable)", () => {
    expect(sut.check({ balance: 0, equity: 0, peakBalance: 0 }, 15).passed).toBe(true);
    expect(sut.check({ balance: 0, equity: 0, peakBalance: 100 }, 15).passed).toBe(true);
    expect(sut.check({ balance: 100, equity: 100, peakBalance: 0 }, 15).passed).toBe(true);
  });

  it("passes when peakBalance is undefined (fallback to equity)", () => {
    // This covers the legacy path where peakBalance was never set.
    const result = sut.check({ balance: 50, equity: 50 }, 15);
    expect(result.passed).toBe(true);
  });

  it("blocks when peakBalance is undefined but equity < balance fallback would still be 0%", () => {
    // If equity is set but peakBalance is missing, peak falls back to equity → 0% drawdown.
    const result = sut.check({ balance: 50, equity: 50 }, 15);
    expect(result.passed).toBe(true);
  });

  it("uses equity over balance when both present", () => {
    // equity=80 (unrealized loss), balance=95, peak=100 → 20% drawdown from equity
    const result = sut.check({ balance: 95, equity: 80, peakBalance: 100 }, 15);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("20.00%");
  });

  it("falls back to balance when equity is absent", () => {
    const result = sut.check({ balance: 80, peakBalance: 100 }, 15);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("20.00%");
  });

  it("handles large values without precision issues", () => {
    const result = sut.check({ balance: 99999.99, equity: 99999.99, peakBalance: 100000 }, 15);
    expect(result.passed).toBe(true); // 0.0001% drawdown
  });

  it("works with various threshold values", () => {
    // 10% drawdown with 10% limit → blocked
    expect(sut.check({ balance: 90, equity: 90, peakBalance: 100 }, 10).passed).toBe(false);
    // 10% drawdown with 20% limit → passes
    expect(sut.check({ balance: 90, equity: 90, peakBalance: 100 }, 20).passed).toBe(true);
    // 50% drawdown with 50% limit → blocked
    expect(sut.check({ balance: 50, equity: 50, peakBalance: 100 }, 50).passed).toBe(false);
  });
});
