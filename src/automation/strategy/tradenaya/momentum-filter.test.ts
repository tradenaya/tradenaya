import { describe, expect, it } from "vitest";
import { passesMomentumFilter } from "./momentum-filter";

describe("passesMomentumFilter", () => {
  it("keeps longs only when RSI is already strong (>= 80)", () => {
    expect(passesMomentumFilter("BUY", 82)).toBe(true);
    expect(passesMomentumFilter("LONG", 80)).toBe(true);
    expect(passesMomentumFilter("BUY", 72)).toBe(false);
  });

  it("keeps shorts only when RSI is already weak (<= 20)", () => {
    expect(passesMomentumFilter("SELL", 18)).toBe(true);
    expect(passesMomentumFilter("SHORT", 20)).toBe(true);
    expect(passesMomentumFilter("SELL", 35)).toBe(false);
  });

  it("rejects when RSI is unavailable", () => {
    expect(passesMomentumFilter("BUY", null)).toBe(false);
    expect(passesMomentumFilter("SELL", Number.NaN)).toBe(false);
  });
});
