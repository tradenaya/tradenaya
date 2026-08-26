import { describe, expect, it } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { evaluateEntryValidity } from "./EntryValidity";

function makeCandles(count: number, drift: number, seed: number): MarketCandle[] {
  const candles: MarketCandle[] = [];
  for (let i = 0; i < count; i++) {
    const t = seed + i * 300_000;
    const open = drift * i + seed / 100;
    const close = open + (i % 2 === 0 ? 1 : -0.5) * 3;
    candles.push({
      timestamp: t,
      open,
      high: close + 2,
      low: close - 2,
      close,
      volume: 1000 + (i % 7) * 100,
      timeframe: "5m",
    });
  }
  return candles;
}

const bull = makeCandles(120, 2, 60000);
const bear = makeCandles(120, -2, 60000);

function ctx(overrides: Partial<Parameters<typeof evaluateEntryValidity>[0]> = {}) {
  return {
    side: "BUY" as const,
    limitPrice: 67530,
    stopLoss: 64668,
    marketPrice: 68300,
    ageMs: 5 * 60_000,
    timeframeMinutes: 5,
    candles: bull,
    ...overrides,
  };
}

describe("evaluateEntryValidity", () => {
  it("keeps a valid resting BUY inside a pullback zone", () => {
    const result = evaluateEntryValidity(ctx({ marketPrice: 67200 }));
    expect(result.keep).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("cancels when price runs >1× the volatility range away (breakout breaks the entry zone)", () => {
    const result = evaluateEntryValidity(ctx({ marketPrice: 68300 }));
    expect(result.keep).toBe(false);
    expect(result.hard.join(" ")).toContain("entry zone broken");
  });

  it("cancels when the base trend flips bearish for a BUY", () => {
    const result = evaluateEntryValidity(ctx({ candles: bear }));
    expect(result.keep).toBe(false);
    expect(result.hard.join(" ")).toContain("flipped bearish");
  });

  it("cancels when the higher-timeframe regime flipped against a SELL", () => {
    const result = evaluateEntryValidity(ctx({ side: "SELL", limitPrice: 68000, stopLoss: 68500, marketPrice: 67300, higherTimeframeCandles: bull }));
    expect(result.keep).toBe(false);
    expect(result.hard.join(" ")).toContain("regime flipped up");
  });

  it("cancels when price breaches the stop-loss zone before fill", () => {
    const result = evaluateEntryValidity(ctx({ marketPrice: 64500 }));
    expect(result.keep).toBe(false);
    expect(result.hard.join(" ")).toContain("stop-loss zone");
  });

  it("combines soft signals (overbought + time backstop) to cancel", () => {
    // RSI well above 80 on a strongly rising ramp, plus order sitting over the backstop.
    const hot = makeCandles(120, 4, 80000);
    const result = evaluateEntryValidity(ctx({ candles: hot, marketPrice: 67400, ageMs: 30 * 5 * 60_000 }));
    expect(result.keep).toBe(false);
    expect(result.soft.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT cancel a fresh order on equal soft signals alone", () => {
    // Only momentum soft signal, age under backstop -> keep.
    const result = evaluateEntryValidity(ctx({ candles: makeCandles(120, 4, 80000), marketPrice: 67400 }));
    expect(result.keep).toBe(true);
  });

  it("never cancels an order it cannot judge (no limit price / no candles)", () => {
    expect(evaluateEntryValidity(ctx({ limitPrice: null })).keep).toBe(true);
    expect(evaluateEntryValidity(ctx({ candles: [] })).keep).toBe(true);
  });

  it("cancels via the circuit-breaker when age alone crosses the hard cap", () => {
    const result = evaluateEntryValidity(ctx({ marketPrice: 67200, ageMs: 50 * 5 * 60_000 }));
    expect(result.keep).toBe(false);
    expect(result.hard.join(" ")).toContain("circuit-breaker");
  });

  it("does NOT cancel on the soft backstop alone within the circuit-breaker", () => {
    const result = evaluateEntryValidity(ctx({ marketPrice: 67200, ageMs: 30 * 5 * 60_000 }));
    expect(result.keep).toBe(true);
  });
});